/**
 * Cieki i rowy w pobliżu działki.
 *
 * Główne źródło: Mapa Podziału Hydrograficznego Polski 1:10 000 (MPHP10, PGW Wody Polskie) z publicznej usługi WMS
 * ISOK (`wody.isok.gov.pl`, warstwa „Odcinki cieków”). GetFeatureInfo zwraca atrybuty (nazwa, charakter, szerokość,
 * typ okresowy/stały), ale bez geometrii – odległość szacujemy pierścieniami: pytamy o prostokąt działki powiększony
 * o 50, 100 i 300 m i bierzemy najmniejszy, w którym ciek się pojawia (wynik „do X m”).
 *
 * Uzupełnienie: OpenStreetMap (Overpass) – tam bywają drobne rowy melioracyjne, których MPHP nie zawiera. OSM daje
 * geometrię, więc odległość jest dokładna. Oba źródła pytamy równolegle z krótkim limitem czasu.
 */
import type { SourceInfo, Xy } from '../../src/types/terrain';
import { cacheGet, cacheSet } from '../cache';
import { pointInPolygon } from '../geo/geometry';
import { wgs84To2180 } from '../geo/proj';
import { errorText } from './uldk';

export interface Waterway {
  kind: 'rzeka' | 'strumień' | 'kanał' | 'rów' | 'rów odwadniający' | 'ciek';
  name: string | null;
  /** Odległość od granicy działki, m (0 = przecina działkę). Gdy `approx`, to górna granica („do X m”). */
  distanceM: number;
  approx?: boolean;
  /** Np. „okresowy, szer. poniżej 1,5 m”. */
  details?: string;
  origin: 'mphp' | 'osm';
}

export interface HydroResult {
  status: 'ok' | 'unavailable';
  waterways: Waterway[];
  searchRadiusM: number;
  source: SourceInfo;
  license: string;
  message: string;
}

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const MPHP_WMS = 'https://wody.isok.gov.pl/gpservices/KZGW/ISOK_MPHP/MapServer/WMSServer';
/** Warstwa 19 – „Odcinki cieków” MPHP10 (pełne atrybuty). */
const MPHP_LAYER = '19';
const MPHP_RINGS_M = [50, 100, 300];
const DEADLINE_MS = 4000;
const MPHP_DEADLINE_MS = 8000;
/** Po nieudanej próbie przez 15 min nie pytamy ponownie o tę działkę – kolejne oceny nie czekają na martwe serwery. */
const FAILURE_TTL_MS = 15 * 60 * 1000;
const failures = new Map<string, { at: number; errors: string[] }>();
const KINDS: Record<string, Waterway['kind']> = { river: 'rzeka', stream: 'strumień', canal: 'kanał', ditch: 'rów', drain: 'rów odwadniający' };
const HYDRO_VERSION = 2;

type SourceHit = { waterways: Waterway[]; durationMs: number };

