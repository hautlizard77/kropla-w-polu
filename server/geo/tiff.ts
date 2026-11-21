/**
 * Minimalny czytnik GeoTIFF / Cloud Optimized GeoTIFF.
 *
 * Obsługuje: TIFF i BigTIFF, kafle i pasy, kompresję brak/Deflate/LZW/PackBits, predyktory 2 i 3,
 * typy uint8/int8/uint16/int16/uint32/int32/float32/float64, jedno pasmo (przy wielu – pierwsze),
 * georeferencję z ModelTiepoint + ModelPixelScale lub ModelTransformation oraz kod EPSG z GeoKeys.
 * Odczyt wycinka pobiera tylko potrzebne kafle – przy źródle HTTP przez zapytania Range.
 */
import { inflateSync } from 'node:zlib';

export interface ByteSource {
  read(offset: number, length: number): Promise<Uint8Array>;
  readonly description: string;
}

export class BufferSource implements ByteSource {
  constructor(private readonly data: Uint8Array, readonly description = 'bufor') {}
  async read(offset: number, length: number): Promise<Uint8Array> {
    return this.data.subarray(offset, Math.min(offset + length, this.data.length));
  }
}

/** Źródło HTTP z zapytaniami Range i buforem bloków nagłówka. */
export class HttpRangeSource implements ByteSource {
  private readonly blocks = new Map<number, Promise<Uint8Array>>();
  private static readonly BLOCK = 64 * 1024;
  bytesFetched = 0;
  requests = 0;

  constructor(readonly url: string, private readonly timeoutMs = 30000) {}

  get description(): string {
    return this.url;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    // Małe odczyty (nagłówek, IFD) idą przez bufor bloków 64 KB; duże (kafle) – bezpośrednio.
    if (length <= HttpRangeSource.BLOCK) {
      const first = Math.floor(offset / HttpRangeSource.BLOCK);
      const last = Math.floor((offset + length - 1) / HttpRangeSource.BLOCK);
      const parts: Uint8Array[] = [];
      for (let b = first; b <= last; b += 1) parts.push(await this.block(b));
      const joined = concat(parts);
      const start = offset - first * HttpRangeSource.BLOCK;
      return joined.subarray(start, start + length);
    }
    return this.fetchRange(offset, length);
  }

  private block(index: number): Promise<Uint8Array> {
    let promise = this.blocks.get(index);
    if (!promise) {
      promise = this.fetchRange(index * HttpRangeSource.BLOCK, HttpRangeSource.BLOCK);
      this.blocks.set(index, promise);
    }
    return promise;
  }

  private async fetchRange(offset: number, length: number): Promise<Uint8Array> {
    const response = await fetch(this.url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status !== 206 && response.status !== 200) {
      throw new Error(`HTTP ${response.status} przy odczycie ${this.url}`);
    }
    const data = new Uint8Array(await response.arrayBuffer());
    this.requests += 1;
    this.bytesFetched += data.length;
    // Serwer bez obsługi Range zwraca cały plik (200) – wycinamy żądany fragment.
    return response.status === 200 ? data.subarray(offset, offset + length) : data;
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0] as Uint8Array;
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };

type TagValue = number[] | string;

export interface GeoTransform {
  /** Współrzędne lewego górnego narożnika obrazu (krawędź piksela). */
  originX: number;
  originY: number;
  pixelWidth: number;
  /** Dodatnia wysokość piksela (oś Y obrazu w dół). */
  pixelHeight: number;
}

export interface TiffImage {
  width: number;
  height: number;
  bitsPerSample: number;
  sampleFormat: number;
  samplesPerPixel: number;
  compression: number;
  predictor: number;
  tileWidth: number;
  tileHeight: number;
  tiled: boolean;
  offsets: number[];
  byteCounts: number[];
  noData: number | null;
  geo: GeoTransform | null;
  epsg: number | null;
}

export class Tiff {
  private constructor(
    private readonly source: ByteSource,
    private readonly little: boolean,
    readonly images: TiffImage[],
  ) {}

