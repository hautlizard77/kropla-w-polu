import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distanceText, mergeWaterways, parseMphpRings, type Waterway } from './hydro';

// Atrybuty jak w odpowiedzi GetFeatureInfo MPHP10 (wody.isok.gov.pl, warstwa 19).
const zernik = { Nazwarzeki: 'Dopływ spod Żernik', Charakterodcinkacieku: 'ciek naturalny', Typodcinkacieku: 'stały', Szerokośćodcinkaciekum: 'poniżej 1,5 m', ObjectID: '57868' };
const zernik2 = { ...zernik, ObjectID: '43360' };
const row = { Nazwarzeki: '', Charakterodcinkacieku: 'ciek sztuczny - rów', Typodcinkacieku: 'okresowy', Szerokośćodcinkaciekum: 'poniżej 1,5 m', Identyfikatorhydrograficznycieku: '77', ObjectID: '1' };
const notec = { Nazwarzeki: 'Noteć', Charakterodcinkacieku: 'ciek naturalny - rzeka', Typodcinkacieku: 'stały', Szerokośćodcinkaciekum: 'powyżej  5 m', ObjectID: '83117' };
const rura = { Nazwarzeki: 'X', Charakterodcinkacieku: 'ciek sztuczny - rurociąg', ObjectID: '9' };

test('MPHP: najmniejszy pierścień, w którym ciek się pojawia, to górna granica odległości', () => {
  const out = parseMphpRings([50, 100, 300], [[zernik], [zernik, row], [zernik, zernik2, row, notec, rura]]);
  assert.deepEqual(
    out.map((w) => [w.kind, w.name, w.distanceM]),
    [
      ['ciek', 'Dopływ spod Żernik', 50],
      ['rów', null, 100],
      ['rzeka', 'Noteć', 300],
    ],
  );
  assert.ok(out.every((w) => w.approx && w.origin === 'mphp'));
  assert.equal(out[1]!.details, 'okresowy, szer. poniżej 1,5 m');
  assert.equal(out[2]!.details, 'szer. powyżej 5 m');
  assert.equal(distanceText(out[0]!), 'do 50 m');
});

test('łączenie: OSM doprecyzowuje odległość tego samego cieku i dodaje rowy spoza MPHP', () => {
  const official: Waterway[] = [{ kind: 'ciek', name: 'Dopływ spod Żernik', distanceM: 100, approx: true, origin: 'mphp' }];
  const osm: Waterway[] = [
    { kind: 'strumień', name: 'dopływ spod żernik', distanceM: 64, origin: 'osm' },
    { kind: 'rów', name: null, distanceM: 12, origin: 'osm' },
    { kind: 'rzeka', name: null, distanceM: 200, origin: 'osm' },
  ];
  const merged = mergeWaterways(official.map((w) => ({ ...w })), osm);
  assert.deepEqual(
    merged.map((w) => [w.kind, w.distanceM, w.origin, Boolean(w.approx)]),
    [
      ['rów', 12, 'osm', false],
      ['ciek', 64, 'mphp', false],
    ],
  );
  assert.equal(distanceText(merged[1]!), 'ok. 64 m');
});

test('łączenie: bez MPHP zostaje wszystko z OSM', () => {
  const osm: Waterway[] = [{ kind: 'rzeka', name: null, distanceM: 200, origin: 'osm' }];
  assert.equal(mergeWaterways([], osm).length, 1);
});
