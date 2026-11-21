import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mosaic, splitBounds } from './nmt';

test('mały obszar nie jest dzielony, duży dzielony na części z zakładką', () => {
  assert.equal(splitBounds({ minX: 0, minY: 0, maxX: 400, maxY: 400 }).length, 1);
  const tiles = splitBounds({ minX: 1000, minY: 2000, maxX: 2200, maxY: 3200 });
  assert.equal(tiles.length, 4);
  for (const t of tiles) {
    assert.ok(t.minX >= 1000 && t.maxX <= 2200 && t.minY >= 2000 && t.maxY <= 3200);
  }
  // Części razem pokrywają cały obszar, sąsiednie zachodzą na siebie.
  const xs = tiles.filter((t) => t.minY === 2000).sort((a, b) => a.minX - b.minX);
  assert.ok(xs[0]!.maxX > xs[1]!.minX);
  assert.equal(splitBounds({ minX: 0, minY: 0, maxX: 5000, maxY: 5000 }).length, 9);
});

test('mozaika skleja części według georeferencji', () => {
  const grid = (originX: number, originY: number, width: number, height: number) => ({ width, height, cellSize: 1, originX, originY });
  const fill = (n: number, v: number) => new Float64Array(n).fill(v);
  // Dwie części 4×2 obok siebie z zakładką 1 kolumny.
  const left = { values: fill(8, 1), grid: grid(0, 2, 4, 2) };
  const right = { values: fill(8, 2), grid: grid(3, 2, 4, 2) };
  const m = mosaic([left, right]);
  assert.equal(m.grid.width, 7);
  assert.equal(m.grid.height, 2);
  assert.deepEqual(Array.from(m.values.subarray(0, 7)), [1, 1, 1, 1, 2, 2, 2]);
  assert.ok(!m.values.some((v) => Number.isNaN(v)));
});