  static async open(source: ByteSource): Promise<Tiff> {
    const header = await source.read(0, 16);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const order = String.fromCharCode(header[0] ?? 0, header[1] ?? 0);
    if (order !== 'II' && order !== 'MM') throw new Error('To nie jest plik TIFF');
    const little = order === 'II';
    const version = view.getUint16(2, little);
    const big = version === 43;
    if (version !== 42 && !big) throw new Error(`Nieznana wersja TIFF: ${version}`);
    let ifdOffset = big ? Number(view.getBigUint64(8, little)) : view.getUint32(4, little);
    const images: TiffImage[] = [];
    const reader = new IfdReader(source, little, big);
    while (ifdOffset !== 0 && images.length < 32) {
      const { tags, next } = await reader.readIfd(ifdOffset);
      images.push(toImage(tags));
      ifdOffset = next;
    }
    if (images.length === 0) throw new Error('Plik TIFF nie zawiera obrazu');
    return new Tiff(source, little, images);
  }

  /** Pierwszy obraz – pełna rozdzielczość (w COG kolejne IFD to podglądy). */
  get main(): TiffImage {
    return this.images[0] as TiffImage;
  }

  /**
   * Czyta prostokątny wycinek pierwszego pasma jako Float64Array.
   * Piksele poza obrazem i równe NoData otrzymują wartość NaN.
   */
  async readWindow(x0: number, y0: number, w: number, h: number, image: TiffImage = this.main): Promise<Float64Array> {
    const out = new Float64Array(w * h).fill(Number.NaN);
    const tw = image.tiled ? image.tileWidth : image.width;
    const th = image.tiled ? image.tileHeight : image.tileHeight;
    const tilesAcross = Math.ceil(image.width / tw);
    const cx0 = Math.max(0, x0);
    const cy0 = Math.max(0, y0);
    const cx1 = Math.min(image.width, x0 + w);
    const cy1 = Math.min(image.height, y0 + h);
    if (cx1 <= cx0 || cy1 <= cy0) return out;

    const jobs: Promise<void>[] = [];
    for (let ty = Math.floor(cy0 / th); ty <= Math.floor((cy1 - 1) / th); ty += 1) {
      for (let tx = Math.floor(cx0 / tw); tx <= Math.floor((cx1 - 1) / tw); tx += 1) {
        const index = image.tiled ? ty * tilesAcross + tx : ty;
        jobs.push(
          this.decodeBlock(image, index, tw, th).then((block) => {
            const bx0 = tx * tw;
            const by0 = ty * th;
            const rows = image.tiled ? th : Math.min(th, image.height - by0);
            for (let row = 0; row < rows; row += 1) {
              const gy = by0 + row;
              if (gy < cy0 || gy >= cy1) continue;
              for (let col = 0; col < tw; col += 1) {
                const gx = bx0 + col;
                if (gx < cx0 || gx >= cx1) continue;
                let value = block[(row * tw + col) * image.samplesPerPixel] as number;
                if (image.noData !== null && value === image.noData) value = Number.NaN;
                out[(gy - y0) * w + (gx - x0)] = value;
              }
            }
          }),
        );
      }
    }
    await Promise.all(jobs);
    return out;
  }

  private async decodeBlock(image: TiffImage, index: number, tw: number, th: number): Promise<ArrayLike<number>> {
    const offset = image.offsets[index];
    const count = image.byteCounts[index];
    const rows = image.tiled ? th : Math.min(th, image.height - index * th);
    const samples = tw * rows * image.samplesPerPixel;
    const bytesPerSample = image.bitsPerSample / 8;
    if (offset === undefined || count === undefined || count === 0) {
      return new Float64Array(samples).fill(image.noData ?? Number.NaN);
    }
    const raw = await this.source.read(offset, count);
    let bytes: Uint8Array;
    switch (image.compression) {
      case 1:
        bytes = raw;
        break;
      case 8:
      case 32946:
        bytes = new Uint8Array(inflateSync(raw));
        break;
      case 5:
        bytes = lzwDecode(raw, samples * bytesPerSample);
        break;
      case 32773:
        bytes = packBitsDecode(raw, samples * bytesPerSample);
        break;
      default:
        throw new Error(`Nieobsługiwana kompresja TIFF: ${image.compression}`);
    }
    if (image.predictor === 3) {
      bytes = undoFloatPredictor(bytes, tw * image.samplesPerPixel, rows, bytesPerSample, this.little);
      return readSamples(bytes, image, samples, false);
    }
    const values = readSamples(bytes, image, samples, this.little);
    if (image.predictor === 2) {
      undoHorizontalPredictor(values, tw, rows, image.samplesPerPixel);
      if (image.sampleFormat === 2) wrapSigned(values, image.bitsPerSample);
      else wrapUnsigned(values, image.bitsPerSample);
    }
    return values;
  }
}

