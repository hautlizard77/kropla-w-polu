/**
 * Wspólna logika widoków terenu 2D i 3D: kolory warstw, przeliczenie współrzędnych i budowa geometrii.
 * Bez zależności od WebGL – można ją testować i używać przy rysowaniu na płótnie 2D.
 */
import type { NdmiResult, TerrainResult, Xy } from '../../types/terrain';

export type SurfaceMode = 'elevation' | 'ndmi' | 'erosion';

export interface Layers {
  flow: boolean;
  depressions: boolean;
  retention: boolean;
}

export type Rgb = [number, number, number];

const ELEVATION_STOPS: [number, Rgb][] = [
  [0, [0.86, 0.93, 0.87]],
  [0.35, [0.75, 0.86, 0.69]],
  [0.7, [0.86, 0.83, 0.62]],
  [1, [0.78, 0.68, 0.53]],
];

export const SLOPE_COLORS: Rgb[] = [
  [0.91, 0.96, 0.93],
  [0.78, 0.9, 0.76],
  [0.95, 0.85, 0.55],
  [0.91, 0.65, 0.36],
  [0.78, 0.33, 0.24],
];

export const SLOPE_LABELS = ['do 2°', '2–5°', '5–10°', '10–15°', 'ponad 15°'];

const NDMI_STOPS: [number, Rgb][] = [
  [-0.3, [0.6, 0.38, 0.12]],
  [-0.1, [0.85, 0.7, 0.42]],
  [0.05, [0.96, 0.92, 0.79]],
  [0.2, [0.5, 0.8, 0.76]],
  [0.45, [0.0, 0.47, 0.42]],
];

export const NDMI_LEGEND = NDMI_STOPS.map(([value, color]) => ({ value, color }));
export const NO_DATA: Rgb = [0.82, 0.83, 0.85];
export const FLOW_COLOR: Rgb = [0.04, 0.31, 0.57];
export const BOUNDARY_COLOR: Rgb = [0.07, 0.19, 0.31];
export const RETENTION_COLOR: Rgb = [0.88, 0.48, 0.0];
export const DEPRESSION_COLOR: Rgb = [0.12, 0.44, 0.66];
export const DEVIATION_COLOR: Rgb = [0.62, 0.12, 0.47];

