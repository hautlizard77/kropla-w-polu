/**
 * Cieki i rowy w pobliżu działki z OpenStreetMap (Overpass API, licencja ODbL).
 *
 * Oficjalna Mapa Podziału Hydrograficznego Polski (MPHP10k) nie ma publicznej usługi WFS dostępnej bez autoryzacji,
 * dlatego używamy OSM. Kompletność danych o małych rowach w OSM jest różna – brak rowu w danych nie oznacza,
 * że go nie ma. Zapytanie ma krótki limit czasu, żeby nie wydłużać analizy.
 */
import type { SourceInfo, Xy } from '../../src/types/terrain';
import { cacheGet, cacheSet } from '../cache';
import { pointInPolygon } from '../geo/geometry';
import { wgs84To2180 } from '../geo/proj';
import { errorText } from './uldk';

export interface Waterway {
  kind: 'rzeka' | 'strumień' | 'kanał' | 'rów' | 'rów odwadniający';
  name: string | null;
  /** Najmniejsza odległość od granicy działki, m (0 = przecina działkę). */
  distanceM: number;
}

export interface HydroResult {
  status: 'ok' | 'unavailable';
  waterways: Waterway[];
  searchRadiusM: number;
  source: SourceInfo;
  message: string;
}

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const DEADLINE_MS = 4000;
/** Po nieudanej próbie przez 15 min nie pytamy ponownie o tę działkę – kolejne oceny nie czekają na martwe serwery. */
const FAILURE_TTL_MS = 15 * 60 * 1000;
const failures = new Map<string, { at: number; errors: string[] }>();
const KINDS: Record<string, Waterway['kind']> = { river: 'rzeka', stream: 'strumień', canal: 'kanał', ditch: 'rów', drain: 'rów odwadniający' };
const HYDRO_VERSION = 1;

export async function getWaterways(parcelId: string, ringWgs84: Xy[], ring2180: Xy[], radiusM = 300): Promise<HydroResult> {
  const key = `v${HYDRO_VERSION}:${parcelId}:${radiusM}`;
  const cached = await cacheGet<HydroResult>('hydro', key);
  if (cached) return cached;
  const started = Date.now();
  const lat = ringWgs84.reduce((s, p) => s + p[1], 0) / ringWgs84.length;
  const lon = ringWgs84.reduce((s, p) => s + p[0], 0) / ringWgs84.length;
  const parcelRadius = Math.max(...ring2180.map((p) => Math.hypot(p[0] - ring2180[0]![0], p[1] - ring2180[0]![1])));
  const around = Math.round(parcelRadius + radiusM);
  const query = `[out:json][timeout:5];way["waterway"~"^(river|stream|canal|ditch|drain)$"](around:${around},${lat},${lon});out geom tags;`;
  const recentFailure = failures.get(key);
  if (recentFailure && Date.now() - recentFailure.at < FAILURE_TTL_MS) return unavailable(radiusM, 0, recentFailure.errors);
  const errors: string[] = [];
  // Serwery Overpass bywają przeciążone – pytamy wszystkie naraz i bierzemy pierwszą odpowiedź, z twardym limitem czasu,
  // żeby brak cieków nie wstrzymywał całej oceny.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), DEADLINE_MS);
  try {
    const json = await Promise.any(
      MIRRORS.map(async (mirror) => {
        try {
          const response = await fetch(mirror, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(query)}`,
            signal: deadline.signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return (await response.json()) as { elements?: { tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[] };
        } catch (error) {
          errors.push(`${new URL(mirror).host}: ${deadline.signal.aborted ? `brak odpowiedzi w ${DEADLINE_MS / 1000} s` : errorText(error)}`);
          throw error;
        }
      }),
    );
    deadline.abort();
    const waterways: Waterway[] = [];
    for (const element of json.elements ?? []) {
      const kind = KINDS[element.tags?.waterway ?? ''];
      if (!kind || !element.geometry?.length) continue;
      const line = element.geometry.map((g) => wgs84To2180([g.lon, g.lat]));
      const distanceM = Math.round(distanceToParcel(line, ring2180));
      if (distanceM <= radiusM) waterways.push({ kind, name: element.tags?.name ?? null, distanceM });
    }
    waterways.sort((a, b) => a.distanceM - b.distanceM);
    const result: HydroResult = {
      status: 'ok',
      waterways: waterways.slice(0, 20),
      searchRadiusM: radiusM,
      message:
        waterways.length > 0
          ? `W promieniu ${radiusM} m od działki: ${waterways.length} odcinków cieków lub rowów (najbliższy ${waterways[0]?.distanceM} m).`
          : `W danych OpenStreetMap nie ma cieków ani rowów w promieniu ${radiusM} m od działki.`,
      source: {
        name: 'Cieki i rowy w pobliżu działki',
        provider: 'OpenStreetMap (Overpass API), © współtwórcy OpenStreetMap, ODbL',
        url: 'https://www.openstreetmap.org',
        origin: 'observed',
        retrievedAt: new Date().toISOString(),
        observationDate: null,
        resolutionM: null,
        durationMs: Date.now() - started,
        notes: ['Kompletność danych o małych rowach w OSM jest różna – brak rowu w danych nie oznacza, że go nie ma.'],
      },
    };
    await cacheSet('hydro', key, result);
    return result;
  } catch {
    failures.set(key, { at: Date.now(), errors });
    return unavailable(radiusM, Date.now() - started, errors);
  } finally {
    clearTimeout(timer);
  }
}

function unavailable(radiusM: number, durationMs: number, errors: string[]): HydroResult {
  return {
    status: 'unavailable',
    waterways: [],
    searchRadiusM: radiusM,
    message: 'Nie udało się pobrać danych o ciekach i rowach – sprawdź je w terenie lub na mapie Hydroportalu.',
    source: {
      name: 'Cieki i rowy w pobliżu działki',
      provider: 'OpenStreetMap (Overpass API)',
      url: 'https://www.openstreetmap.org',
      origin: 'observed',
      retrievedAt: null,
      observationDate: null,
      resolutionM: null,
      durationMs,
      notes: [`Usługa niedostępna: ${errors.join('; ')}`],
    },
  };
}

function distanceToParcel(line: Xy[], ring: Xy[]): number {
  let best = Infinity;
  for (const p of line) {
    if (pointInPolygon(p, ring)) return 0;
    for (let i = 0; i < ring.length; i += 1) best = Math.min(best, segmentDistance(p, ring[i] as Xy, ring[(i + 1) % ring.length] as Xy));
  }
  return best;
}

function segmentDistance([px, py]: Xy, [ax, ay]: Xy, [bx, by]: Xy): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
