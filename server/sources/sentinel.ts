/**
 * NDMI z Sentinel-2 L2A (katalog STAC Earth Search, pliki COG w AWS Open Data).
 *
 * NDMI = (B8A − B11) / (B8A + B11), oba pasma w rozdzielczości 20 m.
 * Maska z warstwy klasyfikacji sceny (SCL): zostawiamy tylko klasy 4 (roślinność), 5 (grunt bez roślinności)
 * i 6 (woda); odrzucamy brak danych, nasycenie, cienie, chmury, cirrus, śnieg i piksele niesklasyfikowane.
 * Używamy tylko scen z daty analizy lub wcześniejszych.
 */
import type { GridSpec, NdmiResult, NdmiScene, ParcelInfo, SourceInfo, Xy } from '../../src/types/terrain';
import { boundsOf, pointInPolygon } from '../geo/geometry';
import { epsg2180ToWgs84, projectionForEpsg, type Projection } from '../geo/proj';
import { HttpRangeSource, Tiff, windowForBounds } from '../geo/tiff';
import { errorText } from './uldk';

export const STAC_URL = 'https://earth-search.aws.element84.com/v1';
export const NDMI_VERSION = 2;
export const MIN_COVERAGE_PCT = 60;
export const SEARCH_DAYS = 45;
const MAX_SCENES = 6;
const VALID_SCL = new Set([4, 5, 6]);

interface StacItem {
  id: string;
  properties: Record<string, unknown>;
  assets: Record<string, { href: string } | undefined>;
}

interface Window {
  x0: number;
  y0: number;
  w: number;
  h: number;
  originX: number;
  originY: number;
  pixel: number;
}

export function minusDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) - days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Pierścień GeoJSON: bez powtórzonych kolejnych punktów i zamknięty dokładnie raz. Earth Search odrzuca (HTTP 400)
 * wielokąt z dwoma identycznymi punktami na końcu („edges adjacent … coincide”) – a ring z ULDK bywa już zamknięty.
 */
export function closedRing(ring: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  if (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (first[0] === last[0] && first[1] === last[1]) out.pop();
  }
  return out.length > 0 ? [...out, out[0]!] : out;
}