class IfdReader {
  constructor(private readonly source: ByteSource, private readonly little: boolean, private readonly big: boolean) {}

  async readIfd(offset: number): Promise<{ tags: Map<number, TagValue>; next: number }> {
    const countSize = this.big ? 8 : 2;
    const entrySize = this.big ? 20 : 12;
    const head = await this.source.read(offset, countSize);
    const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const count = this.big ? Number(headView.getBigUint64(0, this.little)) : headView.getUint16(0, this.little);
    const tableLength = count * entrySize + (this.big ? 8 : 4);
    const table = await this.source.read(offset + countSize, tableLength);
    const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
    const tags = new Map<number, TagValue>();
    for (let i = 0; i < count; i += 1) {
      const base = i * entrySize;
      const tag = view.getUint16(base, this.little);
      const type = view.getUint16(base + 2, this.little);
      const n = this.big ? Number(view.getBigUint64(base + 4, this.little)) : view.getUint32(base + 4, this.little);
      const size = (TYPE_SIZES[type] ?? 1) * n;
      const inlineCapacity = this.big ? 8 : 4;
      const valueOffset = base + (this.big ? 12 : 8);
      let data: DataView;
      if (size <= inlineCapacity) {
        data = new DataView(table.buffer, table.byteOffset + valueOffset, inlineCapacity);
      } else {
        const ptr = this.big ? Number(view.getBigUint64(valueOffset, this.little)) : view.getUint32(valueOffset, this.little);
        const bytes = await this.source.read(ptr, size);
        data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      }
      tags.set(tag, decodeValues(data, type, n, this.little));
    }
    const nextPos = count * entrySize;
    const next = this.big ? Number(view.getBigUint64(nextPos, this.little)) : view.getUint32(nextPos, this.little);
    return { tags, next };
  }
}

function decodeValues(view: DataView, type: number, n: number, little: boolean): TagValue {
  if (type === 2) {
    let text = '';
    for (let i = 0; i < n; i += 1) {
      const c = view.getUint8(i);
      if (c === 0) break;
      text += String.fromCharCode(c);
    }
    return text;
  }
  const values: number[] = [];
  for (let i = 0; i < n; i += 1) {
    switch (type) {
      case 1:
      case 7:
        values.push(view.getUint8(i));
        break;
      case 6:
        values.push(view.getInt8(i));
        break;
      case 3:
        values.push(view.getUint16(i * 2, little));
        break;
      case 8:
        values.push(view.getInt16(i * 2, little));
        break;
      case 4:
        values.push(view.getUint32(i * 4, little));
        break;
      case 9:
        values.push(view.getInt32(i * 4, little));
        break;
      case 5:
        values.push(view.getUint32(i * 8, little) / view.getUint32(i * 8 + 4, little));
        break;
      case 10:
        values.push(view.getInt32(i * 8, little) / view.getInt32(i * 8 + 4, little));
        break;
      case 11:
        values.push(view.getFloat32(i * 4, little));
        break;
      case 12:
        values.push(view.getFloat64(i * 8, little));
        break;
      case 16:
        values.push(Number(view.getBigUint64(i * 8, little)));
        break;
      case 17:
        values.push(Number(view.getBigInt64(i * 8, little)));
        break;
      default:
        values.push(0);
    }
  }
  return values;
}

function num(tags: Map<number, TagValue>, tag: number, fallback: number): number {
  const value = tags.get(tag);
  return Array.isArray(value) && value.length > 0 ? (value[0] as number) : fallback;
}

