/**
 * Numeryczny Model Terenu z Geoportalu (GUGiK) – usługa WCS zwracająca GeoTIFF.
 * Pobieramy wycinek w natywnej rozdzielczości usługi (GRID1 – siatka 1 m), w układzie EPSG:2180.
 */
import type { GridSpec, SourceInfo } from '../../src/types/terrain';
import type { Bounds } from '../geo/geometry';
import { BufferSource, Tiff } from '../geo/tiff';
import { errorText } from './uldk';
import { cacheGet, cacheSet } from '../cache';

export const NMT_WCS_URL =
  'https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WCS/DigitalTerrainModelFormatTIFF';
export const NMT_COVERAGE_ID = 'DTM_PL-KRON86-NH_TIFF';
const TIMEOUT_MS = Number(process.env.KROPLA_NMT_TIMEOUT_MS ?? 120000);

export interface DemRaster {
  values: Float64Array;
  grid: GridSpec;
  source: SourceInfo;
}

export class NmtError extends Error {}

interface Variant {
  id: string;
  label: string;
  url: (b: Bounds) => string;
}

// WCS 2.0.1: osie w kolejności EPSG:2180 (x = północ, y = wschód) albo odwrotnie – usługa bywa niekonsekwentna.
const VARIANTS: Variant[] = [
  { id: 'wcs20-ne', label: 'WCS 2.0.1 (x=N, y=E)', url: (b) => wcs20(b, 'x', 'y', true) },
  { id: 'wcs20-en', label: 'WCS 2.0.1 (x=E, y=N)', url: (b) => wcs20(b, 'x', 'y', false) },
  { id: 'wcs10', label: 'WCS 1.0.0', url: (b) => wcs10(b) },
];

/** Powyżej tylu komórek (1 m²) obszar dzielimy na części pobierane równolegle. */
const TILE_THRESHOLD_CELLS = 250_000;
const TILE_TARGET_SIDE_M = 600;
const TILE_OVERLAP_M = 4;

let preferredVariant: string | null | undefined;

async function knownVariant(): Promise<Variant | null> {
  if (preferredVariant === undefined) {
    const stored = await cacheGet<{ id: string }>('nmt-meta', 'variant');
    preferredVariant = stored?.id ?? null;
  }
  return VARIANTS.find((v) => v.id === preferredVariant) ?? null;
}

async function rememberVariant(variant: Variant | null): Promise<void> {
  preferredVariant = variant?.id ?? null;
  if (variant) await cacheSet('nmt-meta', 'variant', { id: variant.id });
}

type Raster = { values: Float64Array; grid: GridSpec };

export async function fetchNmt(bounds: Bounds): Promise<DemRaster> {
  const started = Date.now();
  const b = {
    minX: Math.floor(bounds.minX),
    minY: Math.floor(bounds.minY),
    maxX: Math.ceil(bounds.maxX),
    maxY: Math.ceil(bounds.maxY),
  };
  const errors: string[] = [];

  // 1. Znany działający wariant zapytania – duży obszar pobieramy w częściach równolegle.
  const known = await knownVariant();
  if (known) {
    const tiles = splitBounds(b);
    try {
      const raster =
        tiles.length > 1
          ? mosaic(await Promise.all(tiles.map((t) => fetchOne(known, t, AbortSignal.timeout(TIMEOUT_MS)))))
          : await fetchOne(known, b, AbortSignal.timeout(TIMEOUT_MS));
      return result(raster, known, tiles.length, started);
    } catch (error) {
      errors.push(`${known.label}${tiles.length > 1 ? ` (${tiles.length} części)` : ''}: ${errorText(error)}`);
      await rememberVariant(null);
    }
  }

  // 2. Wariant nieznany albo przestał działać – wszystkie warianty naraz, wygrywa pierwszy poprawny.
  const controllers = VARIANTS.map(() => new AbortController());
  try {
    const { raster, variant } = await Promise.any(
      VARIANTS.map(async (variant, i) => {
        const signal = AbortSignal.any([controllers[i]!.signal, AbortSignal.timeout(TIMEOUT_MS)]);
        try {
          return { raster: await fetchOne(variant, b, signal), variant };
        } catch (error) {
          errors.push(`${variant.label}: ${errorText(error)}`);
          throw error;
        }
      }),
    );
    controllers.forEach((c) => c.abort());
    await rememberVariant(variant);
    return result(raster, variant, 1, started);
  } catch {
    throw new NmtError(`Nie udało się pobrać NMT z Geoportalu. ${errors.join(' | ')}`);
  }
}

