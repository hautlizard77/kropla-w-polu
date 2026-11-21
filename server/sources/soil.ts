/**
 * Właściwości gleby z SoilGrids 2.0 (ISRIC, siatka 250 m, licencja CC BY 4.0) przez usługę WCS (GeoTIFF).
 * Interfejs REST SoilGrids jest w wersji beta i bywa wstrzymany, dlatego czytamy mapy bezpośrednio.
 *
 * Z zawartości piasku, iłu i węgla organicznego liczymy wilgotność przy polowej pojemności wodnej (θFC, −33 kPa)
 * i w punkcie trwałego więdnięcia (θWP, −1500 kPa) wzorami Saxtona i Rawlsa (2006).
 */
import type { SourceInfo } from '../../src/types/terrain';
import type { SoilLayer } from '../analysis/waterBalance';
import { cacheGet, cacheSet, once } from '../cache';
import { BufferSource, Tiff } from '../geo/tiff';
import { errorText } from './uldk';

export const SOIL_DEPTHS: { label: string; topCm: number; bottomCm: number }[] = [
  { label: '0-5cm', topCm: 0, bottomCm: 5 },
  { label: '5-15cm', topCm: 5, bottomCm: 15 },
  { label: '15-30cm', topCm: 15, bottomCm: 30 },
  { label: '30-60cm', topCm: 30, bottomCm: 60 },
  { label: '60-100cm', topCm: 60, bottomCm: 100 },
  { label: '100-200cm', topCm: 100, bottomCm: 200 },
];

export interface SoilHorizon extends SoilLayer {
  sandPct: number | null;
  clayPct: number | null;
  /** Materia organiczna, % masy (węgiel organiczny × 1,724). */
  organicMatterPct: number | null;
}

export interface SoilProfile {
  horizons: SoilHorizon[];
  /** Opis tekstury wierzchniej warstwy (0–30 cm) prostym językiem. */
  topsoilTexture: string | null;
  /** Kategoria zdolności zatrzymywania wody wg tekstury. */
  category: 'lekka' | 'średnia' | 'ciężka' | null;
  source: SourceInfo;
  missing: string[];
}

const SOIL_VERSION = 1;
const WCS = 'https://maps.isric.org/mapserv';

export async function getSoil(lat: number, lon: number): Promise<SoilProfile> {
  const key = `v${SOIL_VERSION}:${Math.round(lat * 500) / 500}:${Math.round(lon * 500) / 500}`;
  const cached = await cacheGet<SoilProfile>('soil', key);
  if (cached) return { ...cached, source: { ...cached.source, durationMs: null } };
  return once(`soil:${key}`, async () => {
    const result = await fetchSoil(lat, lon);
    if (result.missing.length === 0) await cacheSet('soil', key, result);
    return result;
  });
}

/** Mediana z niezerowych pikseli okna wokół punktu (WCS zwraca 0 w lukach po przeliczeniu siatki). */
async function readProperty(property: 'sand' | 'clay' | 'soc', depth: string, lat: number, lon: number): Promise<number | null> {
  const d = 0.004;
  const url =
    `${WCS}?map=/map/${property}.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=${property}_${depth}_mean` +
    `&FORMAT=GEOTIFF_INT16&SUBSET=X(${lon - d},${lon + d})&SUBSET=Y(${lat - d},${lat + d})` +
    '&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326';
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (data[0] !== 0x49 && data[0] !== 0x4d) throw new Error('odpowiedź nie jest plikiem GeoTIFF');
  const tiff = await Tiff.open(new BufferSource(data));
  const values = Array.from(await tiff.readWindow(0, 0, tiff.main.width, tiff.main.height)).filter((v) => Number.isFinite(v) && v > 0 && v < 32000);
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? null;
}