function arr(tags: Map<number, TagValue>, tag: number): number[] {
  const value = tags.get(tag);
  return Array.isArray(value) ? value : [];
}

function toImage(tags: Map<number, TagValue>): TiffImage {
  const width = num(tags, 256, 0);
  const height = num(tags, 257, 0);
  const tiled = tags.has(322);
  const noDataTag = tags.get(42113);
  const noDataParsed = typeof noDataTag === 'string' ? Number.parseFloat(noDataTag) : Number.NaN;
  return {
    width,
    height,
    bitsPerSample: num(tags, 258, 8),
    sampleFormat: num(tags, 339, 1),
    samplesPerPixel: num(tags, 277, 1),
    compression: num(tags, 259, 1),
    predictor: num(tags, 317, 1),
    tiled,
    tileWidth: tiled ? num(tags, 322, width) : width,
    tileHeight: tiled ? num(tags, 323, height) : num(tags, 278, height),
    offsets: tiled ? arr(tags, 324) : arr(tags, 273),
    byteCounts: tiled ? arr(tags, 325) : arr(tags, 279),
    noData: Number.isFinite(noDataParsed) ? noDataParsed : null,
    geo: readGeo(tags),
    epsg: readEpsg(tags),
  };
}

function readGeo(tags: Map<number, TagValue>): GeoTransform | null {
  const transform = arr(tags, 34264);
  if (transform.length >= 16) {
    return {
      originX: transform[3] as number,
      originY: transform[7] as number,
      pixelWidth: transform[0] as number,
      pixelHeight: -(transform[5] as number),
    };
  }
  const scale = arr(tags, 33550);
  const tie = arr(tags, 33922);
  if (scale.length >= 2 && tie.length >= 6) {
    const [i, j, , x, y] = tie as [number, number, number, number, number];
    const sx = scale[0] as number;
    const sy = scale[1] as number;
    return { originX: x - i * sx, originY: y + j * sy, pixelWidth: sx, pixelHeight: sy };
  }
  return null;
}

function readEpsg(tags: Map<number, TagValue>): number | null {
  const keys = arr(tags, 34735);
  if (keys.length < 4) return null;
  const count = keys[3] as number;
  for (let i = 0; i < count; i += 1) {
    const id = keys[4 + i * 4];
    const location = keys[5 + i * 4];
    const value = keys[7 + i * 4];
    if ((id === 3072 || id === 2048) && location === 0 && value !== undefined && value !== 32767) return value;
  }
  return null;
}

function readSamples(bytes: Uint8Array, image: TiffImage, count: number, little: boolean): Float64Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float64Array(count);
  const bits = image.bitsPerSample;
  const format = image.sampleFormat;
  const available = Math.min(count, Math.floor(bytes.byteLength / (bits / 8)));
  for (let i = 0; i < available; i += 1) {
    if (format === 3) out[i] = bits === 64 ? view.getFloat64(i * 8, little) : view.getFloat32(i * 4, little);
    else if (format === 2) out[i] = bits === 8 ? view.getInt8(i) : bits === 16 ? view.getInt16(i * 2, little) : view.getInt32(i * 4, little);
    else out[i] = bits === 8 ? view.getUint8(i) : bits === 16 ? view.getUint16(i * 2, little) : view.getUint32(i * 4, little);
  }
  for (let i = available; i < count; i += 1) out[i] = Number.NaN;
  return out;
}

function undoHorizontalPredictor(values: Float64Array, width: number, rows: number, samples: number): void {
  // Różnice sumujemy w liczbach zmiennoprzecinkowych, a potem sprowadzamy wynik do zakresu typu (modulo).
  for (let row = 0; row < rows; row += 1) {
    const base = row * width * samples;
    for (let col = 1; col < width; col += 1) {
      for (let s = 0; s < samples; s += 1) {
        const i = base + col * samples + s;
        values[i] = (values[i] as number) + (values[i - samples] as number);
      }
    }
  }
}

function wrapSigned(values: Float64Array, bits: number): void {
  const mod = 2 ** bits;
  const half = mod / 2;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (!Number.isFinite(v)) continue;
    const u = ((v % mod) + mod) % mod;
    values[i] = u >= half ? u - mod : u;
  }
}

