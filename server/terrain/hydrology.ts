/**
 * Analiza hydrologiczna rastra wysokości (bez zewnętrznych bibliotek).
 *
 * 1. Wypełnienie zagłębień: Priority-Flood (Barnes, Lehman, Mulla 2014), wariant „+ε” do wyznaczenia
 *    kierunków spływu oraz wariant bez ε do oceny głębokości zagłębień (potencjalnych zastoisk).
 * 2. Kierunek spływu D8 (O'Callaghan i Mark 1984) – najbardziej strome zejście do jednego z 8 sąsiadów.
 * 3. Akumulacja spływu – liczba komórek zasilających × pole komórki (m²).
 * 4. Oznaczenie dopływu spoza rastra – komórki brzegowe, z których woda płynie do środka, mogą zbierać
 *    wodę spoza pobranego obszaru; informację propagujemy w dół spływu.
 *
 * GRASS r.watershed domyślnie używa wielokierunkowego spływu (MFD) z algorytmem A*; tutaj stosujemy
 * jednokierunkowy D8 – linie spływu są wyraźniejsze, ale rozpraszanie wody na stokach jest pominięte.
 */

/** Przesunięcia 8 sąsiadów: E, SE, S, SW, W, NW, N, NE (wiersze rosną na południe). */
export const DX = [1, 1, 0, -1, -1, -1, 0, 1];
export const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const DIST = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];

export const DIR_OUTLET = -1;
export const DIR_NODATA = -2;

export interface Raster {
  width: number;
  height: number;
  cellSize: number;
  values: Float64Array;
}

/** Kopiec binarny min (wysokość, indeks) – kolejka priorytetowa dla Priority-Flood. */
class MinHeap {
  private keys = new Float64Array(1024);
  private items = new Int32Array(1024);
  size = 0;

  push(key: number, item: number): void {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      keys.set(this.keys);
      this.keys = keys;
      const items = new Int32Array(this.size * 2);
      items.set(this.items);
      this.items = items;
    }
    let i = this.size;
    this.size += 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.keys[parent] as number) <= key) break;
      this.keys[i] = this.keys[parent] as number;
      this.items[i] = this.items[parent] as number;
      i = parent;
    }
    this.keys[i] = key;
    this.items[i] = item;
  }

  pop(): number {
    const top = this.items[0] as number;
    this.size -= 1;
    const key = this.keys[this.size] as number;
    const item = this.items[this.size] as number;
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && (this.keys[child + 1] as number) < (this.keys[child] as number)) child += 1;
      if ((this.keys[child] as number) >= key) break;
      this.keys[i] = this.keys[child] as number;
      this.items[i] = this.items[child] as number;
      i = child;
    }
    this.keys[i] = key;
    this.items[i] = item;
    return top;
  }
}

function isEdge(index: number, width: number, height: number, values: Float64Array): boolean {
  const x = index % width;
  const y = (index - x) / width;
  if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true;
  for (let k = 0; k < 8; k += 1) {
    if (Number.isNaN(values[(y + (DY[k] as number)) * width + x + (DX[k] as number)] as number)) return true;
  }
  return false;
}

/**
 * Priority-Flood. Przy epsilon > 0 każda komórka jest wyższa od tej, z której została osiągnięta,
 * dzięki czemu z każdego zagłębienia i płaskiego terenu istnieje spadek do krawędzi.
 */
export function fillDepressions(raster: Raster, epsilon = 0): Float64Array {
  const { width, height, values } = raster;
  const n = width * height;
  const filled = Float64Array.from(values);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  for (let i = 0; i < n; i += 1) {
    if (Number.isNaN(values[i] as number)) {
      closed[i] = 1;
      continue;
    }
    if (isEdge(i, width, height, values)) {
      closed[i] = 1;
      heap.push(filled[i] as number, i);
    }
  }
  while (heap.size > 0) {
    const c = heap.pop();
    const cx = c % width;
    const cy = (c - cx) / width;
    const cz = filled[c] as number;
    for (let k = 0; k < 8; k += 1) {
      const nx = cx + (DX[k] as number);
      const ny = cy + (DY[k] as number);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (closed[ni]) continue;
      closed[ni] = 1;
      const nz = filled[ni] as number;
      const minimum = epsilon > 0 ? cz + epsilon * (DIST[k] as number) : cz;
      if (nz <= minimum) filled[ni] = minimum;
      heap.push(filled[ni] as number, ni);
    }
  }
  return filled;
}

/** Kierunek D8 na terenie po wypełnieniu (indeks sąsiada 0–7, DIR_OUTLET albo DIR_NODATA). */
export function flowDirections(raster: Raster, filled: Float64Array): Int8Array {
  const { width, height, values } = raster;
  const dir = new Int8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (Number.isNaN(values[i] as number)) {
        dir[i] = DIR_NODATA;
        continue;
      }
      const z = filled[i] as number;
      let best = DIR_OUTLET;
      let bestSlope = 0;
      let touchesOutside = false;
      for (let k = 0; k < 8; k += 1) {
        const nx = x + (DX[k] as number);
        const ny = y + (DY[k] as number);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          touchesOutside = true;
          continue;
        }
        const ni = ny * width + nx;
        if (Number.isNaN(values[ni] as number)) {
          touchesOutside = true;
          continue;
        }
        const slope = (z - (filled[ni] as number)) / (DIST[k] as number);
        if (slope > bestSlope) {
          bestSlope = slope;
          best = k;
        }
      }
      // Brak spadku do sąsiada: na krawędzi woda odpływa poza raster, w środku (nie powinno wystąpić po +ε) – ujście.
      dir[i] = best >= 0 || !touchesOutside ? best : DIR_OUTLET;
    }
  }
  return dir;
}

