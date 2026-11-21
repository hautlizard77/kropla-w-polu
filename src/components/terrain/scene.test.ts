import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TerrainResult } from '../../types/terrain';
import { autoExaggeration, makeFlowWeight } from './scene';

const base = {
  displayGrid: { width: 100, height: 100, cellSize: 5, originX: 0, originY: 0 },
  elevationRange: [100, 101] as [number, number],
  flowLines: [{ points: [], accumulationM2: [400, 4000] }],
  maxAccumulationM2: 40000,
} as unknown as TerrainResult;

test('przewyższenie rośnie dla płaskiego terenu i ma granice 1–25', () => {
  assert.equal(autoExaggeration(base), 25);
  assert.equal(autoExaggeration({ ...base, elevationRange: [100, 200] }), 1);
});

test('grubość linii spływu rośnie z akumulacją (skala logarytmiczna 0–1)', () => {
  const weight = makeFlowWeight(base);
  assert.equal(weight(400), 0);
  assert.equal(weight(40000), 1);
  assert.ok(weight(4000) > 0.4 && weight(4000) < 0.6);
});
