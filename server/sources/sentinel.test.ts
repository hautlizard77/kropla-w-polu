import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ParcelInfo, Xy } from '../../src/types/terrain';
import { utmNorth } from '../geo/proj';
import { buildResult, minusDays, selectScenes, warsawDate } from './sentinel';

test('sceny późniejsze niż data analizy są pomijane (dzień liczony w Polsce)', () => {
  const items = [
    { id: 'a', properties: { datetime: '2024-06-30T09:56:00Z' } },
    { id: 'b', properties: { datetime: '2024-07-01T09:56:00Z' } },
    { id: 'c', properties: { datetime: '2024-06-20T09:56:00Z' } },
    // 23:30 UTC 30.06 to już 1 lipca w Polsce – po dacie analizy.
    { id: 'd', properties: { datetime: '2024-06-30T23:30:00Z' } },
  ];
  assert.deepEqual(selectScenes(items, '2024-06-30').map((i) => i.id), ['a', 'c']);
  assert.equal(warsawDate('2024-06-30T23:30:00Z'), '2024-07-01');
  assert.equal(minusDays('2024-03-01', 1), '2024-02-29');
});

test('NDMI: statystyki działki, odchylenia i przeniesienie na siatkę EPSG:2180', () => {
  const projection = utmNorth(34);
  // Działka ok. 200 × 200 m w strefie 34 (okolice Warszawy).
  const center = projection.forward([21.0, 52.2]);
  const ringUtm: Xy[] = [
    [center[0] - 100, center[1] - 100],
    [center[0] + 100, center[1] - 100],
    [center[0] + 100, center[1] + 100],
    [center[0] - 100, center[1] + 100],
  ];
  const ringWgs84 = ringUtm.map((p) => projection.inverse(p));
  const window = { x0: 0, y0: 0, w: 14, h: 14, originX: center[0] - 140, originY: center[1] + 140, pixel: 20 };
  const ndmi = new Float64Array(14 * 14).fill(0.3);
  ndmi[7 * 14 + 7] = 0.05; // jeden piksel wyraźnie suchszy
  ndmi[6 * 14 + 6] = Number.NaN; // piksel zamaskowany (chmura)
  const parcelPixels: number[] = [];
  for (let r = 0; r < 14; r += 1) for (let c = 0; c < 14; c += 1) {
    const x = window.originX + (c + 0.5) * 20;
    const y = window.originY - (r + 0.5) * 20;
    if (x > ringUtm[0]![0] && x < ringUtm[1]![0] && y > ringUtm[0]![1] && y < ringUtm[2]![1]) parcelPixels.push(r * 14 + c);
  }
  // Siatka wyświetlania jest tu poza działką – test sprawdza statystyki pikseli 20 m.
  const ring2180 = ringWgs84;
  const parcel = { id: 't', ring2180, ringWgs84, areaHa: 4, voivodeship: null, county: null, commune: null, region: null, origin: 'observed', source: {} } as unknown as ParcelInfo;
  const result = buildResult({
    parcel,
    analysisDate: '2024-06-30',
    displayGrid: { width: 2, height: 2, cellSize: 10, originX: 0, originY: 0 },
    ndmi,
    window,
    projection,
    ringUtm,
    parcelPixels,
    chosen: { id: 's', datetime: '2024-06-29T10:00:00Z', date: '2024-06-29', cloudCoverPct: 10, usefulCoveragePct: 99 },
    checked: [],
    sources: [],
    timings: [],
    origin: 'observed',
  });
  assert.equal(parcelPixels.length, 100);
  assert.equal(result.stats?.validPixels, 99);
  assert.equal(result.stats?.median, 0.3);
  assert.equal(result.stats?.deviatingPixelsPct, 1);
  assert.equal(result.resolutionM, 20);
  assert.match(result.message, /miejsca do sprawdzenia w terenie/);
});
