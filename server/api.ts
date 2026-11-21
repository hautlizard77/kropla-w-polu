/**
 * API aplikacji Kropla w Polu:
 *   GET /api/health
 *   GET /api/parcel?id=<identyfikator działki>
 *   GET /api/terrain?id=<identyfikator działki>
 *   GET /api/ndmi?id=<identyfikator działki>&date=<RRRR-MM-DD>
 *
 * Działa jako wtyczka serwera Vite (npm run dev / npm run preview) oraz w serwerze produkcyjnym (npm start).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import type { GridSpec, NdmiResponse, NdmiResult, ParcelInfo, TerrainResponse, TerrainResult } from '../src/types/terrain';
import { cacheGet, cacheSet, once } from './cache';
import { boundsOf, expand } from './geo/geometry';
import { fetchNmt } from './sources/nmt';
import { NDMI_VERSION, computeNdmi } from './sources/sentinel';
import { errorText, lookupParcel } from './sources/uldk';
import { TERRAIN_VERSION, computeTerrain } from './terrain/analysis';
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
      if (path === '/parcel' || path === '/terrain' || path === '/ndmi') {
        if (!PARCEL_ID.test(id)) return send(req, res, 400, { status: 'error', message: 'Nieprawidłowy identyfikator działki.', stage: 'input' });
      }
      if (path === '/parcel') return send(req, res, 200, await lookupParcel(id));
      if (path === '/terrain') return send(req, res, 200, await terrain(id));
      if (path === '/ndmi') {
        const date = url.searchParams.get('date') ?? '';
        if (!DATE.test(date)) return send(req, res, 400, { status: 'error', message: 'Nieprawidłowa data analizy.', stage: 'input' });
        return send(req, res, 200, await ndmi(id, date));
      }
      if (next) return next();
      return send(req, res, 404, { status: 'error', message: 'Nie ma takiego zasobu API.' });
    } catch (error) {
      return send(req, res, 500, { status: 'error', message: errorText(error), stage: 'server' });
    }
  };
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
    if (lookup.status === 'error') return { status: 'error', message: lookup.message, stage: 'uldk' };
    const parcel = lookup.parcel;

    const t1 = Date.now();
    let dem;
    try {
      dem = parcel.origin === 'demo' ? demoDem(parcel) : await fetchNmt(expand(boundsOf(parcel.ring2180), marginFor(parcel)));
    } catch (error) {
      return { status: 'error', message: errorText(error), stage: 'nmt' };
    }
    timings.push({ label: parcel.origin === 'demo' ? 'Teren syntetyczny (demo)' : 'NMT z Geoportalu (WCS)', ms: Date.now() - t1 });

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
