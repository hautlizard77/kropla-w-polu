/**
 * Granica działki z usługi ULDK (GUGiK): https://uldk.gugik.gov.pl/opis.html
 * Dla działek z trybu demonstracyjnego zwracamy ich ilustracyjną geometrię, oznaczoną jako `demo`.
 */
import { DEMO_SCENARIOS } from '../../src/data/demoScenarios';
import type { ParcelInfo, ParcelLookup, Xy } from '../../src/types/terrain';
import { cacheGet, cacheSet, once } from '../cache';
import { polygonArea, parseWktOuterRing } from '../geo/geometry';
import { epsg2180ToWgs84, wgs84To2180 } from '../geo/proj';

export const ULDK_URL = 'https://uldk.gugik.gov.pl/';
const CACHE_VERSION = 'v1';

export function demoParcel(parcelId: string): ParcelInfo | null {
  const scenario = DEMO_SCENARIOS.find((item) => item.request.parcelId === parcelId);
  if (!scenario) return null;
  const ringWgs84 = (scenario.result.parcel.geometry.coordinates[0] ?? []).slice(0, -1) as Xy[];
  const ring2180 = ringWgs84.map(wgs84To2180);
  return {
    id: parcelId,
    ring2180,
    ringWgs84,
    areaHa: polygonArea(ring2180) / 10000,
    voivodeship: scenario.result.parcel.voivodeship,
    county: scenario.result.parcel.county,
    commune: scenario.result.parcel.commune,
    region: null,
    origin: 'demo',
    source: {
      name: 'Granica działki – dane demonstracyjne',
      provider: 'Kropla w Polu (tryb demo)',
      url: null,
      origin: 'demo',
      retrievedAt: null,
      observationDate: null,
      resolutionM: null,
      durationMs: null,
      notes: ['Geometria ilustracyjna z trybu demonstracyjnego – nie pochodzi z ewidencji.'],
    },
  };
}

export async function lookupParcel(parcelId: string): Promise<ParcelLookup> {
  const demo = demoParcel(parcelId);
  if (demo) return { status: 'ok', parcel: demo };

  const cached = await cacheGet<ParcelLookup>('uldk', `${CACHE_VERSION}:${parcelId}`);
  if (cached?.status === 'ok') {
    return { status: 'ok', parcel: { ...cached.parcel, source: { ...cached.parcel.source, durationMs: null } } };
  }
  return once(`uldk:${parcelId}`, async () => {
    const result = await fetchFromUldk(parcelId);
    if (result.status === 'ok') await cacheSet('uldk', `${CACHE_VERSION}:${parcelId}`, result);
    return result;
  });
}

const RESULT_FIELDS = 'id,geom_wkt,voivodeship,county,commune,region';

/** Wynik odczytu odpowiedzi ULDK (wydzielony, żeby dało się go przetestować na prawdziwych odpowiedziach). */
export type UldkParse =
  | {
      kind: 'ok';
      id: string | null;
      /** Geometria jako WKT albo – gdy ULDK pominie parametr `result` – pierścień odczytany z WKB. */
      wkt: string | null;
      ring2180?: Xy[];
      voivodeship: string | null;
      county: string | null;
      commune: string | null;
      region: string | null;
    }
  | { kind: 'not_found' }
  | { kind: 'no_geometry' };

/**
 * Odpowiedź ULDK: pierwsza linia to status („0” – sukces, „-1 …” – brak wyników), dalej rekordy z polami rozdzielonymi „|”.
 * Geometrii szukamy po treści (pole z „POLYGON”), a nie po pozycji – usługa bywa niekonsekwentna (puste linie, inne kolejności).
 */
export function parseUldkResponse(text: string): UldkParse {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);
  const status = lines[0] ?? '';
  if (status.startsWith('-1') || !status.startsWith('0')) return { kind: 'not_found' };
  for (const line of lines.slice(1)) {
    const fields = line.split('|').map((f) => f.trim());
    // ULDK czasem ignoruje parametr `result` i odsyła samą geometrię w WKB (hex). Wielokąt odczytujemy, inne typy pomijamy.
    const wkbField = fields.find((f) => /^[0-9A-F]{18,}$/i.test(f));
    if (wkbField && !fields.some((f) => /POLYGON\s*\(/i.test(f))) {
      const ring = parseWkbRing2180(wkbField);
      if (ring) return { kind: 'ok', id: null, wkt: null, ring2180: ring, voivodeship: null, county: null, commune: null, region: null };
      continue;
    }
    const wktIndex = fields.findIndex((f) => /POLYGON\s*\(/i.test(f));
    if (wktIndex < 0) continue;
    const after = fields.slice(wktIndex + 1);
    return {
      kind: 'ok',
      id: wktIndex > 0 ? fields[wktIndex - 1] || null : null,
      wkt: fields[wktIndex]!,
      voivodeship: after[0] || null,
      county: after[1] || null,
      commune: after[2] || null,
      region: after[3] || null,
    };
  }
  return { kind: 'no_geometry' };
}

/** Pierwszy pierścień wieloboku z (E)WKB w hex; współrzędne w EPSG:2180 (4326 przeliczamy). Null dla innych typów i bzdur. */
export function parseWkbRing2180(hex: string): Xy[] | null {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  const view = new DataView(bytes.buffer);
  let o = 0;
  const readHeader = () => {
    const le = view.getUint8(o) === 1;
    o += 1;
    const rawType = view.getUint32(o, le);
    o += 4;
    let srid: number | null = null;
    if (rawType & 0x20000000) {
      srid = view.getUint32(o, le);
      o += 4;
    }
    return { le, type: rawType & 0xffff, srid };
  };
  try {
    let { le, type, srid } = readHeader();
    if (type === 6) {
      // MULTIPOLYGON: liczba części, potem pierwszy wielobok z własnym nagłówkiem.
      o += 4;
      const inner = readHeader();
      le = inner.le;
      type = inner.type;
      srid = srid ?? inner.srid;
    }
    if (type !== 3) return null;
    const rings = view.getUint32(o, le);
    o += 4;
    if (rings < 1) return null;
    const n = view.getUint32(o, le);
    o += 4;
    if (n < 4 || n > 100000 || o + n * 16 > bytes.length) return null;
    const ring: Xy[] = [];
    for (let i = 0; i < n; i += 1) {
      const x = view.getFloat64(o, le);
      const y = view.getFloat64(o + 8, le);
      o += 16;
      ring.push(srid === 4326 ? wgs84To2180([x, y]) : [x, y]);
    }
    const valid = ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x > 100000 && x < 900000 && y > 100000 && y < 900000);
    return valid ? ring.slice(0, -1) : null;
  } catch {
    return null;
  }
}

