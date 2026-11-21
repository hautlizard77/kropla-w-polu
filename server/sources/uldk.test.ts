import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseUldkResponse } from './uldk';

// Odpowiedzi skopiowane z ULDK (listopad 2026).
const OK =
  '0\n142504_2.0018.122/2|SRID=2180;POLYGON((655328.676950801 404811.004090302,655212.997732138 404559.74236478,655230.178232965 404552.431503317,655347.390655158 404802.115067729,655328.676950801 404811.004090302))|mazowieckie|powiat radomski|Jastrzębia|Wólka Lesiowska\n';
const NOT_FOUND = '-1 brak wyników\nbłędny format odpowiedzi XML, usługa zwróciła odpowiedźZbiorcza baza danych obsłużyła zapytanie. ';

test('ULDK: poprawna odpowiedź – geometria i położenie', () => {
  const r = parseUldkResponse(OK);
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.equal(r.id, '142504_2.0018.122/2');
  assert.ok(r.wkt.startsWith('SRID=2180;POLYGON'));
  assert.deepEqual([r.voivodeship, r.county, r.commune, r.region], ['mazowieckie', 'powiat radomski', 'Jastrzębia', 'Wólka Lesiowska']);
});

test('ULDK: brak wyników, pusty rekord, puste linie i CRLF', () => {
  assert.equal(parseUldkResponse(NOT_FOUND).kind, 'not_found');
  assert.equal(parseUldkResponse('0\n').kind, 'no_geometry');
  assert.equal(parseUldkResponse('0\n142504_2.0018.122/2||mazowieckie\n').kind, 'no_geometry');
  assert.equal(parseUldkResponse(OK.replace('0\n', '0\r\n\r\n')).kind, 'ok');
  assert.equal(parseUldkResponse('﻿' + OK).kind, 'ok');
  // Geometria bez pola id przed nią.
  const noId = parseUldkResponse('0\nSRID=2180;MULTIPOLYGON(((1 1,2 1,2 2,1 1)))|mazowieckie|p|g|o');
  assert.equal(noId.kind, 'ok');
  if (noId.kind === 'ok') assert.equal(noId.voivodeship, 'mazowieckie');
});