export async function computeNdmi(parcel: ParcelInfo, analysisDate: string, displayGrid: GridSpec): Promise<Omit<NdmiResult, 'cached'>> {
  const timings: { label: string; ms: number }[] = [];
  const started = Date.now();
  const from = minusDays(analysisDate, SEARCH_DAYS);
  // Przelot Sentinel-2 nad Polską ok. 9–10 UTC; koniec dnia analizy w Polsce to najpóźniej 22:59 UTC.
  const body = {
    collections: ['sentinel-2-l2a'],
    intersects: { type: 'Polygon', coordinates: [closedRing(parcel.ringWgs84)] },
    datetime: `${from}T00:00:00Z/${analysisDate}T21:59:59Z`,
    limit: 40,
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
  };
  const response = await fetch(`${STAC_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Katalog STAC odpowiedział błędem HTTP ${response.status}`);
  const json = (await response.json()) as { features?: StacItem[] };
  timings.push({ label: 'Wyszukanie scen Sentinel-2 (STAC)', ms: Date.now() - started });
  const items = selectScenes(json.features ?? [], analysisDate);

  const checked: NdmiScene[] = [];
  const stacSource: SourceInfo = {
    name: 'Katalog scen Sentinel-2 L2A',
    provider: 'Element 84 Earth Search (STAC), dane Copernicus Sentinel-2 w AWS Open Data',
    url: STAC_URL,
    origin: 'observed',
    retrievedAt: new Date().toISOString(),
    observationDate: null,
    resolutionM: null,
    durationMs: timings[0]?.ms ?? null,
    notes: [`Przeszukano ${SEARCH_DAYS} dni przed datą analizy (${from} – ${analysisDate}); znaleziono ${items.length} scen.`],
  };

  let bytes = 0;
  let requests = 0;
  for (const item of items.slice(0, MAX_SCENES)) {
    const sceneStarted = Date.now();
    const epsg = epsgOf(item);
    const scl = item.assets.scl?.href;
    const nir = item.assets.nir08?.href;
    const swir = item.assets.swir16?.href;
    if (!epsg || !scl || !nir || !swir) continue;
    const projection = projectionForEpsg(epsg);
    const ringUtm = parcel.ringWgs84.map((p) => projection.forward(p));
    const sclSource = new HttpRangeSource(scl);
    let sclTiff: Tiff;
    try {
      sclTiff = await Tiff.open(sclSource);
    } catch (error) {
      checked.push(scene(item, 0));
      stacSource.notes.push(`Scena ${item.id}: nie udało się odczytać SCL (${errorText(error)}).`);
      continue;
    }
    const window = windowOf(sclTiff, ringUtm);
    const sclValues = await sclTiff.readWindow(window.x0, window.y0, window.w, window.h);
    bytes += sclSource.bytesFetched;
    requests += sclSource.requests;
    const parcelPixels = parcelPixelIndices(window, ringUtm);
    let valid = 0;
    for (const i of parcelPixels) if (VALID_SCL.has(sclValues[i] as number)) valid += 1;
    const coverage = parcelPixels.length > 0 ? (100 * valid) / parcelPixels.length : 0;
    const info = scene(item, coverage);
    checked.push(info);
    timings.push({ label: `Maska chmur sceny ${info.date}`, ms: Date.now() - sceneStarted });
    if (coverage < MIN_COVERAGE_PCT) continue;

    const bandsStarted = Date.now();
    const nirSource = new HttpRangeSource(nir);
    const swirSource = new HttpRangeSource(swir);
    const [nirTiff, swirTiff] = await Promise.all([Tiff.open(nirSource), Tiff.open(swirSource)]);
    const [nirValues, swirValues] = await Promise.all([
      nirTiff.readWindow(window.x0, window.y0, window.w, window.h),
      swirTiff.readWindow(window.x0, window.y0, window.w, window.h),
    ]);
    bytes += nirSource.bytesFetched + swirSource.bytesFetched;
    requests += nirSource.requests + swirSource.requests;
    timings.push({ label: `Pasma B8A i B11 sceny ${info.date}`, ms: Date.now() - bandsStarted });

    const offset = boaOffset(item);
    const ndmi = new Float64Array(window.w * window.h).fill(Number.NaN);
    for (let i = 0; i < ndmi.length; i += 1) {
      if (!VALID_SCL.has(sclValues[i] as number)) continue;
      const n = nirValues[i] as number;
      const s = swirValues[i] as number;
      if (!(n > 0) || !(s > 0)) continue;
      const rn = (n - offset) / 10000;
      const rs = (s - offset) / 10000;
      if (rn + rs <= 0) continue;
      ndmi[i] = (rn - rs) / (rn + rs);
    }
    const result = buildResult({
      parcel,
      analysisDate,
      displayGrid,
      ndmi,
      window,
      projection,
      ringUtm,
      parcelPixels,
      chosen: info,
      checked,
      sources: [
        stacSource,
        {
          name: 'NDMI z pasm B8A i B11 (Sentinel-2 L2A, 20 m)',
          provider: 'Copernicus Sentinel-2 (ESA), pliki COG w AWS Open Data',
          url: nir.replace(/\/[^/]+$/, '/'),
          origin: 'observed',
          retrievedAt: new Date().toISOString(),
          observationDate: info.date,
          resolutionM: 20,
          durationMs: Date.now() - sceneStarted,
          notes: [
            `Scena ${item.id}, zachmurzenie całej sceny ${info.cloudCoverPct ?? 'b.d.'}%.`,
            `Przesunięcie BOA ${offset > 0 ? 'odjęte (−1000)' : 'nie dotyczy'}; pobrano ${Math.round(bytes / 1024)} KB w ${requests} zapytaniach.`,
          ],
        },
      ],
      timings,
      origin: 'observed',
    });
    return result;
  }

  const best = [...checked].sort((a, b) => b.usefulCoveragePct - a.usefulCoveragePct)[0];
  return {
    version: NDMI_VERSION,
    parcelId: parcel.id,
    analysisDate,
    origin: 'observed',
    scene: null,
    checkedScenes: checked,
    resolutionM: 20,
    minCoveragePct: MIN_COVERAGE_PCT,
    values: [],
    deviationMask: [],
    stats: null,
    message:
      items.length === 0
        ? `Brak scen Sentinel-2 L2A nad działką w ciągu ${SEARCH_DAYS} dni przed datą analizy.`
        : `Brak obserwacji z wystarczającym pokryciem działki. Najlepsza sprawdzona scena (${best?.date ?? 'b.d.'}) ma ${Math.round(best?.usefulCoveragePct ?? 0)}% działki bez chmur, cieni i braków danych (wymagane ${MIN_COVERAGE_PCT}%).`,
    sources: [stacSource],
    timings,
    limitations: ndmiLimitations(),
  };
}