/**
 * ULDK ma limit zapytań na adres IP: po serii zapytań odrzuca kolejne albo odsyła bezużyteczną odpowiedź.
 * Dlatego zapytania do ULDK idą po kolei, z odstępem, a ponowienia mają rosnące przerwy.
 */
const MIN_GAP_MS = 400;
const RETRY_DELAYS_MS = [1500, 4000];
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function throttled<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await run();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  queue = next.catch(() => undefined);
  return next;
}

/** Nieudane wyszukanie pamiętamy przez 30 s – ocena, teren i satelita nie odpytują ULDK każde osobno. */
const recentFailures = new Map<string, { at: number; result: ParcelLookup }>();
const FAILURE_TTL_MS = 30_000;

async function fetchFromUldk(parcelId: string): Promise<ParcelLookup> {
  const recent = recentFailures.get(parcelId);
  if (recent && Date.now() - recent.at < FAILURE_TTL_MS) return recent.result;
  const url = `${ULDK_URL}?request=GetParcelById&id=${encodeURIComponent(parcelId)}&result=${RESULT_FIELDS}&srid=2180`;
  const started = Date.now();
  let parsed: UldkParse = { kind: 'no_geometry' };
  let raw = '';
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
    raw = await throttled(async () => {
      try {
        // Nagłówki jak w przeglądarce – na takie zapytania ULDK odpowiada najstabilniej.
        const response = await fetch(url, {
          headers: {
            Accept: '*/*',
            'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(20000),
        });
        return response.ok ? await response.text() : `HTTP ${response.status}`;
      } catch (error) {
        return `błąd połączenia: ${errorText(error)}`;
      }
    });
    parsed = parseUldkResponse(raw);
    if (parsed.kind !== 'no_geometry') break;
  }
  const durationMs = Date.now() - started;
  if (parsed.kind === 'not_found') {
    return { status: 'not_found', message: 'Nie znaleziono działki o tym identyfikatorze w ewidencji (ULDK).' };
  }
  if (parsed.kind === 'no_geometry') {
    const snippet = raw.replace(/\s+/g, ' ').slice(0, 120);
    console.warn(`[ULDK] ${parcelId}: brak geometrii po ${RETRY_DELAYS_MS.length + 1} próbach. Odpowiedź: ${snippet}`);
    const result: ParcelLookup = {
      status: 'error',
      message:
        'Usługa ULDK (GUGiK) chwilowo nie podaje granicy tej działki – zwykle po serii zapytań blokuje je na ok. pół minuty. Spróbuj ponownie za chwilę.',
    };
    recentFailures.set(parcelId, { at: Date.now(), result });
    return result;
  }
  let ring2180: Xy[];
  try {
    ring2180 = parsed.ring2180 ?? parseWktOuterRing(parsed.wkt ?? '').ring;
  } catch (error) {
    return { status: 'error', message: `Nie udało się odczytać granicy działki z ULDK (${errorText(error)}).` };
  }
  recentFailures.delete(parcelId);
  return {
    status: 'ok',
    parcel: {
      id: parsed.id || parcelId,
      ring2180,
      ringWgs84: ring2180.map(epsg2180ToWgs84),
      areaHa: polygonArea(ring2180) / 10000,
      voivodeship: parsed.voivodeship,
      county: parsed.county,
      commune: parsed.commune,
      region: parsed.region,
      origin: 'observed',
      source: {
        name: 'Granica działki ewidencyjnej',
        provider: 'GUGiK – Usługa Lokalizacji Działek Katastralnych (ULDK)',
        url: ULDK_URL,
        origin: 'observed',
        retrievedAt: new Date().toISOString(),
        observationDate: null,
        resolutionM: null,
        durationMs,
        notes: ['Granica z ewidencji gruntów i budynków udostępniana przez ULDK; aktualność zależy od powiatu.'],
      },
    },
  };
}

export function errorText(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'przekroczony czas oczekiwania';
    return error.message;
  }
  return String(error);
}
