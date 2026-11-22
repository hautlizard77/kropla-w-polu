/**
 * Użytkowanie terenu działki: ESA WorldCover 10 m (2021, v200) – otwarte pliki COG w AWS Open Data.
 *
 * Kafle 3° × 3° w EPSG:4326, nazwa od lewego dolnego narożnika (np. N51E021 obejmuje 51–54°N, 21–24°E), piksel
 * 1/12000° (ok. 10 m), klasy: 10 drzewa, 20 krzewy, 30 roślinność trawiasta, 40 uprawy, 50 zabudowa, 60 grunt odsłonięty,
 * 70 śnieg, 80 wody, 90 mokradła, 95 namorzyny, 100 mchy; 0 – brak danych.
 * Licencja: CC BY 4.0, © ESA WorldCover project 2021 / zawiera zmodyfikowane dane Copernicus Sentinel (2021).
 * Zanna i in. (2022), ESA WorldCover 10 m 2021 v200, doi:10.5281/zenodo.7254221.
 *
 * Mapa jest z 2021 r. i ma ok. 75–80% trafności klas – dlatego służy do ostrzeżenia („to nie wygląda na pole”),
 * a nie do zmiany wyniku bilansu.
 */
import type { LandCover, LandCoverClass } from '../../src/types/analysis';
import type { SourceInfo, Xy } from '../../src/types/terrain';
import { cacheGet, cacheSet } from '../cache';
import { pointInPolygon } from '../geo/geometry';
import { HttpRangeSource, Tiff, windowForBounds } from '../geo/tiff';
import { errorText } from './uldk';

export const WORLDCOVER_URL = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map';
const LANDCOVER_VERSION = 1;

export const CLASS_LABELS: Record<number, string> = {
  10: 'las i zadrzewienia',
  20: 'zarośla',
  30: 'roślinność trawiasta (łąki, pastwiska)',
  40: 'grunty orne (uprawy)',
  50: 'zabudowa',
  60: 'grunt odsłonięty',
  70: 'śnieg i lód',
  80: 'wody',
  90: 'mokradła',
  95: 'namorzyny',
  100: 'mchy i porosty',
};

/** Nazwa kafla WorldCover dla punktu (lon, lat). */
export function worldCoverTile(lon: number, lat: number): string {
  const la = Math.floor(lat / 3) * 3;
  const lo = Math.floor(lon / 3) * 3;
  const ns = `${la >= 0 ? 'N' : 'S'}${String(Math.abs(la)).padStart(2, '0')}`;
  const ew = `${lo >= 0 ? 'E' : 'W'}${String(Math.abs(lo)).padStart(3, '0')}`;
  return `ESA_WorldCover_10m_2021_v200_${ns}${ew}_Map.tif`;
}

/**
 * Udziały klas w działce i werdykt. Rolne = uprawy + roślinność trawiasta (łąki i pastwiska są na mapie „trawiaste”).
 * - arable: uprawy ≥ 50%;
 * - grassland: trawiaste ≥ 50%;
 * - mixed: rolne ≥ 50%, ale żadna z dwóch klas nie przeważa, albo rolne 30–50%;
 * - non_agricultural: rolne < 30% (las, zabudowa, woda…).
 */
export function summarizeLandCover(counts: Map<number, number>): Pick<LandCover, 'classes' | 'croplandPct' | 'grasslandPct' | 'agriculturalPct' | 'verdict' | 'dominant'> & { pixels: number } {
  let total = 0;
  for (const [code, n] of counts) if (code !== 0) total += n;
  const classes: LandCoverClass[] = [...counts.entries()]
    .filter(([code, n]) => code !== 0 && n > 0)
    .map(([code, n]) => ({ code, label: CLASS_LABELS[code] ?? `klasa ${code}`, pct: Math.round((1000 * n) / total) / 10 }))
    .sort((a, b) => b.pct - a.pct);
  const pct = (code: number) => classes.find((c) => c.code === code)?.pct ?? 0;
  const croplandPct = pct(40);
  const grasslandPct = pct(30);
  const agriculturalPct = Math.round((croplandPct + grasslandPct) * 10) / 10;
  const verdict: LandCover['verdict'] =
    total === 0 ? 'unknown' : croplandPct >= 50 ? 'arable' : grasslandPct >= 50 ? 'grassland' : agriculturalPct >= 30 ? 'mixed' : 'non_agricultural';
  return { classes, croplandPct, grasslandPct, agriculturalPct, verdict, dominant: classes[0] ?? null, pixels: total };
}