function ramp(stops: [number, Rgb][], t: number): Rgb {
  if (t <= (stops[0] as [number, Rgb])[0]) return (stops[0] as [number, Rgb])[1];
  for (let i = 1; i < stops.length; i += 1) {
    const [t1, c1] = stops[i] as [number, Rgb];
    const [t0, c0] = stops[i - 1] as [number, Rgb];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return (stops[stops.length - 1] as [number, Rgb])[1];
}

export function cssColor([r, g, b]: Rgb): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

/** Kolor komórki siatki wyświetlania w danym trybie (przed cieniowaniem). */
export function cellColor(
  terrain: TerrainResult,
  ndmi: NdmiResult | null,
  mode: SurfaceMode,
  layers: Layers,
  index: number,
): Rgb {
  let color: Rgb;
  const z = terrain.elevation[index];
  if (z === null || z === undefined) return NO_DATA;
  if (mode === 'ndmi') {
    const v = ndmi?.values[index];
    color = v === null || v === undefined ? NO_DATA : ramp(NDMI_STOPS, v);
    if (ndmi?.deviationMask[index]) color = mix(color, DEVIATION_COLOR, 0.55);
  } else if (mode === 'erosion') {
    const cls = terrain.slopeClass[index];
    color = cls === null || cls === undefined ? NO_DATA : (SLOPE_COLORS[cls] as Rgb);
  } else {
    const [lo, hi] = terrain.elevationRange;
    color = ramp(ELEVATION_STOPS, hi > lo ? (z - lo) / (hi - lo) : 0.5);
  }
  if (layers.depressions && terrain.depressionMask[index]) color = mix(color, DEPRESSION_COLOR, 0.5);
  return color;
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Położenie punktu EPSG:2180 na siatce wyświetlania (kolumna i wiersz środków komórek, ułamkowe). */
export function toGrid(terrain: TerrainResult, [x, y]: Xy): Xy {
  const g = terrain.displayGrid;
  return [(x - g.originX) / g.cellSize - 0.5, (g.originY - y) / g.cellSize - 0.5];
}

/** Wysokość w punkcie siatki (interpolacja dwuliniowa, braki zastąpione najniższą wysokością). */
export function heightAt(terrain: TerrainResult, col: number, row: number): number {
  const g = terrain.displayGrid;
  const c0 = Math.max(0, Math.min(g.width - 1, Math.floor(col)));
  const r0 = Math.max(0, Math.min(g.height - 1, Math.floor(row)));
  const c1 = Math.min(g.width - 1, c0 + 1);
  const r1 = Math.min(g.height - 1, r0 + 1);
  const fx = Math.max(0, Math.min(1, col - c0));
  const fy = Math.max(0, Math.min(1, row - r0));
  const z = (c: number, r: number) => terrain.elevation[r * g.width + c] ?? terrain.elevationRange[0];
  const top = z(c0, r0) * (1 - fx) + z(c1, r0) * fx;
  const bottom = z(c0, r1) * (1 - fx) + z(c1, r1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Względna koncentracja spływu 0–1 (skala logarytmiczna od progu linii do największej akumulacji). */
export function makeFlowWeight(terrain: TerrainResult): (accumulation: number) => number {
  let minAcc = Infinity;
  for (const line of terrain.flowLines) for (const a of line.accumulationM2) if (a < minAcc) minAcc = a;
  const min = Math.log10(Math.max(1, Number.isFinite(minAcc) ? minAcc : 1));
  const max = Math.log10(Math.max(10, terrain.maxAccumulationM2));
  return (accumulation: number) => {
    const v = Math.log10(Math.max(1, accumulation));
    return Math.max(0, Math.min(1, (v - min) / Math.max(0.001, max - min)));
  };
}

/** Cieniowanie stoku (oświetlenie z północnego zachodu) dla widoku 2D, 0.55–1.1. */
export function hillshade(terrain: TerrainResult, index: number, exaggeration = 3): number {
  const g = terrain.displayGrid;
  const col = index % g.width;
  const row = (index - col) / g.width;
  const z = (c: number, r: number) => {
    const cc = Math.max(0, Math.min(g.width - 1, c));
    const rr = Math.max(0, Math.min(g.height - 1, r));
    return terrain.elevation[rr * g.width + cc] ?? terrain.elevation[index] ?? 0;
  };
  const dzdx = ((z(col + 1, row) - z(col - 1, row)) * exaggeration) / (2 * g.cellSize);
  const dzdy = ((z(col, row + 1) - z(col, row - 1)) * exaggeration) / (2 * g.cellSize);
  // Normalna powierzchni i światło z NW, 45° nad horyzontem.
  const nx = -dzdx;
  const ny = dzdy;
  const nz = 1;
  const len = Math.hypot(nx, ny, nz);
  const light = [-0.5, 0.5, 0.707];
  const dot = (nx * (light[0] as number) + ny * (light[1] as number) + nz * (light[2] as number)) / len;
  return 0.55 + 0.55 * Math.max(0, dot);
}

/** Automatyczne przewyższenie: rzeźba ma zajmować ok. 12% szerokości widoku (od 1× do 25×). */
export function autoExaggeration(terrain: TerrainResult): number {
  const g = terrain.displayGrid;
  const extent = Math.max(g.width, g.height) * g.cellSize;
  const relief = Math.max(0.1, terrain.elevationRange[1] - terrain.elevationRange[0]);
  return Math.max(1, Math.min(25, Math.round((extent * 0.12) / relief)));
}
