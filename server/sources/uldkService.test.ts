import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Osobny katalog bufora dla tego pliku – ustawiony przed załadowaniem modułów.
process.env.KROPLA_CACHE_DIR = mkdtempSync(join(tmpdir(), 'kropla-uldk-'));
const { isPlausibleParcel, lookupParcel, readUldkResponse, retryAfterMs, MAX_RESPONSE_BYTES } = await import('./uldk');
const { cacheSet } = await import('../cache');

const ok = (body: string, type = 'text/plain; charset=utf-8') => new Response(body, { status: 200, headers: { 'content-type': type } });

test('ULDK: typ i rozmiar odpowiedzi są sprawdzane przed parsowaniem', async () => {
  assert.equal((await readUldkResponse(ok('0\n'))).kind, 'text');
  const html = await readUldkResponse(ok('<html>blokada</html>', 'text/html'));
  assert.equal(html.kind, 'fail');
  const htmlAsText = await readUldkResponse(ok('<!DOCTYPE html><p>błąd</p>'));
  assert.equal(htmlAsText.kind, 'fail');
  const big = await readUldkResponse(new Response('x', { status: 200, headers: { 'content-type': 'text/plain', 'content-length': String(MAX_RESPONSE_BYTES + 1) } }));
  assert.equal(big.kind, 'fail');
  if (big.kind === 'fail') assert.equal(big.retryable, false);
});

test('ULDK: HTTP 429 z Retry-After (sekundy i data HTTP)', async () => {
  const now = Date.parse('2026-11-22T10:00:00Z');
  assert.equal(retryAfterMs('7', now), 7000);
  assert.equal(retryAfterMs('Sun, 22 Nov 2026 10:00:30 GMT', now), 30000);
  assert.equal(retryAfterMs('bzdura', now), null);
  const r = await readUldkResponse(new Response('', { status: 429, headers: { 'retry-after': '3' } }), now);
  assert.deepEqual(r, { kind: 'retry_after', waitMs: 3000, status: 429 });
});

test('ULDK: granica spoza Polski lub bez powierzchni nie jest uznawana', () => {
  const base = { id: 'x', ringWgs84: [], areaHa: 1, voivodeship: null, county: null, commune: null, region: null, origin: 'observed' as const, source: {} as never };
  assert.equal(isPlausibleParcel({ ...base, ring2180: [[500000, 500000], [500100, 500000], [500100, 500100]] }), true);
  assert.equal(isPlausibleParcel({ ...base, ring2180: [[1, 1], [2, 1], [2, 2]] }), false);
  assert.equal(isPlausibleParcel({ ...base, ring2180: [[500000, 500000], [500100, 500000]] }), false);
});

test('ULDK: przy awarii usługi używamy wcześniej zweryfikowanej granicy z bufora; bez bufora – czytelny komunikat', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('Not found', { status: 404 })) as typeof fetch;
  try {
    const id = '146501_1.0001.1';
    const ring2180: [number, number][] = [[637000, 486000], [637100, 486000], [637100, 486100], [637000, 486100]];
    await cacheSet('uldk', `v1:${id}`, {
      status: 'ok',
      verifiedAt: '2026-01-10T10:00:00Z', // starsze niż 30 dni – normalnie sprawdzamy ponownie
      parcel: { id, ring2180, ringWgs84: [], areaHa: 1, voivodeship: 'mazowieckie', county: null, commune: null, region: null, origin: 'observed', source: { name: 'ULDK', provider: 'GUGiK', url: null, origin: 'observed', retrievedAt: '2026-01-10T10:00:00Z', observationDate: null, resolutionM: null, durationMs: 100, notes: [] } },
    });
    const fallback = await lookupParcel(id);
    assert.equal(fallback.status, 'ok');
    if (fallback.status === 'ok') assert.match(fallback.parcel.source.notes.join(' '), /ULDK jest teraz niedostępne/);

    const none = await lookupParcel('146501_1.0001.2');
    assert.equal(none.status, 'error');
    if (none.status === 'error') {
      assert.match(none.message, /Ewidencja gruntów \(ULDK, GUGiK\)/);
      assert.doesNotMatch(none.message, /HTTP|404/);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