export async function getLandCover(parcelId: string, ringWgs84: Xy[]): Promise<LandCover> {
  const key = `v${LANDCOVER_VERSION}:${parcelId}`;
  const cached = await cacheGet<LandCover>('landcover', key);
  if (cached) return cached;
  const started = Date.now();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ringWgs84) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const tile = worldCoverTile((minX + maxX) / 2, (minY + maxY) / 2);
  const url = `${WORLDCOVER_URL}/${tile}`;
  const source = new HttpRangeSource(url, 15000);
  const tiff = await Tiff.open(source);
  const image = tiff.main;
  const geo = image.geo;
  if (!geo) throw new Error('kafel WorldCover bez georeferencji');
  const w = windowForBounds(image, { minX, minY, maxX, maxY });
  // Działka przy krawędzi kafla: przycinamy okno do kafla (pozostała część leży w sąsiednim – pomijamy ją).
  const x0 = Math.max(0, w.x0);
  const y0 = Math.max(0, w.y0);
  const x1 = Math.min(image.width, w.x0 + w.w);
  const y1 = Math.min(image.height, w.y0 + w.h);
  if (x1 <= x0 || y1 <= y0) throw new Error('działka poza kaflem WorldCover');
  const values = await tiff.readWindow(x0, y0, x1 - x0, y1 - y0);
  const counts = new Map<number, number>();
  let nearest: { code: number; d: number } | null = null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (let row = 0; row < y1 - y0; row += 1) {
    for (let col = 0; col < x1 - x0; col += 1) {
      const raw = values[row * (x1 - x0) + col] as number;
      // NoData (0) czytnik zamienia na NaN – liczymy jako 0, czyli „brak danych”.
      const code = Number.isFinite(raw) ? raw : 0;
      const center: Xy = [geo.originX + (x0 + col + 0.5) * geo.pixelWidth, geo.originY - (y0 + row + 0.5) * geo.pixelHeight];
      if (pointInPolygon(center, ringWgs84)) counts.set(code, (counts.get(code) ?? 0) + 1);
      const d = (center[0] - cx) ** 2 + (center[1] - cy) ** 2;
      if (!nearest || d < nearest.d) nearest = { code, d };
    }
  }
  // Działka węższa niż piksel 10 m – bierzemy piksel najbliższy jej środka.
  if (![...counts.keys()].some((c) => c !== 0) && nearest && nearest.code !== 0) counts.set(nearest.code, 1);
  const summary = summarizeLandCover(counts);
  const sourceInfo: SourceInfo = {
    name: 'Pokrycie terenu ESA WorldCover 10 m (2021)',
    provider: 'ESA WorldCover (Copernicus Sentinel-1/2), pliki COG w AWS Open Data',
    url: 'https://esa-worldcover.org',
    origin: 'observed',
    retrievedAt: new Date().toISOString(),
    observationDate: '2021-12-31',
    resolutionM: 10,
    durationMs: Date.now() - started,
    notes: [
      'Mapa pokrycia terenu z 2021 r. (obrazy z całego roku 2021) – zmiany użytkowania po 2021 r. nie są widoczne.',
      'Trafność klas ok. 77% (walidacja ESA); łąki bywają mylone z uprawami. Służy do ostrzeżenia, nie zmienia wyniku bilansu.',
      `Kafel ${tile}; ${summary.pixels} pikseli 10 m w granicy działki.`,
    ],
  };
  const result: LandCover = {
    status: 'ok',
    ...summary,
    message: describeLandCover(summary),
    source: sourceInfo,
  };
  await cacheSet('landcover', key, result);
  return result;
}

export function landCoverUnavailable(error: unknown): LandCover {
  return {
    status: 'unavailable',
    classes: [],
    croplandPct: 0,
    grasslandPct: 0,
    agriculturalPct: 0,
    verdict: 'unknown',
    dominant: null,
    pixels: 0,
    message: `Nie udało się pobrać mapy pokrycia terenu (${errorText(error)}).`,
    source: {
      name: 'Pokrycie terenu ESA WorldCover 10 m (2021)',
      provider: 'ESA WorldCover',
      url: 'https://esa-worldcover.org',
      origin: 'observed',
      retrievedAt: null,
      observationDate: null,
      resolutionM: 10,
      durationMs: null,
      notes: [],
    },
  };
}

function describeLandCover(s: ReturnType<typeof summarizeLandCover>): string {
  const top = s.classes.slice(0, 3).map((c) => `${c.label} ${c.pct.toLocaleString('pl-PL')}%`).join(', ');
  return `Pokrycie działki (ESA WorldCover 2021): ${top || 'brak danych'}.`;
}
