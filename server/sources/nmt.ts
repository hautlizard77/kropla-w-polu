/**
 * Numeryczny Model Terenu z Geoportalu (GUGiK) – usługa WCS zwracająca GeoTIFF.
 * Pobieramy wycinek w natywnej rozdzielczości usługi (GRID1 – siatka 1 m), w układzie EPSG:2180.
 */
import type { GridSpec, SourceInfo } from '../../src/types/terrain';
import type { Bounds } from '../geo/geometry';
import { BufferSource, Tiff } from '../geo/tiff';
import { errorText } from './uldk';

export const NMT_WCS_URL =
  'https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WCS/DigitalTerrainModelFormatTIFF';
export const NMT_COVERAGE_ID = 'DTM_PL-KRON86-NH_TIFF';
const TIMEOUT_MS = Number(process.env.KROPLA_NMT_TIMEOUT_MS ?? 120000);

export interface DemRaster {
  values: Float64Array;
  grid: GridSpec;
  source: SourceInfo;
}

export class NmtError extends Error {}

export async function fetchNmt(bounds: Bounds): Promise<DemRaster> {
  const started = Date.now();
  const b = {
    minX: Math.floor(bounds.minX),
    minY: Math.floor(bounds.minY),
    maxX: Math.ceil(bounds.maxX),
    maxY: Math.ceil(bounds.maxY),
  };
  const attempts: { label: string; url: string }[] = [
    // WCS 2.0.1: osie w kolejności EPSG:2180 (x = północ, y = wschód) albo odwrotnie – sprawdzamy obie.
    { label: 'WCS 2.0.1 (x=N, y=E)', url: wcs20(b, 'x', 'y', true) },
    { label: 'WCS 2.0.1 (x=E, y=N)', url: wcs20(b, 'x', 'y', false) },
    { label: 'WCS 1.0.0', url: wcs10(b) },
  ];
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const contentType = response.headers.get('content-type') ?? '';
      const data = new Uint8Array(await response.arrayBuffer());
      if (!response.ok || !looksLikeTiff(data)) {
        errors.push(`${attempt.label}: ${response.status} ${contentType} ${preview(data)}`);
        continue;
      }
      const raster = await decode(data, b);
      if (!raster) {
        errors.push(`${attempt.label}: zwrócony raster nie obejmuje działki`);
        continue;
      }
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
            `Zapytanie: ${attempt.label}.`,
            'Data pomiaru lotniczego (LiDAR) różni się między obszarami; usługa jej nie zwraca.',
          ],
        },
      };
    } catch (error) {
      errors.push(`${attempt.label}: ${errorText(error)}`);
    }
  }
  throw new NmtError(`Nie udało się pobrać NMT z Geoportalu. ${errors.join(' | ')}`);
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
