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
  | { kind: 'ok'; id: string | null; wkt: string; voivodeship: string | null; county: string | null; commune: string | null; region: string | null }
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

async function fetchFromUldk(parcelId: string): Promise<ParcelLookup> {
  const url = `${ULDK_URL}?request=GetParcelById&id=${encodeURIComponent(parcelId)}&result=${RESULT_FIELDS}&srid=2180`;
  const started = Date.now();
  let parsed: UldkParse = { kind: 'no_geometry' };
  let raw = '';
  // ULDK przy chwilowym przeciążeniu potrafi odesłać „0” bez rekordu – wtedy ponawiamy (łącznie 3 próby).
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/plain, */*', 'User-Agent': 'KroplaWPolu/1.0 (+https://github.com/hautlizard77/woda-na-polu)' },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        raw = `HTTP ${response.status}`;
        continue;
      }
      raw = await response.text();
    } catch (error) {
      raw = errorText(error);
      continue;
    }
    parsed = parseUldkResponse(raw);
    if (parsed.kind !== 'no_geometry') break;
  }
  const durationMs = Date.now() - started;
  if (parsed.kind === 'not_found') {
    return { status: 'not_found', message: 'Nie znaleziono działki o tym identyfikatorze w ewidencji (ULDK).' };
  }
  if (parsed.kind === 'no_geometry') {
    const snippet = raw.replace(/\s+/g, ' ').slice(0, 160);
    console.warn(`[ULDK] ${parcelId}: brak geometrii po 3 próbach. Odpowiedź: ${snippet}`);
    return { status: 'error', message: `Usługa ULDK nie zwróciła granicy działki (3 próby). Odpowiedź usługi: „${snippet}”.` };
  }
  let ring2180: Xy[];
  try {
    ring2180 = parseWktOuterRing(parsed.wkt).ring;
  } catch (error) {
    return { status: 'error', message: `Nie udało się odczytać granicy działki z ULDK (${errorText(error)}).` };
  }
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