async function fetchSoil(lat: number, lon: number): Promise<SoilProfile> {
  const started = Date.now();
  const missing: string[] = [];
  const horizons: SoilHorizon[] = [];
  // Najwyżej 6 zapytań naraz – usługa ma ograniczenia wydajności.
  const jobs = SOIL_DEPTHS.flatMap((depth) => (['sand', 'clay', 'soc'] as const).map((property) => ({ depth, property })));
  const results = new Map<string, number | null>();
  for (let i = 0; i < jobs.length; i += 6) {
    await Promise.all(
      jobs.slice(i, i + 6).map(async ({ depth, property }) => {
        try {
          results.set(`${property}:${depth.label}`, await readProperty(property, depth.label, lat, lon));
        } catch (error) {
          results.set(`${property}:${depth.label}`, null);
          if (!missing.some((m) => m.startsWith('SoilGrids'))) missing.push(`SoilGrids: ${errorText(error)}`);
        }
      }),
    );
  }
  for (const depth of SOIL_DEPTHS) {
    // Jednostki SoilGrids: piasek i ił w g/kg, węgiel organiczny w dg/kg.
    const sandRaw = results.get(`sand:${depth.label}`) ?? null;
    const clayRaw = results.get(`clay:${depth.label}`) ?? null;
    const socRaw = results.get(`soc:${depth.label}`) ?? null;
    const sandPct = sandRaw === null ? null : sandRaw / 10;
    const clayPct = clayRaw === null ? null : clayRaw / 10;
    const organicMatterPct = socRaw === null ? null : (socRaw / 100) * 1.724;
    const theta = sandPct !== null && clayPct !== null ? saxtonRawls(sandPct, clayPct, organicMatterPct ?? 1) : null;
    horizons.push({
      topCm: depth.topCm,
      bottomCm: depth.bottomCm,
      sandPct,
      clayPct,
      organicMatterPct: organicMatterPct === null ? null : Math.round(organicMatterPct * 100) / 100,
      thetaFc: theta?.thetaFc ?? null,
      thetaWp: theta?.thetaWp ?? null,
    });
    if (sandPct === null || clayPct === null) missing.push(`Brak tekstury gleby dla warstwy ${depth.label}.`);
  }
  const top = horizons.filter((h) => h.bottomCm <= 30 && h.sandPct !== null && h.clayPct !== null);
  const sand = top.length ? top.reduce((s, h) => s + (h.sandPct as number), 0) / top.length : null;
  const clay = top.length ? top.reduce((s, h) => s + (h.clayPct as number), 0) / top.length : null;
  return {
    horizons,
    topsoilTexture: sand !== null && clay !== null ? textureName(sand, clay) : null,
    category: sand !== null && clay !== null ? category(sand, clay) : null,
    missing,
    source: {
      name: 'Tekstura i węgiel organiczny gleby (SoilGrids 2.0), retencja wzorami Saxtona i Rawlsa (2006)',
      provider: 'ISRIC – World Soil Information, SoilGrids 250 m (WCS)',
      url: 'https://soilgrids.org',
      origin: 'observed',
      retrievedAt: new Date().toISOString(),
      observationDate: null,
      resolutionM: 250,
      durationMs: Date.now() - started,
      notes: [
        'SoilGrids to mapa modelowana w skali globalnej (250 m) – na konkretnej działce gleba może się różnić; ISRIC nie zaleca jej do decyzji na poziomie pojedynczego gospodarstwa bez sprawdzenia w terenie.',
        'Licencja CC BY 4.0.',
      ],
    },
  };
}

/** Saxton i Rawls (2006): θ przy −1500 kPa i −33 kPa z piasku i iłu (%) oraz materii organicznej (%). */
export function saxtonRawls(sandPct: number, clayPct: number, organicMatterPct: number): { thetaFc: number; thetaWp: number } {
  const S = sandPct / 100;
  const C = clayPct / 100;
  const OM = Math.min(8, Math.max(0, organicMatterPct));
  const t1500 = -0.024 * S + 0.487 * C + 0.006 * OM + 0.005 * S * OM - 0.013 * C * OM + 0.068 * S * C + 0.031;
  const thetaWp = t1500 + (0.14 * t1500 - 0.02);
  const t33 = -0.251 * S + 0.195 * C + 0.011 * OM + 0.006 * S * OM - 0.027 * C * OM + 0.452 * S * C + 0.299;
  const thetaFc = t33 + (1.283 * t33 * t33 - 0.374 * t33 - 0.015);
  return { thetaFc: Math.round(thetaFc * 1000) / 1000, thetaWp: Math.round(Math.max(0.01, thetaWp) * 1000) / 1000 };
}

/** Uproszczona nazwa tekstury (klasy USDA) po polsku. */
export function textureName(sand: number, clay: number): string {
  const silt = 100 - sand - clay;
  if (clay >= 40) return 'glina ciężka / ił';
  if (sand >= 85 && clay < 10) return 'piasek';
  if (sand >= 70 && clay < 15) return 'piasek gliniasty';
  if (clay < 20 && sand >= 52) return 'glina piaszczysta';
  if (silt >= 50 && clay < 27) return 'pył (gleba pyłowa, np. less)';
  if (clay >= 27) return 'glina ilasta';
  return 'glina';
}

export function category(sand: number, clay: number): 'lekka' | 'średnia' | 'ciężka' {
  if (clay < 10 && sand > 65) return 'lekka';
  if (clay >= 30) return 'ciężka';
  return 'średnia';
}