export async function getWaterways(parcelId: string, ringWgs84: Xy[], ring2180: Xy[], radiusM = 300): Promise<HydroResult> {
  const key = `v${HYDRO_VERSION}:${parcelId}:${radiusM}`;
  const cached = await cacheGet<HydroResult>('hydro', key);
  if (cached) return cached;
  const recentFailure = failures.get(key);
  if (recentFailure && Date.now() - recentFailure.at < FAILURE_TTL_MS) return unavailable(radiusM, 0, recentFailure.errors);
  const started = Date.now();
  const errors: string[] = [];
  const [mphp, osm] = await Promise.allSettled([
    fetchMphp(ring2180, radiusM).catch((error) => {
      errors.push(`MPHP (Wody Polskie): ${errorText(error)}`);
      throw error;
    }),
    fetchOsm(ringWgs84, ring2180, radiusM).catch((error) => {
      errors.push(`OpenStreetMap: ${errorText(error)}`);
      throw error;
    }),
  ]);
  if (mphp.status === 'rejected' && osm.status === 'rejected') {
    failures.set(key, { at: Date.now(), errors });
    return unavailable(radiusM, Date.now() - started, errors);
  }
  const official = mphp.status === 'fulfilled' ? mphp.value.waterways : [];
  const extra = osm.status === 'fulfilled' ? osm.value.waterways : [];
  const waterways = mergeWaterways(official, extra);
  const nearest = waterways[0];
  const parts: string[] = [];
  if (mphp.status === 'fulfilled') parts.push(`MPHP10 Wód Polskich: ${official.length}`);
  if (osm.status === 'fulfilled') parts.push(`OpenStreetMap: ${extra.length}`);
  const providers = [
    mphp.status === 'fulfilled' ? 'PGW Wody Polskie – MPHP10 (WMS ISOK)' : null,
    osm.status === 'fulfilled' ? 'OpenStreetMap (Overpass API), © współtwórcy OpenStreetMap' : null,
  ].filter(Boolean);
  const notes = [
    'MPHP podaje cieki bez geometrii w odpowiedzi WMS – odległość „do X m” to górna granica (pierścienie 50/100/300 m).',
    'Drobne rowy melioracyjne często nie są w MPHP; uzupełniamy je z OpenStreetMap, gdzie kompletność jest różna.',
    ...errors.map((e) => `Niedostępne: ${e}`),
  ];
  const result: HydroResult = {
    status: 'ok',
    waterways: waterways.slice(0, 20),
    searchRadiusM: radiusM,
    license: [mphp.status === 'fulfilled' ? 'dane publiczne PGW Wody Polskie' : null, osm.status === 'fulfilled' ? 'ODbL' : null].filter(Boolean).join('; '),
    message: nearest
      ? `W promieniu ${radiusM} m od działki: ${waterways.length} ${plural(waterways.length)} (najbliższy: ${describe(nearest)}, ${distanceText(nearest)}). Źródła – ${parts.join(', ')}.`
      : `W promieniu ${radiusM} m od działki nie ma cieków ani rowów w danych (${parts.join(', ')}).`,
    source: {
      name: 'Cieki i rowy w pobliżu działki',
      provider: providers.join(' + '),
      url: mphp.status === 'fulfilled' ? 'https://isok.gov.pl/hydroportal.html' : 'https://www.openstreetmap.org',
      origin: 'observed',
      retrievedAt: new Date().toISOString(),
      observationDate: null,
      resolutionM: null,
      durationMs: Date.now() - started,
      notes,
    },
  };
  // Częściowy wynik (jedno źródło padło) trzymamy krócej – w pamięci podręcznej zapisujemy tylko pełny.
  if (errors.length === 0) await cacheSet('hydro', key, result);
  return result;
}

/** Słowny opis cieku do komunikatów i zaleceń, np. „rów (Rów Główny)”. */
export function describe(w: Waterway): string {
  return `${w.kind}${w.name ? ` ${w.name}` : ''}`;
}

export function distanceText(w: Waterway): string {
  if (w.distanceM === 0) return 'przecina działkę';
  return w.approx ? `do ${w.distanceM} m` : `ok. ${w.distanceM} m`;
}

function plural(n: number): string {
  if (n === 1) return 'ciek lub rów';
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'cieki lub rowy' : 'cieków lub rowów';
}