async function fetchOne(variant: Variant, b: Bounds, signal: AbortSignal): Promise<Raster> {
  const response = await fetch(variant.url(b), { signal });
  const contentType = response.headers.get('content-type') ?? '';
  const data = new Uint8Array(await response.arrayBuffer());
  if (!response.ok || !looksLikeTiff(data)) throw new NmtError(`${response.status} ${contentType} ${preview(data)}`);
  const raster = await decode(data, b);
  if (!raster) throw new NmtError('zwrócony raster nie obejmuje działki');
  return raster;
}

/** Dzieli prostokąt na siatkę części (maks. 3 × 3) z małą zakładką, żeby nie powstały szczeliny. */
export function splitBounds(b: Bounds): Bounds[] {
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  if (width * height <= TILE_THRESHOLD_CELLS) return [b];
  const cols = Math.min(3, Math.max(1, Math.round(width / TILE_TARGET_SIDE_M)));
  const rows = Math.min(3, Math.max(1, Math.round(height / TILE_TARGET_SIDE_M)));
  if (cols * rows === 1) return [b];
  const tiles: Bounds[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      tiles.push({
        minX: Math.max(b.minX, Math.floor(b.minX + (width * c) / cols) - TILE_OVERLAP_M),
        maxX: Math.min(b.maxX, Math.ceil(b.minX + (width * (c + 1)) / cols) + TILE_OVERLAP_M),
        minY: Math.max(b.minY, Math.floor(b.minY + (height * r) / rows) - TILE_OVERLAP_M),
        maxY: Math.min(b.maxY, Math.ceil(b.minY + (height * (r + 1)) / rows) + TILE_OVERLAP_M),
      });
    }
  }
  return tiles;
}

/** Skleja części w jeden raster według ich georeferencji. */
export function mosaic(parts: Raster[]): Raster {
  const first = parts[0];
  if (!first) throw new NmtError('brak części rastra');
  const cs = first.grid.cellSize;
  if (parts.some((p) => Math.abs(p.grid.cellSize - cs) > 1e-6)) throw new NmtError('części mają różną rozdzielczość');
  const originX = Math.min(...parts.map((p) => p.grid.originX));
  const originY = Math.max(...parts.map((p) => p.grid.originY));
  const maxX = Math.max(...parts.map((p) => p.grid.originX + p.grid.width * cs));
  const minY = Math.min(...parts.map((p) => p.grid.originY - p.grid.height * cs));
  const width = Math.round((maxX - originX) / cs);
  const height = Math.round((originY - minY) / cs);
  const values = new Float64Array(width * height).fill(Number.NaN);
  for (const part of parts) {
    const col0 = Math.round((part.grid.originX - originX) / cs);
    const row0 = Math.round((originY - part.grid.originY) / cs);
    for (let r = 0; r < part.grid.height; r += 1) {
      const target = (row0 + r) * width + col0;
      const source = r * part.grid.width;
      for (let c = 0; c < part.grid.width; c += 1) {
        const v = part.values[source + c] as number;
        if (!Number.isNaN(v) && Number.isNaN(values[target + c] as number)) values[target + c] = v;
      }
    }
  }
  return { values, grid: { width, height, cellSize: cs, originX, originY } };
}

