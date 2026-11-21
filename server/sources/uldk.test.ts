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
  assert.ok(r.wkt?.startsWith('SRID=2180;POLYGON'));
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

function wkbPolygonHex(srid: number, ring: [number, number][]): string {
  const buf = new ArrayBuffer(1 + 4 + 4 + 4 + 4 + ring.length * 16);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, 1); o += 1;
  v.setUint32(o, 3 | 0x20000000, true); o += 4;
  v.setUint32(o, srid, true); o += 4;
  v.setUint32(o, 1, true); o += 4;
  v.setUint32(o, ring.length, true); o += 4;
  for (const [x, y] of ring) { v.setFloat64(o, x, true); v.setFloat64(o + 8, y, true); o += 16; }
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

test('ULDK: geometria w WKB (gdy usługa pominie parametr result) i bezużyteczna odpowiedź', () => {
  const ring: [number, number][] = [[656677.12, 405606.48], [656701.03, 405653.17], [656665.34, 405683.97], [656677.12, 405606.48]];
  const r = parseUldkResponse(`0\n${wkbPolygonHex(2180, ring)}\n`);
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') assert.deepEqual(r.ring2180, ring.slice(0, -1));
  // Odpowiedź otrzymana z serwera użytkownika: punkt w EPSG:4326 z nieprawidłowymi współrzędnymi.
  const garbage = '0\n0101000020E6100000000000000000008056400000000000000080564001010101010101010101010101010101010101';
  assert.equal(parseUldkResponse(garbage).kind, 'no_geometry');
});
