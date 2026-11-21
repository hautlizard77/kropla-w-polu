import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchNmtPoints, parsePointList, pointGrid, pointStep } from './nmtPoints';

test('krok siatki rośnie z wielkością obszaru, liczba punktów zostaje w limicie', () => {
  assert.equal(pointStep({ minX: 0, minY: 0, maxX: 150, maxY: 150 }), 2);
  assert.equal(pointStep({ minX: 0, minY: 0, maxX: 320, maxY: 330 }), 4);
  for (const side of [150, 400, 900, 1600, 3000]) {
    const b = { minX: 0, minY: 0, maxX: side, maxY: side };
    const { points } = pointGrid(b, pointStep(b));
    assert.ok(points.length <= 7_000 || pointStep(b) === 15, `bok ${side} m: ${points.length} punktów`);
  }
});

test('środki komórek siatki leżą w punktach wysłanych do usługi', () => {
  const { grid, points } = pointGrid({ minX: 1000.4, minY: 2000, maxX: 1010, maxY: 2009.6 }, 3);
  assert.equal(points.length, grid.width * grid.height);
  const [e, n] = points[grid.width + 1]!; // wiersz 1, kolumna 1
  assert.equal(grid.originX + 1.5 * grid.cellSize, e);
  assert.equal(grid.originY - 1.5 * grid.cellSize, n);
});

test('odpowiedź „x y h” (x = północ) trafia do właściwych punktów', () => {
  const points: [number, number][] = [[453224, 535276], [453227, 535276]];
  const values = parsePointList('535276 453227 81.4,535276 453224 80.9', points);
  assert.deepEqual(Array.from(values), [80.9, 81.4]);
  const none = parsePointList('535276 453224,535276 453227', points);
  assert.ok(none.every((v) => Number.isNaN(v)));
});

test('pobranie ponawia paczkę zwróconą bez wysokości i składa raster', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls += 1;
    const list = new URLSearchParams(String(init?.body)).get('list') ?? '';
    // Pierwsze zapytanie: przeciążona usługa – same współrzędne.
    const body = list
      .split(',')
      .map((p) => (calls === 1 ? p : `${p} ${(100 + Number(p.split(' ')[1]) / 1000).toFixed(1)}`))
      .join(',');
    return new Response(body);
  }) as typeof fetch;
  try {
    const dem = await fetchNmtPoints({ minX: 453200, minY: 535000, maxX: 453300, maxY: 535100 });
    assert.equal(dem.grid.cellSize, 2);
    assert.equal(dem.values.length, dem.grid.width * dem.grid.height);
    assert.ok(dem.values.every((v) => Number.isFinite(v)));
    assert.ok(calls > Math.ceil(dem.values.length / 1000), 'pierwsza paczka powinna być ponowiona');
  } finally {
    globalThis.fetch = realFetch;
  }
});
