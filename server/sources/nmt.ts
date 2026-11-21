/**
 * Numeryczny Model Terenu z Geoportalu (GUGiK) – usługa WCS zwracająca GeoTIFF.
 * Pobieramy wycinek w natywnej rozdzielczości usługi (GRID1 – siatka 1 m), w układzie EPSG:2180.
 */
import type { GridSpec, SourceInfo } from '../../src/types/terrain';
import type { Bounds } from '../geo/geometry';
import { BufferSource, Tiff } from '../geo/tiff';
import { errorText } from './uldk';
import { cacheGet, cacheSet } from '../cache';
import { fetchNmtPoints } from './nmtPoints';

export const NMT_WCS_URL =
  'https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WCS/DigitalTerrainModelFormatTIFF';
export const NMT_COVERAGE_ID = 'DTM_PL-KRON86-NH_TIFF';
const TIMEOUT_MS = Number(process.env.KROPLA_NMT_TIMEOUT_MS ?? 90000);
const TOTAL_BUDGET_MS = 60_000;

export interface DemRaster {
  values: Float64Array;
  grid: GridSpec;
  source: SourceInfo;
}

export class NmtError extends Error {}

interface Variant {
  id: string;
  label: string;
  url: (b: Bounds) => string;
}

// DescribeCoverage tej usługi: oś „x” = wschód, „y” = północ (sprawdzone na żywo w listopadzie 2026).
// Odpowiedź WCS trwa zwykle 1–2 minuty niezależnie od wielkości wycinka, dlatego to tylko źródło zapasowe
// (podstawowe: usługa wysokości punktów, `nmtPoints.ts`). Zapytania wysyłamy po kolei, żeby nie dociążać usługi.
const VARIANTS: Variant[] = [
  { id: 'wcs20-en', label: 'WCS 2.0.1 (x=E, y=N)', url: (b) => wcs20(b, 'x', 'y', false) },
  { id: 'wcs10', label: 'WCS 1.0.0', url: (b) => wcs10(b) },
  { id: 'wcs20-ne', label: 'WCS 2.0.1 (x=N, y=E)', url: (b) => wcs20(b, 'x', 'y', true) },
];

let preferredVariant: string | null | undefined;

async function orderedVariants(): Promise<Variant[]> {
  if (preferredVariant === undefined) {
    const stored = await cacheGet<{ id: string }>('nmt-meta', 'variant');
    preferredVariant = stored?.id ?? null;
  }
  const known = VARIANTS.find((v) => v.id === preferredVariant);
  return known ? [known, ...VARIANTS.filter((v) => v !== known)] : VARIANTS;
}

type Raster = { values: Float64Array; grid: GridSpec };

/** Model terenu: najpierw szybka usługa wysokości punktów, przy jej awarii – WCS. */
export async function fetchDem(bounds: Bounds): Promise<DemRaster> {
  try {
    return await fetchNmtPoints(bounds);
  } catch (pointsError) {
    try {
      const dem = await fetchNmt(bounds);
      dem.source.notes.unshift(`Usługa wysokości punktów nie odpowiedziała (${errorText(pointsError)}) – użyto WCS.`);
      return dem;
    } catch (wcsError) {
      throw new NmtError(`${errorText(pointsError)} | ${errorText(wcsError)}`);
    }
  }
}

export async function fetchNmt(bounds: Bounds): Promise<DemRaster> {
  const started = Date.now();
  const b = {
    minX: Math.floor(bounds.minX),
    minY: Math.floor(bounds.minY),
    maxX: Math.ceil(bounds.maxX),
    maxY: Math.ceil(bounds.maxY),
  };
  const errors: string[] = [];
  // Łączny limit czasu na wszystkie warianty – rolnik nie może czekać minutami.
  const deadline = started + TOTAL_BUDGET_MS;
  for (const variant of await orderedVariants()) {
    const remaining = deadline - Date.now();
    if (remaining < 5000) {
      errors.push(`${variant.label}: pominięty – wyczerpany limit czasu`);
      continue;
    }
    try {
      const raster = await fetchOne(variant, b, AbortSignal.timeout(Math.min(TIMEOUT_MS, remaining)));
      if (preferredVariant !== variant.id) {
        preferredVariant = variant.id;
        await cacheSet('nmt-meta', 'variant', { id: variant.id });
      }
      return result(raster, variant, started);
    } catch (error) {
      errors.push(`${variant.label}: ${errorText(error)}`);
    }
  }
  throw new NmtError(`Nie udało się pobrać NMT z Geoportalu (WCS). ${errors.join(' | ')}`);
}

