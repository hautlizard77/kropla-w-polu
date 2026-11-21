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

async function fetchFromUldk(parcelId: string): Promise<ParcelLookup> {
  const url =
    `${ULDK_URL}?request=GetParcelById&id=${encodeURIComponent(parcelId)}` +
    '&result=id,geom_wkt,voivodeship,county,commune,region&srid=2180';
  const started = Date.now();
  let text: string;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) return { status: 'error', message: `Usługa ULDK odpowiedziała błędem HTTP ${response.status}.` };
    text = await response.text();
  } catch (error) {
    return { status: 'error', message: `Nie udało się połączyć z usługą ULDK (${errorText(error)}).` };
  }
  const durationMs = Date.now() - started;
  const lines = text.trim().split(/\r?\n/);
  const statusLine = lines[0]?.trim() ?? '';
  if (!statusLine.startsWith('0') || lines.length < 2) {
    return { status: 'not_found', message: 'Nie znaleziono działki o tym identyfikatorze w ewidencji (ULDK).' };
  }
  const fields = (lines[1] ?? '').split('|');
  const [id, wkt, voivodeship, county, commune, region] = fields;
  if (!wkt) return { status: 'error', message: 'Usługa ULDK zwróciła odpowiedź bez geometrii.' };
  const { ring } = parseWktOuterRing(wkt);
  const ring2180 = ring;
  return {
    status: 'ok',
    parcel: {
      id: id?.trim() || parcelId,
      ring2180,
      ringWgs84: ring2180.map(epsg2180ToWgs84),
      areaHa: polygonArea(ring2180) / 10000,
      voivodeship: voivodeship?.trim() || null,
      county: county?.trim() || null,
      commune: commune?.trim() || null,
      region: region?.trim() || null,
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