export function downstreamIndex(index: number, dir: number, width: number): number {
  const x = index % width;
  const y = (index - x) / width;
  return (y + (DY[dir] as number)) * width + x + (DX[dir] as number);
}

/**
 * Akumulacja spływu (m²) i flaga możliwego dopływu spoza rastra.
 * Kolejność topologiczna (algorytm Kahna) – liniowa względem liczby komórek.
 */
export function accumulate(raster: Raster, dir: Int8Array): { accumulation: Float64Array; truncated: Uint8Array } {
  const { width, height, values, cellSize } = raster;
  const n = width * height;
  const cellArea = cellSize * cellSize;
  const indegree = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const d = dir[i] as number;
    if (d >= 0) indegree[downstreamIndex(i, d, width)] += 1;
  }
  const accumulation = new Float64Array(n);
  const truncated = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i += 1) {
    if (dir[i] === DIR_NODATA) continue;
    accumulation[i] = cellArea;
    // Komórka brzegowa, z której woda płynie do środka rastra, mogła zbierać wodę spoza pobranego obszaru.
    if ((dir[i] as number) >= 0 && isEdge(i, width, height, values)) truncated[i] = 1;
    if (indegree[i] === 0) queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++] as number;
    const d = dir[i] as number;
    if (d < 0) continue;
    const j = downstreamIndex(i, d, width);
    accumulation[j] = (accumulation[j] as number) + (accumulation[i] as number);
    if (truncated[i]) truncated[j] = 1;
    indegree[j] = (indegree[j] as number) - 1;
    if (indegree[j] === 0) queue[tail++] = j;
  }
  return { accumulation, truncated };
}

/** Nachylenie w stopniach (metoda Horna). Brakujących sąsiadów zastępujemy wartością komórki środkowej. */
export function slopeDegrees(raster: Raster): Float64Array {
  const { width, height, values, cellSize } = raster;
  const out = new Float64Array(width * height).fill(Number.NaN);
  const at = (x: number, y: number, fallback: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return fallback;
    const v = values[y * width + x] as number;
    return Number.isNaN(v) ? fallback : v;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const z = values[y * width + x] as number;
      if (Number.isNaN(z)) continue;
      const a = at(x - 1, y - 1, z);
      const b = at(x, y - 1, z);
      const c = at(x + 1, y - 1, z);
      const d = at(x - 1, y, z);
      const f = at(x + 1, y, z);
      const g = at(x - 1, y + 1, z);
      const h = at(x, y + 1, z);
      const i = at(x + 1, y + 1, z);
      const dzdx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * cellSize);
      const dzdy = (g + 2 * h + i - (a + 2 * b + c)) / (8 * cellSize);
      out[y * width + x] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
    }
  }
  return out;
}

export interface DepressionCells {
  id: number;
  cells: number[];
  maxDepth: number;
  volume: number;
  /** Komórka zagłębienia z największą akumulacją – miejsce zbierania wody. */
  collector: number;
}

/** Spójne obszary, w których teren po wypełnieniu (bez ε) jest wyżej od oryginału o co najmniej minDepth. */
export function findDepressions(
  raster: Raster,
  filledFlat: Float64Array,
  accumulation: Float64Array,
  minDepth: number,
  minCells: number,
): DepressionCells[] {
  const { width, height, values, cellSize } = raster;
  const n = width * height;
  const label = new Int32Array(n).fill(-1);
  const result: DepressionCells[] = [];
  const stack: number[] = [];
  for (let start = 0; start < n; start += 1) {
    const depth0 = (filledFlat[start] as number) - (values[start] as number);
    if (label[start] !== -1 || !(depth0 >= minDepth)) continue;
    const id = result.length;
    const cells: number[] = [];
    let maxDepth = 0;
    let volume = 0;
    let collector = start;
    stack.push(start);
    label[start] = id;
    while (stack.length > 0) {
      const c = stack.pop() as number;
      cells.push(c);
      const depth = (filledFlat[c] as number) - (values[c] as number);
      maxDepth = Math.max(maxDepth, depth);
      volume += depth * cellSize * cellSize;
      if ((accumulation[c] as number) > (accumulation[collector] as number)) collector = c;
      const cx = c % width;
      const cy = (c - cx) / width;
      for (let k = 0; k < 8; k += 1) {
        const nx = cx + (DX[k] as number);
        const ny = cy + (DY[k] as number);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (label[ni] !== -1) continue;
        // Komórki z jakimkolwiek wypełnieniem (> 1 cm) należą do tego samego zagłębienia.
        if ((filledFlat[ni] as number) - (values[ni] as number) > 0.01) {
          label[ni] = id;
          stack.push(ni);
        }
      }
    }
    if (cells.length >= minCells) result.push({ id, cells, maxDepth, volume, collector });
  }
  return result.map((item, index) => ({ ...item, id: index }));
}