async function fetchOne(variant: Variant, b: Bounds, signal: AbortSignal): Promise<Raster> {
  const response = await fetch(variant.url(b), { signal });
  const contentType = response.headers.get('content-type') ?? '';
  const data = new Uint8Array(await response.arrayBuffer());
  if (!response.ok || !looksLikeTiff(data)) throw new NmtError(`${response.status} ${contentType} ${preview(data)}`);
  const raster = await decode(data, b);
  if (!raster) throw new NmtError('zwrócony raster nie obejmuje działki');
  return raster;
}

function result(raster: Raster, variant: Variant, started: number): DemRaster {
  return {
    ...raster,
    source: {
      name: 'Numeryczny Model Terenu (NMT), wysokości normalne Kronsztadt86',
      provider: 'GUGiK – Geoportal, usługa WCS (PZGIK NMT GRID1)',
      url: NMT_WCS_URL,
      origin: 'observed',
      retrievedAt: new Date().toISOString(),
      observationDate: null,
      resolutionM: raster.grid.cellSize,
      durationMs: Date.now() - started,
      notes: [
        `Wycinek ${raster.grid.width} × ${raster.grid.height} komórek w natywnej rozdzielczości usługi.`,
        `Zapytanie: ${variant.label}.`,
        'Data pomiaru lotniczego (LiDAR) różni się między obszarami; usługa jej nie zwraca.',
      ],
    },
  };
}

function wcs20(b: Bounds, axisA: string, axisB: string, aIsNorthing: boolean): string {
  const a = aIsNorthing ? `${axisA}(${b.minY},${b.maxY})` : `${axisA}(${b.minX},${b.maxX})`;
  const c = aIsNorthing ? `${axisB}(${b.minX},${b.maxX})` : `${axisB}(${b.minY},${b.maxY})`;
  return (
    `${NMT_WCS_URL}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=${NMT_COVERAGE_ID}` +
    `&FORMAT=image/tiff&SUBSET=${a}&SUBSET=${c}`
  );
}

function wcs10(b: Bounds): string {
  const width = Math.max(1, Math.round(b.maxX - b.minX));
  const height = Math.max(1, Math.round(b.maxY - b.minY));
  return (
    `${NMT_WCS_URL}?SERVICE=WCS&VERSION=1.0.0&REQUEST=GetCoverage&COVERAGE=${NMT_COVERAGE_ID}` +
    `&CRS=EPSG:2180&RESPONSE_CRS=EPSG:2180&BBOX=${b.minX},${b.minY},${b.maxX},${b.maxY}` +
    `&WIDTH=${width}&HEIGHT=${height}&FORMAT=image/tiff`
  );
}

function looksLikeTiff(data: Uint8Array): boolean {
  return data.length > 8 && ((data[0] === 0x49 && data[1] === 0x49) || (data[0] === 0x4d && data[1] === 0x4d));
}

function preview(data: Uint8Array): string {
  return new TextDecoder().decode(data.subarray(0, 160)).replace(/\s+/g, ' ');
}

/** Dekoduje GeoTIFF i sprawdza, czy obejmuje żądany obszar (wykrywa zamienione osie). */
async function decode(data: Uint8Array, wanted: Bounds): Promise<{ values: Float64Array; grid: GridSpec } | null> {
  const tiff = await Tiff.open(new BufferSource(data));
  const image = tiff.main;
  const geo = image.geo;
  if (!geo) throw new Error('GeoTIFF z NMT nie ma georeferencji');
  const maxX = geo.originX + image.width * geo.pixelWidth;
  const minY = geo.originY - image.height * geo.pixelHeight;
  const centerX = (wanted.minX + wanted.maxX) / 2;
  const centerY = (wanted.minY + wanted.maxY) / 2;
  if (centerX < geo.originX || centerX > maxX || centerY < minY || centerY > geo.originY) return null;
  const values = await tiff.readWindow(0, 0, image.width, image.height);
  // Usługa oznacza brak danych dużymi ujemnymi wartościami – traktujemy je jako brak.
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (!Number.isFinite(v) || v < -1000 || v > 3000) values[i] = Number.NaN;
  }
  return {
    values,
    grid: {
      width: image.width,
      height: image.height,
      cellSize: geo.pixelWidth,
      originX: geo.originX,
      originY: geo.originY,
    },
  };
}
