/**
 * Test na zapisanych danych z prawdziwych usług (validation/cache/, pobrane 22.11.2026) – bez sieci.
 * Działka 142504_2.0017.120 (Jastrzębia), kukurydza na ziarno, 10 lipca 2023: bilans – podwyższone ryzyko,
 * Sentinel-2 (8 lipca 2023) – rośliny dobrze uwodnione. Klasa zostaje z bilansu, raport pokazuje rozbieżność,
 * a mapa pokrycia terenu ją wyjaśnia: według ESA WorldCover 2021 działkę pokrywa las (91%), nie pole kukurydzy.
 */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { JURY_PARCELS } from '../../src/data/juryParcels';

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
    // ESA WorldCover 2021: działka to głównie las – stąd zielone NDMI przy suchym bilansie dla kukurydzy.
    assert.equal(r.landCover?.verdict, 'non_agricultural');
    assert.equal(r.landCover?.notice?.severity, 'warning');
    assert.match(r.currentState.summary, /^Uwaga: działka nie wygląda na grunt rolny/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('tabela walidacji: zapas w mm i procent pełnego zapasu są spójne (bez mylenia jednostek)', async () => {
  const { readFileSync } = await import('node:fs');
  const rows = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'validation', 'results.json'), 'utf8')) as {
    parcelId: string; date: string; balance: string;
  }[];
  assert.equal(new Set(JURY_PARCELS.map(({ voivodeship }) => voivodeship)).size, 4);
  assert.deepEqual(
    rows.map(({ parcelId, date }) => [parcelId, date]),
    JURY_PARCELS.map(({ request }) => [request.parcelId, request.analysisDate]),
  );
  for (const row of rows) {
    const m = /zapas (\d+) mm z (\d+) mm, (\d+)%/.exec(row.balance);
    assert.ok(m, `brak zapasu w mm i % w: ${row.balance}`);
    assert.equal(Number(m[3]), Math.round((100 * Number(m[1])) / Number(m[2])), row.balance);
  }
});
