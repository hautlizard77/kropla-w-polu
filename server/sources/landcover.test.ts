import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.KROPLA_CACHE_DIR = mkdtempSync(join(tmpdir(), 'kropla-lc-'));
const { getLandCover, summarizeLandCover, worldCoverTile } = await import('./landcover');
const { landUseNoticeFor } = await import('../analysis/assess');

test('kafel WorldCover: 3° × 3° od lewego dolnego narożnika', () => {
  assert.equal(worldCoverTile(21.15, 51.4), 'ESA_WorldCover_10m_2021_v200_N51E021_Map.tif');
  assert.equal(worldCoverTile(14.2, 53.9), 'ESA_WorldCover_10m_2021_v200_N51E012_Map.tif');
  assert.equal(worldCoverTile(18.6, 54.4), 'ESA_WorldCover_10m_2021_v200_N54E018_Map.tif');
  assert.equal(worldCoverTile(22.9, 49.1), 'ESA_WorldCover_10m_2021_v200_N48E021_Map.tif');
});

test('udziały klas i werdykt: grunt orny, łąka, mieszane, nierolnicze; brak danych pomijany', () => {
  const s = (entries: [number, number][]) => summarizeLandCover(new Map(entries));
  assert.equal(s([[40, 90], [10, 10], [0, 50]]).verdict, 'arable');
  assert.equal(s([[40, 90], [10, 10], [0, 50]]).croplandPct, 90);
  assert.equal(s([[30, 70], [40, 30]]).verdict, 'grassland');
  assert.equal(s([[40, 40], [30, 5], [10, 55]]).verdict, 'mixed');
  const forest = s([[10, 80], [40, 15], [50, 5]]);
  assert.equal(forest.verdict, 'non_agricultural');
  assert.equal(forest.dominant?.label, 'las i zadrzewienia');
  assert.equal(s([[0, 10]]).verdict, 'unknown');
});

test('ostrzeżenie: las przy wybranej uprawie, łąka przy uprawie polowej, brak ostrzeżenia dla pola', () => {
  const lc = (entries: [number, number][]) => ({ status: 'ok' as const, ...summarizeLandCover(new Map(entries)), message: '', source: {} as never });
  const forest = landUseNoticeFor(lc([[10, 80], [40, 20]]), 'pszenica_ozima');
  assert.equal(forest?.severity, 'warning');
  assert.match(forest?.text ?? '', /las i zadrzewienia \(80%\).*grunty rolne to 20%/);
  assert.equal(landUseNoticeFor(lc([[30, 80], [40, 20]]), 'kukurydza_ziarno')?.title, 'Na mapie to łąka lub pastwisko');
  assert.equal(landUseNoticeFor(lc([[30, 80], [40, 20]]), 'uzytki_zielone'), null);
  assert.equal(landUseNoticeFor(lc([[40, 95], [10, 5]]), 'kukurydza_ziarno'), null);
  assert.equal(landUseNoticeFor(lc([[40, 95]]), 'uzytki_zielone')?.title, 'Na mapie to grunt orny');
});

test('odczyt COG (8 bit, Deflate, kafle, EPSG:4326, NoData 0) i udziały w granicy działki', async () => {
  const bytes = new Uint8Array(readFileSync(new URL('../fixtures/worldcover-u8.tif', import.meta.url)));
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    const range = /bytes=(\d+)-(\d+)/.exec(String((init?.headers as Record<string, string>)?.Range ?? ''));
    const start = range ? Number(range[1]) : 0;
    const end = range ? Math.min(bytes.length - 1, Number(range[2])) : bytes.length - 1;
    return new Response(bytes.slice(start, end + 1), { status: 206 });
  }) as typeof fetch;
  try {
    const px = 1 / 12000;
    const lon = (c: number) => 21.5 + c * px;
    const lat = (r: number) => 52.0 - r * px;
    // Prostokąt kolumny 2–38, wiersze 4–46: tylko klasa 40 (uprawy).
    const field = await getLandCover('test-pole', [[lon(2), lat(4)], [lon(38), lat(4)], [lon(38), lat(46)], [lon(2), lat(46)]]);
    assert.equal(field.status, 'ok');
    assert.equal(field.verdict, 'arable');
    assert.equal(field.croplandPct, 100);
    assert.match(urls[0] ?? '', /N51E021_Map\.tif$/);
    // Prostokąt kolumny 30–62, wiersze 4–46: uprawy 10 kolumn, las 22 kolumny.
    const mixed = await getLandCover('test-las', [[lon(30), lat(4)], [lon(62), lat(4)], [lon(62), lat(46)], [lon(30), lat(46)]]);
    assert.equal(mixed.dominant?.code, 10);
    assert.equal(mixed.verdict, 'mixed');
    assert.ok(Math.abs(mixed.croplandPct - 31.3) < 1, `uprawy ${mixed.croplandPct}%`);
  } finally {
    globalThis.fetch = realFetch;
  }
});
