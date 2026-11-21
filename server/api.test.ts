import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.KROPLA_CACHE_DIR = mkdtempSync(join(tmpdir(), 'kropla-test-'));
const { ndmi, terrain } = await import('./api');

test('teren działki demonstracyjnej: wynik oznaczony jako demo, drugi odczyt z bufora', async () => {
  const first = await terrain('040705_5.0012.245/3');
  assert.equal(first.status, 'ok');
  if (first.status !== 'ok') return;
  assert.equal(first.result.origin, 'demo');
  assert.equal(first.result.cached, false);
  assert.ok(first.result.flowLines.length > 0);
  assert.ok(first.result.retentionCandidate);
  const second = await terrain('040705_5.0012.245/3');
  assert.equal(second.status, 'ok');
  if (second.status === 'ok') assert.equal(second.result.cached, true);
});

test('NDMI w trybie demo: przypadek zachmurzenia nie zwraca sceny, ale podaje sprawdzone sceny', async () => {
  await terrain('302005_2.0015.88/2');
  const response = await ndmi('302005_2.0015.88/2', '2024-08-08');
  assert.equal(response.status, 'ok');
  if (response.status !== 'ok') return;
  assert.equal(response.result.scene, null);
  assert.ok(response.result.checkedScenes.length > 0);
  assert.match(response.result.message, /wystarczającym pokryciem/);
});
