/**
 * API aplikacji Kropla w Polu:
 *   GET /api/health
 *   GET /api/parcel?id=<identyfikator działki>
 *   GET /api/terrain?id=<identyfikator działki>
 *   GET /api/ndmi?id=<identyfikator działki>&date=<RRRR-MM-DD>
 *   GET /api/analysis?id=<identyfikator działki>&crop=<uprawa>&date=<RRRR-MM-DD>
 *
 * Działa jako wtyczka serwera Vite (npm run dev / npm run preview) oraz w serwerze produkcyjnym (npm start).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import type { GridSpec, NdmiResponse, NdmiResult, ParcelInfo, TerrainResponse, TerrainResult } from '../src/types/terrain';
import { cacheGet, cacheSet, once } from './cache';
import { boundsOf, expand } from './geo/geometry';
import { fetchDem } from './sources/nmt';
import { NDMI_VERSION, computeNdmi } from './sources/sentinel';
import { errorText, lookupParcel } from './sources/uldk';
import { TERRAIN_VERSION, computeTerrain } from './terrain/analysis';
import { isCropId } from '../src/data/crops';
import type { AnalysisOutcome } from '../src/types/analysis';
import { ASSESS_VERSION, buildAssessment } from './analysis/assess';
import { getWaterways } from './sources/hydro';
import { getSoil } from './sources/soil';
import { addDays, getForecast, getWeather } from './sources/weather';
import { FORECAST_MAX_AGE_DAYS } from './analysis/forecast';
import { demoDem, demoNdmi } from './terrain/demo';

const PARCEL_ID = /^\d{6}_\d\.\d{4}(\.AR_\d+)?\.\d+[A-Za-z]?(\/\d+[A-Za-z]?)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Next = (error?: unknown) => void;

export function createApiHandler() {
  return async (req: IncomingMessage, res: ServerResponse, next?: Next): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // W wtyczce Vite ścieżka jest już bez prefiksu /api.
    const path = url.pathname.replace(/^\/api/, '') || '/';
    try {
      if (req.method !== 'GET') return send(req, res, 405, { status: 'error', message: 'Dozwolone tylko zapytania GET.' });
      if (path === '/health') return send(req, res, 200, { status: 'ok', time: new Date().toISOString() });
      const id = (url.searchParams.get('id') ?? '').trim();
      if (path === '/parcel' || path === '/terrain' || path === '/ndmi' || path === '/analysis') {
        if (!PARCEL_ID.test(id)) return send(req, res, 400, { status: 'error', message: 'Nieprawidłowy identyfikator działki.', stage: 'input' });
      }
      if (path === '/parcel') {
        const lookup = await lookupParcel(id);
        return send(req, res, 200, lookup);
      }
      if (path === '/terrain') return send(req, res, 200, await terrain(id));
      if (path === '/ndmi') {
        const date = url.searchParams.get('date') ?? '';
        if (!DATE.test(date)) return send(req, res, 400, { status: 'error', message: 'Nieprawidłowa data analizy.', stage: 'input' });
        return send(req, res, 200, await ndmi(id, date));
      }
      if (path === '/analysis') {
        const date = url.searchParams.get('date') ?? '';
        const crop = url.searchParams.get('crop') ?? '';
        if (!DATE.test(date) || !isCropId(crop)) return send(req, res, 400, { status: 'error', message: 'Nieprawidłowa data lub uprawa.', stage: 'input' });
        return send(req, res, 200, await analysis(id, crop, date));
      }
      if (next) return next();
      return send(req, res, 404, { status: 'error', message: 'Nie ma takiego zasobu API.' });
    } catch (error) {
      // Pełna ścieżka błędu w terminalu, a w komunikacie – funkcja, w której wystąpił (do zgłoszenia problemu).
      console.error(`[api] ${path} ${url.search} – błąd serwera:`, error);
      return send(req, res, 500, { status: 'error', message: `${errorText(error)}${whereThrown(error)}`, stage: 'server' });
    }
  };
}

/** „ (w: getForecast → fetchMetNoForecast)” – pierwsze funkcje aplikacji ze stosu wywołań. */
function whereThrown(error: unknown): string {
  if (!(error instanceof Error) || !error.stack) return '';
  const names = error.stack
    .split('\n')
    .slice(1)
    .map((line) => /at (?:async )?([\w.$<>]+) \(/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name) && !/^(Array|Object|JSON|Promise|Math|process|new|Module)\b/.test(name!))
    .slice(0, 3);
  return names.length > 0 ? ` (w: ${names.join(' ← ')})` : '';
}