/** Tylko sceny z daty analizy lub wcześniejsze (dzień w Polsce), od najnowszej. */
export function selectScenes<T extends { properties: Record<string, unknown> }>(items: T[], analysisDate: string): T[] {
  return items
    .filter((item) => warsawDate(String(item.properties.datetime ?? '')) <= analysisDate)
    .sort((a, b) => String(b.properties.datetime).localeCompare(String(a.properties.datetime)));
}

/** Data kalendarzowa w Polsce dla znacznika czasu UTC. */
export function warsawDate(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) return isoDateTime.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export const VALID_SCL_CLASSES = VALID_SCL;

function epsgOf(item: StacItem): number | null {
  const direct = item.properties['proj:epsg'];
  if (typeof direct === 'number') return direct;
  const code = item.properties['proj:code'];
  if (typeof code === 'string') {
    const match = /EPSG:(\d+)/.exec(code);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

/** Od linii przetwarzania 04.00 (25.01.2022) do wartości dodano przesunięcie 1000; Earth Search czasem już je odjął. */
function boaOffset(item: StacItem): number {
  if (item.properties['earthsearch:boa_offset_applied'] === true) return 0;
  const baseline = Number.parseFloat(String(item.properties['s2:processing_baseline'] ?? '0'));
  if (baseline >= 4) return 1000;
  const date = String(item.properties.datetime ?? '');
  return date >= '2022-01-25' && !item.properties['s2:processing_baseline'] ? 1000 : 0;
}

function scene(item: StacItem, coverage: number): NdmiScene {
  const datetime = String(item.properties.datetime ?? '');
  const localDate = warsawDate(datetime);
  const cloud = item.properties['eo:cloud_cover'];
  return {
    id: item.id,
    datetime,
    date: localDate,
    cloudCoverPct: typeof cloud === 'number' ? Math.round(cloud * 10) / 10 : null,
    usefulCoveragePct: Math.round(coverage * 10) / 10,
  };
}

function windowOf(tiff: Tiff, ringUtm: Xy[]): Window {
  const image = tiff.main;
  const geo = image.geo;
  if (!geo) throw new Error('Plik SCL bez georeferencji');
  const w = windowForBounds(image, boundsOf(ringUtm));
  return { ...w, originX: geo.originX, originY: geo.originY, pixel: geo.pixelWidth };
}

function pixelCenter(window: Window, col: number, row: number): Xy {
  return [window.originX + (window.x0 + col + 0.5) * window.pixel, window.originY - (window.y0 + row + 0.5) * window.pixel];
}

function parcelPixelIndices(window: Window, ringUtm: Xy[]): number[] {
  const out: number[] = [];
  for (let row = 0; row < window.h; row += 1) {
    for (let col = 0; col < window.w; col += 1) {
      if (pointInPolygon(pixelCenter(window, col, row), ringUtm)) out.push(row * window.w + col);
    }
  }
  if (out.length === 0) {
    // Działka mniejsza niż piksel 20 m – bierzemy piksel najbliższy środkowi działki.
    const b = boundsOf(ringUtm);
    const col = Math.floor(((b.minX + b.maxX) / 2 - window.originX) / window.pixel) - window.x0;
    const row = Math.floor((window.originY - (b.minY + b.maxY) / 2) / window.pixel) - window.y0;
    if (col >= 0 && row >= 0 && col < window.w && row < window.h) out.push(row * window.w + col);
  }
  return out;
}

interface BuildInput {
  parcel: ParcelInfo;
  analysisDate: string;
  displayGrid: GridSpec;
  ndmi: Float64Array;
  window: Window;
  projection: Projection;
  ringUtm: Xy[];
  parcelPixels: number[];
  chosen: NdmiScene;
  checked: NdmiScene[];
  sources: SourceInfo[];
  timings: { label: string; ms: number }[];
  origin: 'observed' | 'demo';
}

/** Statystyki działki, odchylenia i przeniesienie NDMI na siatkę wyświetlania terenu (EPSG:2180). */
export function buildResult(input: BuildInput): Omit<NdmiResult, 'cached'> {
  const { ndmi, window, parcelPixels, displayGrid } = input;
  const parcelValues = parcelPixels.map((i) => ndmi[i] as number).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const q = (p: number) => parcelValues[Math.min(parcelValues.length - 1, Math.floor(p * parcelValues.length))] ?? Number.NaN;
  const median = q(0.5);
  const deviations = parcelValues.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)] ?? 0;
  const limit = Math.max(0.06, 2 * 1.4826 * mad);
  const inParcel = new Uint8Array(ndmi.length);
  for (const i of parcelPixels) inParcel[i] = 1;
  let deviating = 0;
  const deviatingPixel = new Uint8Array(ndmi.length);
  for (const i of parcelPixels) {
    const v = ndmi[i] as number;
    if (Number.isFinite(v) && Math.abs(v - median) > limit) {
      deviatingPixel[i] = 1;
      deviating += 1;
    }
  }

  const values: (number | null)[] = [];
  const deviationMask: number[] = [];
  for (let row = 0; row < displayGrid.height; row += 1) {
    for (let col = 0; col < displayGrid.width; col += 1) {
      const p2180: Xy = [displayGrid.originX + (col + 0.5) * displayGrid.cellSize, displayGrid.originY - (row + 0.5) * displayGrid.cellSize];
      const [ux, uy] = input.projection.forward(epsg2180ToWgs84(p2180));
      const c = Math.floor((ux - window.originX) / window.pixel) - window.x0;
      const r = Math.floor((window.originY - uy) / window.pixel) - window.y0;
      if (c < 0 || r < 0 || c >= window.w || r >= window.h) {
        values.push(null);
        deviationMask.push(0);
        continue;
      }
      const i = r * window.w + c;
      const v = ndmi[i] as number;
      values.push(Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
      deviationMask.push(deviatingPixel[i] && pointInPolygon(p2180, input.parcel.ring2180) ? 1 : 0);
    }
  }

  const deviatingPct = parcelValues.length > 0 ? Math.round((1000 * deviating) / parcelValues.length) / 10 : 0;
  return {
    version: NDMI_VERSION,
    parcelId: input.parcel.id,
    analysisDate: input.analysisDate,
    origin: input.origin,
    scene: input.chosen,
    checkedScenes: input.checked,
    resolutionM: 20,
    minCoveragePct: MIN_COVERAGE_PCT,
    values,
    deviationMask,
    stats: parcelValues.length
      ? {
          median: Math.round(median * 1000) / 1000,
          p10: Math.round(q(0.1) * 1000) / 1000,
          p90: Math.round(q(0.9) * 1000) / 1000,
          validPixels: parcelValues.length,
          parcelPixels: parcelPixels.length,
          deviatingPixelsPct: deviatingPct,
        }
      : null,
    message:
      `Scena z ${input.chosen.date}: ${Math.round(input.chosen.usefulCoveragePct)}% działki z ważną obserwacją. ` +
      (deviating > 0
        ? `${deviatingPct}% pikseli wyraźnie odbiega od reszty działki – to miejsca do sprawdzenia w terenie.`
        : 'Brak wyraźnych odchyleń NDMI w obrębie działki.'),
    sources: input.sources,
    timings: input.timings,
    limitations: ndmiLimitations(),
  };
}

export function ndmiLimitations(): string[] {
  return [
    'NDMI opisuje wilgotność roślin i powierzchni, a nie bezpośrednio wilgotność gleby – to sygnał pomocniczy.',
    'Odchylenia NDMI wskazują miejsca do sprawdzenia w terenie; przyczynę (susza, zalewanie, choroba, gleba, zabiegi) można ocenić dopiero na podstawie dodatkowych danych.',
    'Rozdzielczość 20 m – małe działki obejmują niewiele pikseli, a piksele na granicy mieszają sygnał z sąsiednich pól.',
    `Maska SCL odrzuca chmury, cienie, cirrus, śnieg i braki danych, ale cienkie chmury mogą zostać niewykryte.`,
  ];
}