function result(raster: Raster, variant: Variant, parts: number, started: number): DemRaster {
  return {
    ...raster,
    source: {
      name: 'Numeryczny Model Terenu (NMT), wysokości normalne Kronsztadt86',
      provider: 'GUGiK – Geoportal, usługa WCS (PZGIK NMT GRID1)',
      url: NMT_WCS_URL,
      origin: 'observed',
      retrievedAt: new Date().toISOString(),
      observationDate: null,
      resolutionM: raster.grid.cellSize,
      durationMs: Date.now() - started,
      notes: [
        `Wycinek ${raster.grid.width} × ${raster.grid.height} komórek w natywnej rozdzielczości usługi.`,
        `Zapytanie: ${variant.label}${parts > 1 ? `, ${parts} części pobrane równolegle` : ''}.`,
        'Data pomiaru lotniczego (LiDAR) różni się między obszarami; usługa jej nie zwraca.',
      ],
    },
  };
}

function wcs20(b: Bounds, axisA: string, axisB: string, aIsNorthing: boolean): string {
  const a = aIsNorthing ? `${axisA}(${b.minY},${b.maxY})` : `${axisA}(${b.minX},${b.maxX})`;
  const c = aIsNorthing ? `${axisB}(${b.minX},${b.maxX})` : `${axisB}(${b.minY},${b.maxY})`;
  return (
    `${NMT_WCS_URL}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=${NMT_COVERAGE_ID}` +
    `&FORMAT=image/tiff&SUBSET=${a}&SUBSET=${c}`
  );
}

function wcs10(b: Bounds): string {
  const width = Math.max(1, Math.round(b.maxX - b.minX));
  const height = Math.max(1, Math.round(b.maxY - b.minY));
  return (
    `${NMT_WCS_URL}?SERVICE=WCS&VERSION=1.0.0&REQUEST=GetCoverage&COVERAGE=${NMT_COVERAGE_ID}` +
    `&CRS=EPSG:2180&RESPONSE_CRS=EPSG:2180&BBOX=${b.minX},${b.minY},${b.maxX},${b.maxY}` +
    `&WIDTH=${width}&HEIGHT=${height}&FORMAT=image/tiff`
  );
}

function looksLikeTiff(data: Uint8Array): boolean {
  return data.length > 8 && ((data[0] === 0x49 && data[1] === 0x49) || (data[0] === 0x4d && data[1] === 0x4d));
}

function preview(data: Uint8Array): string {
  return new TextDecoder().decode(data.subarray(0, 160)).replace(/\s+/g, ' ');
}

/** Dekoduje GeoTIFF i sprawdza, czy obejmuje żądany obszar (wykrywa zamienione osie). */
async function decode(data: Uint8Array, wanted: Bounds): Promise<{ values: Float64Array; grid: GridSpec } | null> {
  const tiff = await Tiff.open(new BufferSource(data));
  const image = tiff.main;
  const geo = image.geo;
  if (!geo) throw new Error('GeoTIFF z NMT nie ma georeferencji');
  const maxX = geo.originX + image.width * geo.pixelWidth;
  const minY = geo.originY - image.height * geo.pixelHeight;
  const centerX = (wanted.minX + wanted.maxX) / 2;
  const centerY = (wanted.minY + wanted.maxY) / 2;
  if (centerX < geo.originX || centerX > maxX || centerY < minY || centerY > geo.originY) return null;
  const values = await tiff.readWindow(0, 0, image.width, image.height);
  // Usługa oznacza brak danych dużymi ujemnymi wartościami – traktujemy je jako brak.
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (!Number.isFinite(v) || v < -1000 || v > 3000) values[i] = Number.NaN;
  }
  return {
    values,
    grid: {
      width: image.width,
      height: image.height,
      cellSize: geo.pixelWidth,
      originX: geo.originX,
      originY: geo.originY,
    },
  };
}