function send(req: IncomingMessage, res: ServerResponse, code: number, body: unknown): void {
  const json = Buffer.from(JSON.stringify(body));
  const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && json.length > 2048;
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (gzip) {
    res.setHeader('Content-Encoding', 'gzip');
    res.end(gzipSync(json));
  } else {
    res.end(json);
  }
}

/** Margines wokół działki: połowa jej rozmiaru, od 100 do 300 m – obejmuje najbliższe otoczenie stoku. */
function marginFor(parcel: ParcelInfo): number {
  const b = boundsOf(parcel.ring2180);
  return Math.min(300, Math.max(100, 0.5 * Math.max(b.maxX - b.minX, b.maxY - b.minY)));
}

/** Uruchamia pobranie terenu bez czekania na wynik; równoległe zapytanie z panelu dołączy do tego samego pobierania. */
export function prefetchTerrain(parcelId: string): void {
  terrain(parcelId).catch(() => undefined);
}

export async function terrain(parcelId: string): Promise<TerrainResponse> {
  const key = `v${TERRAIN_VERSION}:${parcelId}`;
  const started = Date.now();
  const cached = await cacheGet<TerrainResult>('terrain', key);
  if (cached) {
    return { status: 'ok', result: { ...cached, cached: true, timings: [{ label: 'Odczyt wyniku z bufora', ms: Date.now() - started }] } };
  }
  return once(`terrain:${key}`, async () => {
    const timings: { label: string; ms: number }[] = [];
    const t0 = Date.now();
    const lookup = await lookupParcel(parcelId);
    timings.push({ label: 'Granica działki (ULDK)', ms: Date.now() - t0 });
    if (lookup.status === 'not_found') return { status: 'not_found', message: lookup.message };
    if (lookup.status === 'error') {
      console.warn(`[teren] ${parcelId}: brak granicy z ULDK – ${lookup.message}`);
      return { status: 'error', message: lookup.message, stage: 'uldk' };
    }
    const parcel = lookup.parcel;

    const t1 = Date.now();
    let dem;
    try {
      dem = parcel.origin === 'demo' ? demoDem(parcel) : await fetchDem(expand(boundsOf(parcel.ring2180), marginFor(parcel)));
    } catch (error) {
      console.warn(`[teren] ${parcelId}: model terenu niedostępny po ${Date.now() - t1} ms – ${errorText(error)}`);
      return { status: 'error', message: errorText(error), stage: 'nmt' };
    }
    timings.push({ label: parcel.origin === 'demo' ? 'Teren syntetyczny (demo)' : 'Model terenu (GUGiK)', ms: Date.now() - t1 });

    console.info(`[teren] ${parcelId}: granica ${timings[0]?.ms ?? 0} ms, model terenu ${Date.now() - t1} ms (${dem.source.provider})`);
    const t2 = Date.now();
    const computed = computeTerrain({ parcel, values: dem.values, grid: dem.grid, demSource: dem.source });
    timings.push({ label: 'Analiza spływu i nachylenia', ms: Date.now() - t2 });
    const result: TerrainResult = { ...computed, cached: false, timings };
    await cacheSet('terrain', key, result);
    return { status: 'ok', result };
  });
}

function fallbackGrid(parcel: ParcelInfo): GridSpec {
  const b = expand(boundsOf(parcel.ring2180), marginFor(parcel));
  const cellSize = 10;
  return {
    width: Math.ceil((b.maxX - b.minX) / cellSize),
    height: Math.ceil((b.maxY - b.minY) / cellSize),
    cellSize,
    originX: Math.floor(b.minX),
    originY: Math.ceil(b.maxY),
  };
}

