import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ParcelInfo, Xy } from '../../src/types/terrain';
import { computeTerrain } from './analysis';
import { accumulate, fillDepressions, findDepressions, flowDirections, slopeDegrees, type Raster } from './hydrology';

function raster(width: number, height: number, f: (x: number, y: number) => number, cellSize = 1): Raster {
  const values = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) values[y * width + x] = f(x, y);
  return { width, height, cellSize, values };
}

function pipeline(r: Raster) {
  const filled = fillDepressions(r, 1e-5);
  const dir = flowDirections(r, filled);
  return { filled, dir, ...accumulate(r, dir) };
}

test('stok opadający na wschód: spływ na wschód, akumulacja rośnie w dół stoku', () => {
  const r = raster(20, 10, (x) => 100 - x * 0.5);
  const { dir, accumulation } = pipeline(r);
  // Komórki wewnątrz kierują wodę na wschód (indeks 0) lub ukośnie na wschód (1, 7).
  for (let y = 1; y < 9; y += 1) for (let x = 1; x < 19; x += 1) assert.ok([0, 1, 7].includes(dir[y * 20 + x] as number));
  assert.ok((accumulation[5 * 20 + 18] as number) > (accumulation[5 * 20 + 2] as number));
});

test('dolina w kształcie V: spływ skupia się w osi doliny', () => {
  // Oś doliny w kolumnie 10, dno opada na południe.
  const r = raster(21, 30, (x, y) => 50 + Math.abs(x - 10) * 0.8 - y * 0.2);
  const { accumulation } = pipeline(r);
  const axis = accumulation[28 * 21 + 10] as number;
  const side = accumulation[28 * 21 + 3] as number;
  assert.ok(axis > 20 * side, `oś ${axis} vs bok ${side}`);
});

test('zagłębienie: wypełnienie podnosi dno, zastoisko ma właściwą głębokość i objętość', () => {
  // Płaski teren 10 m z misą o głębokości 0,5 m w środku (promień 4 komórki).
  const r = raster(30, 30, (x, y) => {
    const d = Math.hypot(x - 15, y - 15);
    return 10 - (d < 4 ? 0.5 * (1 - d / 4) : 0) + x * 0.001;
  });
  const flat = fillDepressions(r, 0);
  const { accumulation, dir } = pipeline(r);
  const depressions = findDepressions(r, flat, accumulation, 0.15, 3);
  assert.equal(depressions.length, 1);
  const d = depressions[0];
  assert.ok(d && Math.abs(d.maxDepth - 0.5) < 0.02, `głębokość ${d?.maxDepth}`);
  // Po wypełnieniu z ε każda komórka ma odpływ (brak „ślepych” komórek w środku).
  for (let y = 1; y < 29; y += 1) for (let x = 1; x < 29; x += 1) assert.ok((dir[y * 30 + x] as number) >= 0);
});

test('dopływ spoza rastra: stok wpadający od zachodniej krawędzi oznacza komórki w dole', () => {
  const r = raster(20, 10, (x) => 100 - x);
  const { truncated } = pipeline(r);
  // Zachodnia krawędź zbiera wodę spoza rastra, informacja płynie na wschód.
  assert.equal(truncated[5 * 20 + 0], 1);
  assert.equal(truncated[5 * 20 + 15], 1);
  // Stok opadający na zewnątrz rastra – brak dopływu spoza.
  const away = pipeline(raster(20, 10, (x) => 100 + x * 0.0 - Math.abs(x - 10)));
  assert.equal(away.truncated[5 * 20 + 10], 0);
});

test('nachylenie Horna: 10% spadku ≈ 5,7°', () => {
  const s = slopeDegrees(raster(10, 10, (x) => x * 0.1));
  assert.ok(Math.abs((s[55] as number) - 5.71) < 0.05);
});

test('analiza działki: obszar do sprawdzenia to zagłębienie, do którego spływa woda ze stoku', () => {
  // Stok opadający na południe (2%) z zagłębieniem 0,4 m w dolnej części działki.
  const width = 120;
  const height = 120;
  const originX = 450000;
  const originY = 535000;
  const values = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = Math.hypot(x - 60, y - 85);
      values[y * width + x] = 120 - y * 0.02 - (d < 8 ? 0.4 * (1 - d / 8) : 0) + Math.abs(x - 60) * 0.005;
    }
  }
  const ring: Xy[] = [
    [originX + 30, originY - 30],
    [originX + 90, originY - 30],
    [originX + 90, originY - 100],
    [originX + 30, originY - 100],
  ];
  const source = { name: 't', provider: 't', url: null, origin: 'demo' as const, retrievedAt: null, observationDate: null, resolutionM: 1, durationMs: null, notes: [] };
  const parcel: ParcelInfo = { id: 'test', ring2180: ring, ringWgs84: ring, areaHa: 0.42, voivodeship: null, county: null, commune: null, region: null, origin: 'demo', source };
  const result = computeTerrain({ parcel, values, grid: { width, height, cellSize: 1, originX, originY }, demSource: source });
  assert.ok(result.depressions.length >= 1);
  assert.equal(result.retentionCandidate?.kind, 'depression');
  const [cx, cy] = result.retentionCandidate?.at ?? [0, 0];
  assert.ok(Math.abs(cx - (originX + 60.5)) < 4 && Math.abs(cy - (originY - 85.5)) < 4, `środek ${cx}, ${cy}`);
  assert.ok(result.flowLines.length > 0);
  assert.ok(result.inflowBeyondRaster.affectsParcel, 'stok zaczyna się poza rastrem – dopływ z północy');
  assert.equal(result.erosion.soilDataAvailable, false);
  assert.equal(result.elevation.length, result.displayGrid.width * result.displayGrid.height);
});
