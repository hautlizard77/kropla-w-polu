import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ParcelInfo } from '../types/terrain';
import { analyzeWithDemoScenarios, observedResult } from './analysis';

test('działka spoza demo: brak wymyślonej diagnozy, rzeczywisty stan źródeł', () => {
  const parcel = {
    id: '040706_4.0001.9',
    ring2180: [],
    ringWgs84: [[18.31, 52.68], [18.311, 52.68], [18.311, 52.681]],
    areaHa: 1.234,
    voivodeship: 'kujawsko-pomorskie',
    county: 'inowrocławski',
    commune: 'Kruszwica',
    region: 'Przykład',
    origin: 'observed',
    source: { name: 'ULDK', provider: 'GUGiK', url: null, origin: 'observed', retrievedAt: '2026-11-21T10:00:00Z', observationDate: null, resolutionM: null, durationMs: 500, notes: [] },
  } as unknown as ParcelInfo;
  const result = observedResult({ parcelId: parcel.id, cropId: 'pszenica_ozima', analysisDate: '2025-06-01' }, parcel);
  assert.equal(result.isDemo, false);
  assert.equal(result.currentState.level, 'insufficient_data');
  assert.equal(result.recommendations.length, 0);
  assert.equal(result.dataSources.find((s) => s.kind === 'pogoda')?.availability, 'missing');
  assert.equal(result.dataSources.find((s) => s.kind === 'granice')?.retrievedAt, '2026-11-21');
});

test('działka demo z inną datą nie dostaje wyniku', () => {
  const outcome = analyzeWithDemoScenarios({ parcelId: '040705_5.0012.245/3', cropId: 'pszenica_ozima', analysisDate: '2020-06-26' });
  assert.equal(outcome.status, 'unavailable');
});
