/**
 * Test na zapisanych danych z prawdziwych usług (validation/cache/, pobrane 22.11.2026) – bez sieci.
 * Działka 142504_2.0017.120 (Jastrzębia), kukurydza na ziarno, 10 lipca 2023: bilans – podwyższone ryzyko,
 * Sentinel-2 (8 lipca 2023) – rośliny dobrze uwodnione. Klasa zostaje z bilansu, raport pokazuje rozbieżność.
 */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const work = mkdtempSync(join(tmpdir(), 'kropla-real-'));
cpSync(join(import.meta.dirname, '..', '..', 'validation', 'cache'), work, { recursive: true });
process.env.KROPLA_CACHE_DIR = work;
const { analysis } = await import('../api');

test('dane rzeczywiste: rozbieżność bilansu i NDMI nie zmienia klasy; jest data sceny, polecenie sprawdzenia i miejsce retencji', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as typeof fetch;
  try {
    const outcome = await analysis('142504_2.0017.120', 'kukurydza_ziarno', '2023-07-10');
    assert.equal(outcome.status, 'ok');
    if (outcome.status !== 'ok') return;
    const r = outcome.result;
    assert.equal(r.currentState.level, 'elevated');
    assert.equal(r.satellite?.balanceLevel, 'elevated');
    assert.equal(r.satellite?.verdict, 'ok');
    assert.equal(r.satellite?.sceneDate, '2023-07-08');
    assert.equal(r.satellite?.comparison, 'diverge');
    assert.match(r.satellite?.comparisonText ?? '', /Sprawdź stan roślin na polu/);
    const place = r.recommendations.find((x) => x.id === 'rec-miejsce');
    assert.ok(place?.suggestedArea, 'miejsce retencji z NMT na mapie');
    assert.ok((place?.evidenceNumbers ?? []).length >= 2, 'uzasadnienie liczbowe');
    assert.equal(r.dataSources.find((d) => d.id === 'nmt')?.availability, 'available');
  } finally {
    globalThis.fetch = realFetch;
  }
});