/** Po dekodowaniu predyktora 2 wartości bez znaku trzeba sprowadzić do zakresu typu. */
export function wrapUnsigned(values: Float64Array, bits: number): void {
  const mod = 2 ** bits;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (Number.isFinite(v)) values[i] = ((v % mod) + mod) % mod;
  }
}

function undoFloatPredictor(bytes: Uint8Array, width: number, rows: number, bytesPerSample: number, little: boolean): Uint8Array {
  const rowBytes = width * bytesPerSample;
  const out = new Uint8Array(bytes.length);
  for (let row = 0; row < rows; row += 1) {
    const start = row * rowBytes;
    const line = bytes.subarray(start, start + rowBytes);
    for (let i = 1; i < rowBytes; i += 1) line[i] = ((line[i] as number) + (line[i - 1] as number)) & 0xff;
    for (let col = 0; col < width; col += 1) {
      for (let b = 0; b < bytesPerSample; b += 1) {
        // Bajty są zapisane od najbardziej znaczącego; dla little-endian odwracamy kolejność.
        const src = line[b * width + col] as number;
        const target = little ? bytesPerSample - 1 - b : b;
        out[start + col * bytesPerSample + target] = src;
      }
    }
  }
  return out;
}

function lzwDecode(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let outPos = 0;
  let dict: Uint8Array[] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < 256; i += 1) dict.push(Uint8Array.of(i));
    dict.push(new Uint8Array(0), new Uint8Array(0));
  };
  reset();
  let bitPos = 0;
  let codeLen = 9;
  let prev: Uint8Array | null = null;
  const readCode = (): number => {
    let code = 0;
    for (let i = 0; i < codeLen; i += 1) {
      const byte = input[(bitPos + i) >> 3] ?? 0;
      code = (code << 1) | ((byte >> (7 - ((bitPos + i) & 7))) & 1);
    }
    bitPos += codeLen;
    return code;
  };
  while (bitPos + codeLen <= input.length * 8 && outPos < expected) {
    const code = readCode();
    if (code === 257) break;
    if (code === 256) {
      reset();
      codeLen = 9;
      prev = null;
      continue;
    }
    let entry: Uint8Array;
    if (code < dict.length) {
      entry = dict[code] as Uint8Array;
      if (prev) {
        const next = new Uint8Array(prev.length + 1);
        next.set(prev);
        next[prev.length] = entry[0] as number;
        dict.push(next);
      }
    } else if (prev) {
      entry = new Uint8Array(prev.length + 1);
      entry.set(prev);
      entry[prev.length] = prev[0] as number;
      dict.push(entry);
    } else {
      break;
    }
    out.set(entry.subarray(0, Math.min(entry.length, expected - outPos)), outPos);
    outPos += entry.length;
    prev = entry;
    if (dict.length + 1 >= 1 << codeLen && codeLen < 12) codeLen += 1;
  }
  return out;
}

function packBitsDecode(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let i = 0;
  let o = 0;
  while (i < input.length && o < expected) {
    const n = (input[i] as number) << 24 >> 24;
    i += 1;
    if (n >= 0) {
      for (let k = 0; k <= n && o < expected; k += 1) out[o++] = input[i++] as number;
    } else if (n !== -128) {
      const value = input[i++] as number;
      for (let k = 0; k < 1 - n && o < expected; k += 1) out[o++] = value;
    }
  }
  return out;
}

/** Wycinek obrazu w układzie obrazu dla prostokąta w układzie mapy (z marginesem 1 piksela). */
export function windowForBounds(
  image: TiffImage,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): { x0: number; y0: number; w: number; h: number } {
  const geo = image.geo;
  if (!geo) throw new Error('Obraz nie ma georeferencji');
  const x0 = Math.floor((bounds.minX - geo.originX) / geo.pixelWidth) - 1;
  const x1 = Math.ceil((bounds.maxX - geo.originX) / geo.pixelWidth) + 1;
  const y0 = Math.floor((geo.originY - bounds.maxY) / geo.pixelHeight) - 1;
  const y1 = Math.ceil((geo.originY - bounds.minY) / geo.pixelHeight) + 1;
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}
