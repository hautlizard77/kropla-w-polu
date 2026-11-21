import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ParcelSummary } from '../types/account';
import { buildNotifications } from './account';

const base = (over: Partial<ParcelSummary> = {}): ParcelSummary => ({
  saved: { parcelId: '040706_4.0001.9', name: 'Pole przy rowie', cropId: 'pszenica_ozima', addedOn: '2026-11-01' },
  parcel: null,
  lookup: 'ok',
  lookupMessage: null,
  lastAnalysis: null,
  ...over,
});

test('bez działek: zachęta do dodania i porada miesiąca', () => {
  const n = buildNotifications([], '2026-11-22');
  assert.deepEqual(n.map((x) => x.kind).sort(), ['account', 'tip']);
  assert.match(n.find((x) => x.kind === 'tip')!.title, /rowów i przepustów/);
});

test('działka bez oceny i działka spoza ewidencji', () => {
  const n = buildNotifications([base(), base({ saved: { ...base().saved, parcelId: 'x', name: 'Zła' }, lookup: 'not_found', lookupMessage: 'Nie znaleziono.' })], '2026-11-22');
  assert.ok(n.some((x) => x.id.startsWith('nowa:') && x.link?.href.includes('2026-11-22')));
  assert.ok(n.some((x) => x.id === 'uldk:x' && x.kind === 'data'));
});

test('ocena z ryzykiem, pilnym krokiem i brakami danych; nowa ocena daje nowe id', () => {
  const last = {
    request: { parcelId: '040706_4.0001.9', cropId: 'pszenica_ozima' as const, analysisDate: '2026-11-22' },
    level: 'elevated' as const,
    headline: 'Uprawie brakuje wody.',
    historicalLevel: 'moderate' as const,
    analysedAt: '2026-11-22T09:00:00+01:00',
    missingData: ['Gleba'],
    nextStep: { when: 'Teraz', title: 'Podlej 20 mm', text: 'Zapas wody spadł poniżej progu stresu.', urgent: true },
  };
  const n = buildNotifications([base({ lastAnalysis: last })], '2026-11-22');
  const kinds = n.map((x) => x.id.split(':')[0]);
  assert.deepEqual(kinds.filter((k) => k !== 'porada').sort(), ['braki', 'krok', 'ryzyko']);
  const later = buildNotifications([base({ lastAnalysis: { ...last, request: { ...last.request, analysisDate: '2026-11-23' } } })], '2026-11-23');
  assert.ok(later.every((x) => !n.some((y) => y.id === x.id) || x.kind === 'tip'));
});

test('stara ocena z niskim ryzykiem: raport i przypomnienie o ocenie na dziś', () => {
  const last = { request: { parcelId: '040706_4.0001.9', cropId: 'pszenica_ozima' as const, analysisDate: '2019-06-26' }, level: 'low' as const, headline: 'Wody wystarcza.', historicalLevel: 'low' as const };
  const n = buildNotifications([base({ lastAnalysis: last })], '2026-11-22');
  assert.ok(n.some((x) => x.id.startsWith('raport:')));
  const stale = n.find((x) => x.id.startsWith('nieaktualna:'))!;
  assert.match(stale.link!.href, /2026-11-22/);
});