/** Łączy wyniki: MPHP jest źródłem nadrzędnym; z OSM dodajemy tylko to, czego nie ma w MPHP (inna nazwa lub bez nazwy rowu). */
export function mergeWaterways(official: Waterway[], osm: Waterway[]): Waterway[] {
  const names = new Set(official.map((w) => normalize(w.name)).filter((n) => n));
  const out = [...official];
  for (const w of osm) {
    const n = normalize(w.name);
    if (n && names.has(n)) {
      // Ten sam ciek – OSM ma geometrię, więc może doprecyzować odległość.
      const match = out.find((o) => normalize(o.name) === n);
      if (match && match.approx && w.distanceM <= match.distanceM) {
        match.distanceM = w.distanceM;
        match.approx = false;
      }
      continue;
    }
    // Rzeki i kanały z nazwą są w MPHP; z OSM bierzemy głównie rowy i nienazwane cieki.
    if (official.length > 0 && !n && (w.kind === 'rzeka' || w.kind === 'kanał')) continue;
    out.push(w);
  }
  return out.sort((a, b) => a.distanceM - b.distanceM || (a.approx ? 1 : 0) - (b.approx ? 1 : 0));
}

function normalize(name: string | null): string {
  return (name ?? '').toLocaleLowerCase('pl-PL').replace(/\s+/g, ' ').trim();
}

// ---------- MPHP (Wody Polskie) ----------

interface MphpProps {
  Nazwarzeki?: string;
  Charakterodcinkacieku?: string;
  Typodcinkacieku?: string;
  ['Szerokośćodcinkaciekum']?: string;
  Rodzajodcinkacieku?: string;
  Identyfikatorhydrograficznycieku?: string;
  ObjectID?: string;
}

async function fetchMphp(ring2180: Xy[], radiusM: number): Promise<SourceHit> {
  const started = Date.now();
  const bounds = boundsOf(ring2180);
  const rings = MPHP_RINGS_M.filter((r) => r < radiusM).concat(radiusM);
  const signal = AbortSignal.timeout(MPHP_DEADLINE_MS);
  const results = await Promise.all(rings.map((r) => queryMphp(bounds, r, signal)));
  return { waterways: parseMphpRings(rings, results), durationMs: Date.now() - started };
}

/** Z wyników kolejnych pierścieni wybiera dla każdego cieku najmniejszy pierścień, w którym się pojawił. */
export function parseMphpRings(rings: number[], results: MphpProps[][]): Waterway[] {
  const byCourse = new Map<string, Waterway>();
  rings.forEach((ring, i) => {
    for (const p of results[i] ?? []) {
      const kind = mphpKind(p.Charakterodcinkacieku);
      if (!kind) continue;
      const name = cleanName(p.Nazwarzeki);
      const id = `${kind}|${name ?? p.Identyfikatorhydrograficznycieku ?? p.ObjectID}`;
      const prev = byCourse.get(id);
      if (prev && prev.distanceM <= ring) continue;
      const details = [p.Typodcinkacieku && p.Typodcinkacieku !== 'stały' ? p.Typodcinkacieku : null, widthText(p['Szerokośćodcinkaciekum'])]
        .filter(Boolean)
        .join(', ');
      byCourse.set(id, { kind, name, distanceM: ring, approx: true, origin: 'mphp', ...(details ? { details } : {}) });
    }
  });
  return [...byCourse.values()].sort((a, b) => a.distanceM - b.distanceM);
}

function mphpKind(charakter: string | undefined): Waterway['kind'] | null {
  const c = (charakter ?? '').toLowerCase();
  if (c.includes('rurociąg')) return null; // przepływ w rurze – nie da się na nim zatrzymać wody
  if (c.includes('rów')) return 'rów';
  if (c.includes('kanał')) return 'kanał';
  if (c.includes('rzeka')) return 'rzeka';
  if (c.includes('potok') || c.includes('struga')) return 'strumień';
  if (c.includes('ciek')) return 'ciek';
  return null;
}

function widthText(w: string | undefined): string | null {
  if (!w || w.startsWith('nieokreślona')) return null;
  return `szer. ${w.replace(/\s+/g, ' ')}`;
}

function cleanName(n: string | undefined): string | null {
  const t = (n ?? '').trim();
  return t && t !== '-' && t.toLowerCase() !== 'brak' ? t : null;
}