export async function ndmi(parcelId: string, date: string): Promise<NdmiResponse> {
  const key = `v${NDMI_VERSION}:${parcelId}:${date}`;
  const started = Date.now();
  const cached = await cacheGet<NdmiResult>('ndmi', key);
  if (cached) return { status: 'ok', result: { ...cached, cached: true, timings: [{ label: 'Odczyt wyniku z bufora', ms: Date.now() - started }] } };
  return once(`ndmi:${key}`, async () => {
    const lookup = await lookupParcel(parcelId);
    if (lookup.status === 'not_found') return { status: 'not_found', message: lookup.message };
    if (lookup.status === 'error') return { status: 'error', message: lookup.message, stage: 'uldk' };
    const parcel = lookup.parcel;
    const terrainCached = await cacheGet<TerrainResult>('terrain', `v${TERRAIN_VERSION}:${parcelId}`);
    const grid = terrainCached?.displayGrid ?? fallbackGrid(parcel);
    try {
      const computed = parcel.origin === 'demo' ? demoNdmi(parcel, date, grid) : await computeNdmi(parcel, date, grid);
      const result: NdmiResult = { ...computed, cached: false };
      await cacheSet('ndmi', key, result);
      return { status: 'ok', result };
    } catch (error) {
      return { status: 'error', message: `Nie udało się pobrać obserwacji Sentinel-2 (${errorText(error)}).`, stage: 'sentinel' };
    }
  });
}

function todayWarsaw(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Ocena sytuacji wodnej dowolnej działki z danych pogodowych, glebowych i hydrologicznych. */
export async function analysis(parcelId: string, cropId: string, date: string): Promise<AnalysisOutcome | { status: 'error'; message: string; stage: string }> {
  if (!isCropId(cropId)) return { status: 'error', message: 'Nieznana uprawa.', stage: 'input' };
  const today = todayWarsaw();
  if (date > today) return { status: 'error', message: 'Data analizy nie może być z przyszłości.', stage: 'input' };
  // Teren pobieramy w tle już teraz – zanim rolnik otworzy „Teren i spływ 3D”, wynik jest zwykle gotowy.
  prefetchTerrain(parcelId);
  const key = `v${ASSESS_VERSION}:${parcelId}:${cropId}:${date}`;
  const cacheable = date <= addDays(today, -10);
  if (cacheable) {
    const cached = await cacheGet<AnalysisOutcome>('analysis', key);
    if (cached) return cached;
  }
  return once(`analysis:${key}`, async () => {
    const lookup = await lookupParcel(parcelId);
    if (lookup.status === 'not_found') {
      return { status: 'unavailable', unavailable: { reason: 'unknown_parcel', message: lookup.message, hint: null } } as AnalysisOutcome;
    }
    if (lookup.status === 'error') return { status: 'error', message: lookup.message, stage: 'uldk' };
    const parcel = lookup.parcel;
    const lat = parcel.ringWgs84.reduce((s, p) => s + p[1], 0) / parcel.ringWgs84.length;
    const lon = parcel.ringWgs84.reduce((s, p) => s + p[0], 0) / parcel.ringWgs84.length;
    const start = `${Number(date.slice(0, 4)) - 10}-03-01`;
    const wantsForecast = date >= addDays(today, -FORECAST_MAX_AGE_DAYS);
    const [weather, soil, hydro, forecast] = await Promise.allSettled([
      getWeather(lat, lon, start, date, today),
      getSoil(lat, lon),
      getWaterways(parcel.id, parcel.ringWgs84, parcel.ring2180),
      wantsForecast ? getForecast(lat, lon, today) : Promise.resolve(null),
    ]);
    const result = buildAssessment({
      request: { parcelId: parcel.id, cropId, analysisDate: date },
      parcel,
      weather: weather.status === 'fulfilled' ? weather.value : null,
      soil: soil.status === 'fulfilled' ? soil.value : null,
      hydro: hydro.status === 'fulfilled' ? hydro.value : null,
      forecast: forecast.status === 'fulfilled' ? forecast.value : null,
      forecastError: forecast.status === 'rejected' ? errorText(forecast.reason) : null,
      todayDate: today,
    });
    const outcome: AnalysisOutcome = { status: 'ok', result };
    if (cacheable && result.currentState.level !== 'insufficient_data') await cacheSet('analysis', key, outcome);
    return outcome;
  });
}