async function queryMphp(b: { minX: number; minY: number; maxX: number; maxY: number }, r: number, signal: AbortSignal): Promise<MphpProps[]> {
  // Prostokąt 3×3 px z kliknięciem w środek: tolerancja kliknięcia obejmuje cały prostokąt.
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetFeatureInfo',
    SRS: 'EPSG:2180',
    STYLES: '',
    FORMAT: 'image/png',
    LAYERS: MPHP_LAYER,
    QUERY_LAYERS: MPHP_LAYER,
    BBOX: [b.minX - r, b.minY - r, b.maxX + r, b.maxY + r].map((v) => Math.round(v)).join(','),
    WIDTH: '3',
    HEIGHT: '3',
    X: '1',
    Y: '1',
    INFO_FORMAT: 'application/geojson',
    FEATURE_COUNT: '100',
  });
  const response = await fetch(`${MPHP_WMS}?${params}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  let json: { features?: { properties?: MphpProps }[] };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error(`nieoczekiwana odpowiedź: ${text.slice(0, 80).replace(/\s+/g, ' ')}`);
  }
  return (json.features ?? []).map((f) => f.properties ?? {});
}

function boundsOf(ring: Xy[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

// ---------- OpenStreetMap (Overpass) ----------

async function fetchOsm(ringWgs84: Xy[], ring2180: Xy[], radiusM: number): Promise<SourceHit> {
  const started = Date.now();
  const lat = ringWgs84.reduce((s, p) => s + p[1], 0) / ringWgs84.length;
  const lon = ringWgs84.reduce((s, p) => s + p[0], 0) / ringWgs84.length;
  let parcelRadius = 0;
  for (const p of ring2180) parcelRadius = Math.max(parcelRadius, Math.hypot(p[0] - ring2180[0]![0], p[1] - ring2180[0]![1]));
  const around = Math.round(parcelRadius + radiusM);
  const query = `[out:json][timeout:5];way["waterway"~"^(river|stream|canal|ditch|drain)$"](around:${around},${lat},${lon});out geom tags;`;
  const errors: string[] = [];
  // Serwery Overpass bywają przeciążone – pytamy wszystkie naraz i bierzemy pierwszą odpowiedź, z twardym limitem czasu.
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
    ).catch(() => {
      throw new Error(errors.join('; '));
    });
    deadline.abort();
    const waterways: Waterway[] = [];
    for (const element of json.elements ?? []) {
      const kind = KINDS[element.tags?.waterway ?? ''];
      if (!kind || !element.geometry?.length) continue;
      const line = element.geometry.map((g) => wgs84To2180([g.lon, g.lat]));
      const distanceM = Math.round(distanceToParcel(line, ring2180));
      if (distanceM <= radiusM) waterways.push({ kind, name: element.tags?.name ?? null, distanceM, origin: 'osm' });
    }
    // Ten sam ciek bywa pocięty na wiele odcinków – zostawiamy najbliższy.
    const best = new Map<string, Waterway>();
    for (const w of waterways) {
      const id = w.name ? `${w.kind}|${normalize(w.name)}` : `${w.kind}|${w.distanceM}|${best.size}`;
      const prev = best.get(id);
      if (!prev || w.distanceM < prev.distanceM) best.set(id, w);
    }
    return { waterways: [...best.values()].sort((a, b) => a.distanceM - b.distanceM), durationMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function unavailable(radiusM: number, durationMs: number, errors: string[]): HydroResult {
  return {
    status: 'unavailable',
    waterways: [],
    searchRadiusM: radiusM,
    license: '',
    message: 'Nie udało się pobrać danych o ciekach i rowach (Wody Polskie MPHP ani OpenStreetMap nie odpowiedziały) – sprawdź je w terenie lub na mapie Hydroportalu.',
    source: {
      name: 'Cieki i rowy w pobliżu działki',
      provider: 'PGW Wody Polskie – MPHP10 (WMS ISOK); OpenStreetMap (Overpass API)',
      url: 'https://isok.gov.pl/hydroportal.html',
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
