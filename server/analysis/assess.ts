/**
 * Ocena sytuacji wodnej działki z rzeczywistych danych: pogoda (opad, ET0), gleba (θFC, θWP), uprawa (Kc, korzenie),
 * cieki w pobliżu. Najpierw ocena, potem zalecenia wynikające z ocenionych warunków.
 *
 * Bilans: FAO-56 (rozdz. 8) – dzienny ubytek wody w strefie korzeni Dr, start 1 marca przy pełnym zapasie
 * (po zimie gleba jest zwykle nasycona – założenie modelu). Używamy tylko danych z dnia analizy i wcześniejszych.
 */
import { cropLabel } from '../../src/data/crops';
import type {
  AnalysisRequest,
  AnalysisResult,
  DataSource,
  Indicator,
  LandCover,
  LandUseNotice,
  Recommendation,
  RiskLevel,
  SatelliteSummary,
} from '../../src/types/analysis';
import type { NdmiResult, ParcelInfo, SourceInfo, TerrainResult, Xy } from '../../src/types/terrain';
import { epsg2180ToWgs84 } from '../geo/proj';
import { distanceText, type HydroResult } from '../sources/hydro';
import type { SoilProfile } from '../sources/soil';
import { addDays, type ForecastSeries, type WeatherSeries } from '../sources/weather';
import { FORECAST_MAX_AGE_DAYS, FORECAST_SOURCE_ID, buildForecast, notApplicableForecast, unavailableForecast } from './forecast';
import { CROP_PARAMS, STAGE_LABELS, cropDay, type Stage } from '../../src/data/cropParams';
import { readilyAvailableWater, totalAvailableWater } from './waterBalance';
import { DEFAULT_SLOPE_DEG, curveNumber, fmt, readNdmi, runoffMm, slopeContrast } from './observations';

export const ASSESS_VERSION = 5;
const STRESS_DAYS_FOR_DEFICIT_SEASON = 15;
const MAX_DATA_LAG_DAYS = 7;

export interface AssessInput {
  request: AnalysisRequest;
  parcel: ParcelInfo;
  weather: WeatherSeries | null;
  soil: SoilProfile | null;
  hydro: HydroResult | null;
  now?: Date;
  /** Prognoza Open-Meteo (tylko dla analizy na dziś lub ostatnie dni). */
  forecast?: ForecastSeries | null;
  forecastError?: string | null;
  /** Dzisiejsza data w Polsce – decyduje, czy prognoza ma sens. */
  todayDate?: string;
  /** Analiza NMT działki (nachylenie, zagłębienia, miejsca koncentracji spływu). */
  terrain?: TerrainResult | null;
  terrainError?: string | null;
  /** NDMI z Sentinel-2 na dzień analizy (najnowsze bezchmurne zdjęcie). */
  ndmi?: NdmiResult | null;
  ndmiError?: string | null;
  /** Pokrycie terenu działki (ESA WorldCover 2021). */
  landCover?: LandCover | null;
}

export interface SimDay {
  date: string;
  dr: number;
  etc: number;
  /** Spływ powierzchniowy z opadu tego dnia (mm). */
  ro: number;
  taw: number;
  raw: number;
  kc: number;
  stage: Stage;
  inSeason: boolean;
}

/** Ostatni 1 marca nie później niż data. */
export function seasonStart(date: string): string {
  const year = Number(date.slice(0, 4));
  return date.slice(5) >= '03-01' ? `${year}-03-01` : `${year - 1}-03-01`;
}

export function classify(dr: number, taw: number, raw: number): Exclude<RiskLevel, 'insufficient_data'> {
  if (dr <= raw) return 'low';
  if (dr <= raw + 0.5 * (taw - raw)) return 'moderate';
  return 'elevated';
}

/** Dzienny bilans z rosnącą strefą korzeni; zatrzymuje się na pierwszym dniu bez danych. */
export function simulate(
  weather: WeatherSeries,
  input: { cropId: AnalysisRequest['cropId']; horizons: SoilProfile['horizons']; tawScale: number; from: string; to: string; initialDr?: number; curveNumber?: number },
): SimDay[] {
  const p = CROP_PARAMS[input.cropId].p;
  const tawCache = new Map<number, number | null>();
  const tawFor = (zr: number): number | null => {
    const key = Math.round(zr * 20) / 20;
    if (!tawCache.has(key)) tawCache.set(key, totalAvailableWater(input.horizons, key).tawMm);
    const taw = tawCache.get(key) ?? null;
    return taw === null ? null : taw * input.tawScale;
  };
  const out: SimDay[] = [];
  let dr = input.initialDr ?? 0;
  for (const day of weather.days) {
    if (day.date < input.from) continue;
    if (day.date > input.to) break;
    if (day.precipitationMm === null || day.et0Mm === null) break;
    const crop = cropDay(input.cropId, day.date);
    const taw = tawFor(crop.zr);
    if (taw === null) break;
    const raw = readilyAvailableWater(taw, p);
    // Przy suchej glebie parowanie maleje (współczynnik Ks, FAO-56 równ. 84).
    const ks = dr <= raw ? 1 : Math.max(0, (taw - dr) / Math.max(1e-6, taw - raw));
    const etc = crop.kc * ks * day.et0Mm;
    // FAO-56: do gleby wsiąka opad pomniejszony o spływ powierzchniowy (SCS-CN z nachyleniem z NMT).
    const ro = input.curveNumber ? runoffMm(day.precipitationMm, input.curveNumber) : 0;
    dr = Math.min(taw, Math.max(0, dr - (day.precipitationMm - ro) + etc));
    out.push({ date: day.date, dr: Math.round(dr * 10) / 10, etc: Math.round(etc * 10) / 10, ro: Math.round(ro * 10) / 10, taw: Math.round(taw * 10) / 10, raw: Math.round(raw * 10) / 10, kc: crop.kc, stage: crop.stage, inSeason: crop.inSeason });
  }
  return out;
}

function sumWindow(weather: WeatherSeries, end: string, days: number, f: (p: number, e: number) => number): number | null {
  const start = addDays(end, -(days - 1));
  let sum = 0;
  let count = 0;
  for (const d of weather.days) {
    if (d.date < start || d.date > end) continue;
    if (d.precipitationMm === null || d.et0Mm === null) return null;
    sum += f(d.precipitationMm, d.et0Mm);
    count += 1;
  }
  return count === days ? Math.round(sum) : null;
}

/** Średnia z tego samego okna w poprzednich latach (pomijając rok bieżący). */
function normalWindow(weather: WeatherSeries, end: string, days: number, years: number, f: (p: number, e: number) => number): number | null {
  const values: number[] = [];
  for (let k = 1; k <= years; k += 1) {
    const e = `${Number(end.slice(0, 4)) - k}${end.slice(4)}`;
    const v = sumWindow(weather, e.endsWith('02-29') ? e.replace('02-29', '02-28') : e, days, f);
    if (v !== null) values.push(v);
  }
  return values.length >= Math.ceil(years / 2) ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

/** Ostrzeżenie, gdy pokrycie terenu nie pasuje do pola z wybraną uprawą. */
export function landUseNoticeFor(lc: LandCover, cropId: AnalysisRequest['cropId']): LandUseNotice | null {
  const crop = cropLabel(cropId).toLocaleLowerCase('pl-PL');
  const pctText = (v: number) => `${v.toLocaleString('pl-PL', { maximumFractionDigits: 0 })}%`;
  const others = lc.classes
    .filter((c) => c.code !== 40 && c.code !== 30)
    .slice(0, 2)
    .map((c) => `${c.label} ${pctText(c.pct)}`)
    .join(', ');
  if (lc.verdict === 'non_agricultural') {
    return {
      severity: 'warning',
      title: 'Działka nie wygląda na grunt rolny',
      text: `Według mapy pokrycia terenu ESA WorldCover (2021) działkę pokrywa głównie ${lc.dominant ? `${lc.dominant.label} (${pctText(lc.dominant.pct)})` : 'teren nierolniczy'}, a grunty rolne to ${pctText(lc.agriculturalPct)}. Ocena zakłada pole z uprawą (${crop}) – jeśli jej tu nie ma, wynik nie ma zastosowania. Mapa jest z 2021 r.: sprawdź, czy użytkowanie się nie zmieniło.`,
    };
  }
  const meadowCrop = cropId === 'uzytki_zielone';
  if (lc.verdict === 'grassland' && !meadowCrop) {
    return {
      severity: 'info',
      title: 'Na mapie to łąka lub pastwisko',
      text: `Roślinność trawiasta zajmuje ${pctText(lc.grasslandPct)} działki (ESA WorldCover 2021), a wybrano uprawę: ${crop}. Jeśli działka jest dziś łąką, wybierz „użytki zielone” – inne jest zapotrzebowanie na wodę i głębokość korzeni.`,
    };
  }
  if (lc.verdict === 'arable' && meadowCrop) {
    return {
      severity: 'info',
      title: 'Na mapie to grunt orny',
      text: `Uprawy zajmują ${pctText(lc.croplandPct)} działki (ESA WorldCover 2021), a wybrano użytki zielone. Jeśli rośnie tu inna uprawa, zmień ją – wynik zależy od uprawy.`,
    };
  }
  if (lc.verdict === 'mixed') {
    return {
      severity: 'info',
      title: 'Działka tylko częściowo rolna',
      text: `Grunty rolne zajmują ${pctText(lc.agriculturalPct)} działki${others ? `, reszta to m.in.: ${others}` : ''} (ESA WorldCover 2021). Bilans liczymy dla części z uprawą; zdjęcie satelitarne i spływ dotyczą całej działki.`,
    };
  }
  return null;
}

function riskWord(level: RiskLevel): string {
  return level === 'low' ? 'niskie' : level === 'moderate' ? 'umiarkowane' : level === 'elevated' ? 'podwyższone' : 'nieokreślone';
}

function sumRain(weather: WeatherSeries, from: string, to: string): number {
  let sum = 0;
  for (const d of weather.days) if (d.date >= from && d.date <= to && d.precipitationMm !== null) sum += d.precipitationMm;
  return sum;
}

function toDataSource(id: string, kind: DataSource['kind'], s: SourceInfo, extra: Partial<DataSource> = {}): DataSource {
  return {
    id,
    kind,
    name: s.name,
    provider: s.provider,
    url: s.url,
    license: null,
    availability: 'available',
    observationDate: s.observationDate,
    retrievedAt: s.retrievedAt ? s.retrievedAt.slice(0, 10) : null,
    coverage: null,
    limitations: s.notes,
    details: null,
    ...extra,
    ...(s.durationMs !== null
      ? { details: `${extra.details ? `${extra.details} ` : ''}Czas pobrania: ${(s.durationMs / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} s.` }
      : {}),
  };
}

const mm = (v: number) => `${Math.round(v)} mm`;
const pl = (v: number) => v.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
const formatDate = (iso: string) => {
  const months = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  return `${Number(iso.slice(8, 10))} ${months[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
};

export function buildAssessment(input: AssessInput): AnalysisResult {
  const { request, parcel, weather, soil, hydro } = input;
  const now = input.now ?? new Date();
  const crop = CROP_PARAMS[request.cropId];
  const cropName = cropLabel(request.cropId).toLowerCase();
  const dataSources: DataSource[] = [];
  const limitations: string[] = [
    'Ocena modelowa (bilans wody FAO-56) – nie zastępuje pomiaru wilgotności gleby ani oględzin pola.',
    'Bilans startuje 1 marca przy pełnym zapasie wody w glebie (założenie: zima uzupełnia zapas).',
    'Terminy faz rozwoju uprawy są typowe dla Polski – w danym roku mogą się różnić o 1–3 tygodnie.',
  ];

  // Źródła.
  dataSources.push(
    toDataSource('uldk', 'granice', parcel.source, {
      license: 'Dane publiczne GUGiK',
      details: `Powierzchnia z geometrii: ${pl(parcel.areaHa)} ha.`,
    }),
  );
  // Użytkowanie terenu – czy działka wygląda na pole tej uprawy.
  const landCover = input.landCover ?? null;
  if (landCover?.status === 'ok') {
    dataSources.push(toDataSource('uzytkowanie', 'uzytkowanie', landCover.source, { license: 'CC BY 4.0 (© ESA WorldCover 2021)', details: landCover.message }));
  } else {
    dataSources.push(missingSource('uzytkowanie', 'uzytkowanie', 'Pokrycie terenu ESA WorldCover 10 m (2021)', landCover?.message ?? 'Mapa pokrycia terenu nie została pobrana.'));
  }
  const landUseNotice = landCover?.status === 'ok' ? landUseNoticeFor(landCover, request.cropId) : null;
  if (landUseNotice?.severity === 'warning') {
    limitations.push('Działka według mapy pokrycia terenu nie jest gruntem rolnym – bilans, NDMI i zalecenia zakładają pole z wybraną uprawą.');
  }
  limitations.push('Użytkowanie terenu z mapy ESA WorldCover z 2021 r. (trafność ok. 77%) – późniejsze zmiany i dokładna uprawa nie są widoczne.');
  const weatherOk = weather !== null && weather.lastCompleteDate !== null;
  if (weather && weather.sources.length > 0) {
    weather.sources.forEach((s, i) =>
      dataSources.push(
        toDataSource(`pogoda${i}`, 'pogoda', s, {
          observationDate: weather.lastCompleteDate,
          coverage: weather.days[0] && weather.lastCompleteDate ? { from: weather.days[0].date, to: weather.lastCompleteDate } : null,
          license: s.provider.includes('NASA') ? 'NASA – dane otwarte' : 'CC BY 4.0',
        }),
      ),
    );
  } else {
    dataSources.push(missingSource('pogoda', 'pogoda', 'Opad i ewapotranspiracja', weather?.notes.join(' ') ?? 'Usługi pogodowe niedostępne.'));
  }
  const tawProbe = soil ? totalAvailableWater(soil.horizons, crop.zrMax).tawMm : null;
  if (soil && tawProbe !== null) {
    dataSources.push(toDataSource('gleba', 'gleba', soil.source, { license: 'CC BY 4.0', details: soil.topsoilTexture ? `Wierzchnia warstwa: ${soil.topsoilTexture}.` : null }));
  } else {
    dataSources.push(missingSource('gleba', 'gleba', 'Tekstura i retencja gleby', soil?.missing.join(' ') || 'Usługa SoilGrids niedostępna.'));
  }
  if (hydro?.status === 'ok') {
    dataSources.push(toDataSource('hydro', 'hydrologia', hydro.source, { license: hydro.license || 'ODbL', details: hydro.message }));
  } else {
    dataSources.push(missingSource('hydro', 'hydrologia', 'Cieki i rowy w pobliżu', hydro?.message ?? 'Brak danych.'));
  }
  const terrain = input.terrain ?? null;
  const slopeDeg = terrain ? terrain.erosion.parcelSlopeMeanDeg : DEFAULT_SLOPE_DEG;
  if (terrain) {
    const demSource = terrain.sources[1] ?? terrain.sources[0];
    if (demSource) {
      dataSources.push(
        toDataSource('nmt', 'teren', demSource, {
          license: 'Dane publiczne GUGiK',
          details: `Średnie nachylenie działki ${pl(slopeDeg)}°, zagłębień: ${terrain.depressions.filter((d) => d.insideParcel).length}. Użyte w bilansie (spływ powierzchniowy) i w zaleceniach.`,
        }),
      );
    }
  } else {
    dataSources.push(missingSource('nmt', 'teren', 'Numeryczny Model Terenu', input.terrainError ?? 'Model terenu nie został pobrany na czas.'));
    limitations.push(`Model terenu niedostępny – w obliczeniu spływu przyjęto typowe nachylenie ${DEFAULT_SLOPE_DEG}°.`);
  }
  const ndmi = input.ndmi ?? null;
  const ndmiSource = ndmi?.sources[0];
  if (ndmi && ndmiSource) {
    dataSources.push(
      toDataSource('s2', 'satelita', ndmiSource, {
        license: 'Copernicus Sentinel – dane otwarte',
        observationDate: ndmi.scene?.date ?? null,
        details: ndmi.message,
      }),
    );
  } else {
    dataSources.push(missingSource('s2', 'satelita', 'Sentinel-2 L2A – NDMI', input.ndmiError ?? 'Zdjęcie satelitarne nie zostało pobrane na czas.'));
  }
  limitations.push(
    'Spływ powierzchniowy liczony metodą SCS-CN (USDA) z nachyleniem z NMT – bez drenażu, bruzd i zaskorupienia gleby.',
    'NDMI to wskaźnik pośredni (woda w liściach, nie w glebie); interpretujemy go tylko w fazach, gdy łan zakrywa glebę.',
  );

  const reading = readNdmi(ndmi, request.cropId, request.analysisDate, input.ndmiError ?? null);
  const satellite: SatelliteSummary = {
    status: reading.signal !== 'na' ? 'ok' : reading.median !== null ? 'no_comparison' : 'unavailable',
    reason: reading.reason,
    sceneDate: reading.sceneDate,
    coveragePct: reading.coveragePct,
    ndmiMedian: reading.median,
    cropName: cropLabel(request.cropId),
    stageLabel: STAGE_LABELS[reading.stage],
    expected: reading.okFrom !== null && reading.stressBelow !== null ? { okFrom: reading.okFrom, stressBelow: reading.stressBelow } : null,
    verdict: reading.signal === 'na' ? null : reading.signal,
    photoText: reading.text,
    balanceLevel: null,
    balanceText: null,
    comparison: null,
    comparisonText: null,
    fieldCheck: null,
    sourceId: 's2',
  };

  const base: Omit<AnalysisResult, 'currentState' | 'historicalVulnerability' | 'recommendations' | 'irrigation'> = {
    ...(landCover?.status === 'ok'
      ? { landCover: { classes: landCover.classes, verdict: landCover.verdict, agriculturalPct: landCover.agriculturalPct, notice: landUseNotice } }
      : {}),
    satellite,
    request,
    isDemo: false,
    scenarioId: null,
    generatedAt: now.toISOString(),
    parcel: {
      id: parcel.id,
      locationLabel: parcel.region ? `obręb ${parcel.region}` : 'obręb nieznany',
      commune: parcel.commune ?? 'nieznana',
      county: parcel.county ?? 'nieznany',
      voivodeship: parcel.voivodeship ?? 'nieznane',
      areaHa: Math.round(parcel.areaHa * 100) / 100,
      geometry: { type: 'Polygon', coordinates: [[...parcel.ringWgs84, parcel.ringWgs84[0] as [number, number]]] },
    },
    dataSources,
    limitations,
  };

  const todayDate = input.todayDate ?? now.toISOString().slice(0, 10);
  const forecastApplies = request.analysisDate >= addDays(todayDate, -FORECAST_MAX_AGE_DAYS);
  if (forecastApplies && input.forecast) {
    dataSources.push(
      toDataSource(FORECAST_SOURCE_ID, 'pogoda', input.forecast.source, {
        license: 'CC BY 4.0',
        observationDate: null,
        coverage: input.forecast.days.length > 0 ? { from: input.forecast.days[0]!.date, to: input.forecast.days[input.forecast.days.length - 1]!.date } : null,
        details: 'Prognoza dotyczy dni po dacie analizy – nie wpływa na ocenę na dzień analizy, tylko na zakładkę „Prognoza”.',
      }),
    );
  }
  const forecastFor = (state: SimDay | null, evalDay: string): AnalysisResult['forecast'] => {
    if (!forecastApplies) {
      return notApplicableForecast('Prognoza dotyczy najbliższych dni, więc pokazujemy ją dla analizy na dziś (albo na jeden z 3 ostatnich dni).');
    }
    if (!input.forecast) return unavailableForecast(input.forecastError ?? 'Usługa prognozy pogody nie odpowiedziała.');
    return buildForecast({
      request,
      forecast: input.forecast,
      evalDate: evalDay,
      state,
      horizons: soil?.horizons ?? null,
      areaHa: parcel.areaHa > 0 ? parcel.areaHa : null,
      ...(soil ? { curveNumber: curveNumber(request.cropId, soil.category, slopeDeg) } : {}),
    });
  };

  // Wskaźniki pogodowe (niezależne od gleby).
  const weatherIndicators: Indicator[] = [];
  const lastDate = weather?.lastCompleteDate ?? null;
  const evalDate = lastDate && lastDate < request.analysisDate ? lastDate : request.analysisDate;
  if (weather && weatherOk) {
    const p30 = sumWindow(weather, evalDate, 30, (p) => p);
    const p30n = normalWindow(weather, evalDate, 30, 10, (p) => p);
    const kbw = sumWindow(weather, evalDate, 60, (p, e) => p - e);
    const kbwn = normalWindow(weather, evalDate, 60, 10, (p, e) => p - e);
    weatherIndicators.push({
      id: 'opad30',
      label: 'Suma opadów (30 dni)',
      value: p30,
      unit: 'mm',
      reference: { label: 'średnia z 10 lat', value: p30n },
      observedOn: evalDate,
      interpretation:
        p30 === null || p30n === null
          ? 'Brak pełnych danych do porównania.'
          : p30 < 0.6 * p30n
            ? 'Wyraźnie mniej deszczu niż zwykle.'
            : p30 > 1.3 * p30n
              ? 'Więcej deszczu niż zwykle.'
              : 'Opady zbliżone do typowych.',
      sourceId: 'pogoda0',
      isIndirect: false,
    });
    weatherIndicators.push({
      id: 'kbw60',
      label: 'Klimatyczny bilans wodny (60 dni): opad − ET0',
      value: kbw,
      unit: 'mm',
      reference: { label: 'średnia z 10 lat', value: kbwn },
      observedOn: evalDate,
      interpretation:
        kbw === null || kbwn === null
          ? 'Brak pełnych danych do porównania.'
          : kbw < kbwn - 40
            ? 'Bilans wyraźnie gorszy niż zwykle – woda szybciej ubywa, niż przybywa.'
            : kbw > kbwn + 40
              ? 'Bilans lepszy niż zwykle.'
              : 'Bilans zbliżony do typowego.',
      sourceId: 'pogoda0',
      isIndirect: false,
    });
  }

  const lagDays = lastDate ? Math.round((Date.parse(request.analysisDate) - Date.parse(lastDate)) / 86400000) : Infinity;
  const canBalance = weather !== null && weatherOk && soil !== null && tawProbe !== null && lagDays <= MAX_DATA_LAG_DAYS;

  if (!canBalance || !weather || !soil) {
    const reasons: string[] = [];
    if (!weatherOk) reasons.push('brak danych pogodowych');
    else if (lagDays > MAX_DATA_LAG_DAYS) reasons.push(`dane pogodowe kończą się ${lastDate ? formatDate(lastDate) : ''}`);
    if (tawProbe === null) reasons.push('brak danych o glebie');
    return {
      ...base,
      currentState: {
        asOf: request.analysisDate,
        level: 'insufficient_data',
        headline: 'Za mało danych do oceny stresu wodnego',
        summary: `Nie da się policzyć bilansu wody w strefie korzeni: ${reasons.join(', ')}. Dostępne wskaźniki pokazujemy poniżej.`,
        indicators: weatherIndicators,
      },
      historicalVulnerability: {
        level: 'insufficient_data',
        headline: 'Za mało danych',
        summary: 'Ocena podatności wymaga 10 lat danych pogodowych i danych o glebie.',
        period: null,
        criticalMonths: [],
        indicators: [],
      },
      recommendations: [],
      irrigation: { status: 'not_calculated', note: 'Bez bilansu wody nie oceniamy zasadności nawadniania.' },
      forecast: forecastFor(null, lastDate && lastDate < request.analysisDate ? lastDate : request.analysisDate),
    };
  }

  // Bilans na dzień oceny – wariant podstawowy oraz ±25% zapasu wody w glebie (niepewność SoilGrids).
  const from = seasonStart(evalDate);
  const cn = curveNumber(request.cropId, soil.category, slopeDeg);
  const runs = [1, 0.75, 1.25].map((scale) => simulate(weather, { cropId: request.cropId, horizons: soil.horizons, tawScale: scale, from, to: evalDate, curveNumber: cn }));
  const [mainRun, lowRun, highRun] = runs as [SimDay[], SimDay[], SimDay[]];
  const today = mainRun[mainRun.length - 1];
  // Bilans zatrzymuje się na pierwszym dniu bez danych. Jeśli nie doszedł do dnia oceny, w serii jest luka –
  // stan „na dziś” byłby zgadywany, więc nie oceniamy go i nie dajemy zaleceń opartych na bieżącym bilansie.
  if (!today || today.date !== evalDate) {
    const lastReliable = today?.date ?? null;
    const gapDay = lastReliable ? addDays(lastReliable, 1) : from;
    limitations.push(`Luka w danych pogodowych od ${formatDate(gapDay)} – bilansu nie liczymy dalej niż do ostatniego dnia z kompletem danych.`);
    return {
      ...base,
      currentState: {
        asOf: request.analysisDate,
        level: 'insufficient_data',
        headline: 'Za mało danych do oceny stresu wodnego',
        summary: `W danych pogodowych brakuje dnia ${formatDate(gapDay)}, więc bilansu wody nie da się policzyć do ${formatDate(evalDate)}. ${
          lastReliable ? `Ostatni dzień z wiarygodnym bilansem: ${formatDate(lastReliable)}.` : 'Od początku sezonu (1 marca) nie ma wiarygodnego bilansu.'
        } Zalecenia oparte na bieżącym stanie wody w glebie są wstrzymane.`,
        indicators: weatherIndicators,
      },
      historicalVulnerability: insufficientHistory(),
      recommendations: [],
      irrigation: { status: 'not_calculated', note: 'Bez kompletnego bilansu wody nie oceniamy zasadności nawadniania.' },
      forecast: forecastFor(null, evalDate),
    };
  }
  const modelLevel = classify(today.dr, today.taw, today.raw);
  // Klasę ryzyka wyznacza wyłącznie bilans wody. NDMI jest osobnym sygnałem: potwierdza wynik albo wskazuje
  // rozbieżność do sprawdzenia w terenie – progi NDMI są orientacyjne i nie mogą przestawiać klasy.
  const level = modelLevel;
  const order = ['low', 'moderate', 'elevated'] as const;
  const satScore = reading.signal === 'ok' ? 0 : reading.signal === 'watch' ? 1 : reading.signal === 'stress' ? 2 : null;
  const satGap = today.inSeason && satScore !== null ? satScore - order.indexOf(modelLevel) : null;
  const lowLast = lowRun[lowRun.length - 1];
  const highLast = highRun[highRun.length - 1];
  const levels = new Set([level, lowLast ? classify(lowLast.dr, lowLast.taw, lowLast.raw) : level, highLast ? classify(highLast.dr, highLast.taw, highLast.raw) : level]);
  const uncertain = levels.size > 1;
  const reservePct = Math.round((100 * (today.taw - today.dr)) / Math.max(1, today.taw));

  const headline = !today.inSeason
    ? level === 'low'
      ? `Poza sezonem uprawy – zapas wody w glebie jest dobry`
      : `Poza sezonem uprawy – w glebie brakuje wody (${reservePct}% zapasu)`
    : level === 'elevated'
      ? 'Podwyższone ryzyko niedoboru wody'
      : level === 'moderate'
        ? 'Umiarkowane ryzyko niedoboru wody'
        : 'Niskie ryzyko niedoboru wody';
  const summaryParts = [
    ...(landUseNotice?.severity === 'warning' ? [`Uwaga: ${landUseNotice.title.toLowerCase()} – wynik dotyczy pola z uprawą (${cropName}), którego na mapie nie widać.`] : []),
    `W strefie korzeni (${pl(cropDay(request.cropId, evalDate).zr)} m) uprawa (${cropName}) ma ok. ${mm(today.taw - today.dr)} wody dostępnej dla roślin z ${mm(today.taw)} możliwych (${reservePct}%).`,
    today.dr > today.raw
      ? `Ubytek (${mm(today.dr)}) przekracza próg łatwo dostępnej wody (${mm(today.raw)}) – rośliny mogą ograniczać wzrost.`
      : `Ubytek (${mm(today.dr)}) nie przekracza progu łatwo dostępnej wody (${mm(today.raw)}).`,
  ];
  const reservePctText = `${reservePct}%`;
  satellite.balanceLevel = modelLevel;
  satellite.balanceText =
    modelLevel === 'low'
      ? `W glebie zostało ${reservePctText} zapasu wody dostępnej dla roślin – według bilansu rośliny nie powinny cierpieć z braku wody.`
      : modelLevel === 'moderate'
        ? `Zapas wody w glebie spadł do ${reservePctText} – według bilansu rośliny zaczynają ograniczać wzrost.`
        : `Zapas wody w glebie spadł do ${reservePctText} – według bilansu rośliny są w wyraźnym stresie wodnym.`;
  if (satGap !== null) {
    const diverge = Math.abs(satGap) >= 2;
    satellite.comparison = satGap === 0 ? 'agree' : diverge ? 'diverge' : 'partial';
    satellite.comparisonText =
      satGap === 0
        ? 'Zdjęcie potwierdza wynik bilansu wody.'
        : diverge
          ? `Zdjęcie z ${formatDate(reading.sceneDate ?? evalDate)} pokazuje co innego niż bilans wody. Sprawdź stan roślin na polu.`
          : 'Zdjęcie różni się od bilansu o jeden stopień – to mieści się w dokładności obu metod.';
    if (diverge) {
      satellite.fieldCheck =
        satGap < 0
          ? 'Sprawdź stan roślin na polu: weź garść gleby z głębokości 10–30 cm (czy klei się i trzyma kształt) i zobacz, czy liście nie zwijają się w południe. Jeśli gleba jest wilgotna, a rośliny jędrne – wody jest więcej, niż wynika z mapy gleb (np. głębsze korzenie, wody gruntowe); wtedy bilans zawyża ryzyko.'
          : 'Sprawdź stan roślin na polu: czy liście więdną lub żółkną, czy nie ma chorób, szkodników albo śladów gradu i czy uprawa nie zaczęła dojrzewać. Słabe NDMI przy dobrym bilansie może mieć inną przyczynę niż brak wody – albo gleba trzyma mniej wody, niż podaje mapa.';
    }
    summaryParts.push(
      diverge
        ? `Uwaga – rozbieżność: bilans wskazuje ${riskWord(modelLevel)} ryzyko, a zdjęcie satelitarne z ${formatDate(reading.sceneDate ?? evalDate)} – ${reading.signal === 'ok' ? 'dobrze uwodnione rośliny' : 'wyraźny niedobór wody w roślinach'} (NDMI ${fmt(reading.median ?? 0)}). Sprawdź stan roślin na polu.`
        : `Satelita (NDMI ${fmt(reading.median ?? 0)}, ${formatDate(reading.sceneDate ?? evalDate)}): ${satGap === 0 ? 'potwierdza wynik bilansu' : 'różni się o jeden stopień – w granicach dokładności'}.`,
    );
  } else if (reading.reason) {
    satellite.comparisonText = `Brak podstaw do porównania: ${reading.text}`;
  }
  const seasonRain = sumRain(weather, from, evalDate);
  const seasonRunoff = mainRun.reduce((sum, d) => sum + d.ro, 0);
  if (terrain) {
    summaryParts.push(
      seasonRunoff >= 1
        ? `Od 1 marca ok. ${mm(seasonRunoff)} z ${mm(seasonRain)} opadu spłynęło po powierzchni pola (średnie nachylenie ${pl(slopeDeg)}°) – ta woda nie zasiliła gleby.`
        : slopeDeg < 5
          ? `Pole jest ${slopeDeg < 2 ? 'prawie płaskie' : 'łagodnie nachylone'} (${pl(slopeDeg)}°) – opady od 1 marca wsiąkały, spływ po powierzchni był pomijalny.`
          : `Pole jest nachylone (${pl(slopeDeg)}°), ale ${soil.category === 'lekka' ? 'lekka gleba szybko przyjmuje wodę i' : ''} opady od 1 marca nie były na tyle intensywne, żeby spływać – spływ po powierzchni był pomijalny.`.replace('ale  opady', 'ale opady'),
    );
  }
  const contrast = terrain && ndmi ? slopeContrast(terrain, ndmi) : null;
  const upperDrier = contrast !== null && reading.median !== null && contrast.upperMedian <= contrast.lowerMedian - 0.05;
  if (upperDrier && contrast) {
    summaryParts.push(
      `Wyżej położona część pola jest suchsza (NDMI ${fmt(contrast.upperMedian)}) niż niższa (${fmt(contrast.lowerMedian)}) przy ${pl(contrast.reliefM)} m różnicy wysokości – woda spływa w dół stoku.`,
    );
  }
  if (reading.deviatingPct !== null && reading.deviatingPct >= 15) {
    summaryParts.push(`Na ok. ${Math.round(reading.deviatingPct)}% powierzchni rośliny wyraźnie odbiegają od reszty pola – miejsca pokazuje warstwa NDMI w zakładce „Teren i spływ 3D”.`);
  }
  if (uncertain) summaryParts.push('Wynik jest blisko granicy klas – przy innej retencji gleby ocena byłaby inna; warto sprawdzić wilgotność gleby w terenie.');
  if (evalDate !== request.analysisDate) summaryParts.push(`Ocena na ${formatDate(evalDate)} – ostatni dzień z kompletem danych pogodowych.`);

  const balanceIndicators: Indicator[] = [
    {
      id: 'zapas',
      label: 'Zapas wody dostępnej w strefie korzeni',
      value: Math.round(today.taw - today.dr),
      unit: 'mm',
      reference: { label: 'pełny zapas (TAW)', value: Math.round(today.taw) },
      observedOn: evalDate,
      interpretation: `${reservePct}% pełnego zapasu; próg stresu przy ubytku ${mm(today.raw)} (RAW).`,
      sourceId: 'gleba',
      isIndirect: false,
    },
    ...(reading.median !== null
      ? [
          {
            id: 'ndmi',
            label: 'Uwodnienie roślin z satelity (NDMI, Sentinel-2)',
            value: reading.median,
            unit: '',
            reference: reading.okFrom !== null ? { label: 'dobre uwodnienie w tej fazie od', value: reading.okFrom } : null,
            observedOn: reading.sceneDate,
            interpretation: reading.text,
            sourceId: 's2',
            isIndirect: true,
          } satisfies Indicator,
        ]
      : []),
    {
      id: 'splyw',
      label: 'Opad, który spłynął po powierzchni (od 1 marca)',
      value: Math.round(seasonRunoff),
      unit: 'mm',
      reference: { label: 'opad od 1 marca', value: Math.round(seasonRain) },
      observedOn: evalDate,
      interpretation: `${seasonRain > 0 ? Math.round((100 * seasonRunoff) / seasonRain) : 0}% opadu; metoda SCS-CN (CN ${Math.round(cn)}) dla nachylenia ${pl(slopeDeg)}°${terrain ? ' z NMT' : ' (założone – brak NMT)'}.`,
      sourceId: terrain ? 'nmt' : 'pogoda0',
      isIndirect: false,
    },
    ...weatherIndicators,
  ];

  // Podatność historyczna: 10 poprzednich sezonów.
  const analysisYear = Number(evalDate.slice(0, 4));
  let deficitSeasons = 0;
  let seasonsCounted = 0;
  const runoffSeasons: number[] = [];
  const monthHits = new Map<number, number>();
  for (let y = analysisYear - 10; y < analysisYear; y += 1) {
    const run = simulate(weather, { cropId: request.cropId, horizons: soil.horizons, tawScale: 1, from: `${y}-03-01`, to: `${y}-${crop.harvest}`, curveNumber: cn });
    if (run.length === 0 || run[run.length - 1]?.date !== `${y}-${crop.harvest}`) continue;
    seasonsCounted += 1;
    runoffSeasons.push(run.reduce((sum, d) => sum + d.ro, 0));
    const stressDays = run.filter((d) => d.inSeason && d.dr > d.raw);
    if (stressDays.length >= STRESS_DAYS_FOR_DEFICIT_SEASON) deficitSeasons += 1;
    const perMonth = new Map<number, number>();
    for (const d of stressDays) perMonth.set(Number(d.date.slice(5, 7)), (perMonth.get(Number(d.date.slice(5, 7))) ?? 0) + 1);
    for (const [m, n] of perMonth) if (n >= 7) monthHits.set(m, (monthHits.get(m) ?? 0) + 1);
  }
  const criticalMonths = [...monthHits.entries()].filter(([, n]) => seasonsCounted > 0 && n / seasonsCounted >= 0.3).map(([m]) => m).sort((a, b) => a - b);
  const histLevel: RiskLevel = seasonsCounted < 5 ? 'insufficient_data' : deficitSeasons >= 6 ? 'elevated' : deficitSeasons >= 3 ? 'moderate' : 'low';
  const avgRunoff = runoffSeasons.length > 0 ? runoffSeasons.reduce((a, b) => a + b, 0) / runoffSeasons.length : 0;
  const steepPct = terrain ? Math.round((terrain.erosion.parcelClassPct[2] ?? 0) + (terrain.erosion.parcelClassPct[3] ?? 0) + (terrain.erosion.parcelClassPct[4] ?? 0)) : 0;
  const m3PerParcel = (mmValue: number) => Math.round(mmValue * 10 * parcel.areaHa);
  const tawMax = tawProbe ?? 0;
  const soilWord = soil.category === 'lekka' ? 'Gleba lekka słabo zatrzymuje wodę' : soil.category === 'ciężka' ? 'Gleba ciężka dobrze zatrzymuje wodę' : 'Gleba średnia zatrzymuje wodę umiarkowanie';

  // Zalecenia wynikające z oceny.
  const recommendations: Recommendation[] = [];
  const near = hydro?.status === 'ok' ? hydro.waterways.filter((w) => w.distanceM <= 100) : [];
  if (near.length > 0 && (histLevel === 'elevated' || histLevel === 'moderate' || level !== 'low')) {
    const w = near[0]!;
    recommendations.push({
      id: 'rec-row',
      category: 'retencja',
      title: `Sprawdź możliwość spowolnienia odpływu w pobliskim ${w.kind.startsWith('rów') ? 'rowie' : w.kind === 'kanał' ? 'kanale' : 'cieku'}`,
      action:
        w.kind === 'rów' || w.kind === 'rów odwadniający'
          ? 'Rozważ zastawkę lub próg na rowie i spiętrzanie wody wczesną wiosną, zanim odpłyną wody roztopowe.'
          : 'Rozważ działania spowalniające odpływ (np. pas zadrzewień lub zadarnienia przy cieku); budowle na cieku wymagają zgody Wód Polskich.',
      rationale: `${w.distanceM === 0 ? 'Przez działkę przebiega' : `W odległości ${distanceText(w)} od działki przebiega`} ${w.kind}${w.name ? ` (${w.name})` : ''}${w.details ? `, ${w.details}` : ''} – wg ${w.origin === 'mphp' ? 'MPHP10 Wód Polskich' : 'OpenStreetMap'}. ${
        deficitSeasons > 0 ? `W ${deficitSeasons} z ${seasonsCounted} ostatnich sezonów uprawie brakowało wody.` : ''
      }`,
      evidenceSourceIds: ['hydro', 'pogoda0'],
      fieldChecks: [
        'Kto jest właścicielem i zarządcą rowu lub cieku (spółka wodna, gmina, Wody Polskie)?',
        'Czy potrzebne jest zgłoszenie wodnoprawne lub pozwolenie?',
        'Czy spiętrzenie nie podtopi sąsiednich działek, dróg ani drenażu?',
        'Potwierdź przebieg rowu w terenie – mapy (MPHP, OpenStreetMap) nie zawsze są aktualne.',
      ],
      fieldTask: `Przejdź wzdłuż ${w.kind.startsWith('rów') ? 'rowu' : 'cieku'} przy działce i wybierz miejsce na zastawkę lub próg: wąski odcinek ze stabilnymi brzegami, poniżej miejsca, gdzie woda z pola wpływa do ${w.kind.startsWith('rów') ? 'rowu' : 'cieku'}.`,
      evidenceNumbers: [
        { label: 'Odległość od działki', value: distanceText(w) },
        ...(w.details ? [{ label: 'Charakter', value: w.details }] : []),
        { label: 'Sezony z niedoborem wody', value: `${deficitSeasons} z ${seasonsCounted}` },
      ],
      suggestedArea: null,
    });
  }
  if (soil.category === 'lekka' || tawMax < 110) {
    recommendations.push({
      id: 'rec-prochnica',
      category: 'agrotechnika',
      title: 'Zwiększaj zdolność gleby do zatrzymywania wody',
      action: 'Pozostawiaj rozdrobnione resztki pożniwne, wysiewaj międzyplony i stosuj nawozy organiczne, żeby zwiększyć ilość próchnicy.',
      rationale: `${soilWord}: w strefie korzeni mieści się ok. ${mm(tawMax)} wody dostępnej dla roślin (SoilGrids${soil.topsoilTexture ? `, ${soil.topsoilTexture}` : ''}). Więcej materii organicznej zwiększa ten zapas.`,
      evidenceSourceIds: ['gleba'],
      fieldChecks: ['Rzeczywista tekstura gleby na działce (SoilGrids ma rozdzielczość 250 m).', 'Termin i możliwość siewu międzyplonu w płodozmianie.'],
      suggestedArea: null,
    });
  }
  if (today.inSeason && level !== 'low') {
    recommendations.push({
      id: 'rec-wilgoc',
      category: 'agrotechnika',
      title: 'Ogranicz straty wilgoci w glebie teraz',
      action: 'Unikaj zabiegów, które przesuszają glebę (głęboka uprawa, zbędne przejazdy); jeśli to możliwe, zostaw glebę przykrytą resztkami lub mulczem.',
      rationale: `Na ${formatDate(evalDate)} ubytek wody w strefie korzeni wynosi ${mm(today.dr)} przy progu ${mm(today.raw)}; ${
        weatherIndicators[1]?.value !== null && weatherIndicators[1]?.value !== undefined ? `bilans wodny z 60 dni: ${weatherIndicators[1].value} mm.` : ''
      }${reading.signal !== 'na' ? ` ${reading.text}` : ''}`,
      evidenceSourceIds: ['pogoda0', 'gleba', ...(reading.signal !== 'na' ? ['s2'] : [])],
      fieldChecks: ['Wilgotność gleby na głębokości 10–30 cm (próba „w ręku”).', 'Objawy stresu na roślinach: zwijanie liści w południe, żółknięcie dolnych liści.'],
      suggestedArea: null,
    });
  }
  if ((histLevel === 'elevated' || histLevel === 'moderate') && criticalMonths.length > 0) {
    recommendations.push({
      id: 'rec-plan',
      category: 'retencja',
      title: 'Zatrzymuj wodę z roztopów i wiosennych opadów',
      action: 'Spowalniaj odpływ wody z pola wczesną wiosną: obniżenia terenu, pasy zadarnienia, uprawa w poprzek stoku. Miejsca, w których zbiera się spływ, pokazuje zakładka „Teren i spływ 3D”.',
      rationale: `W ${deficitSeasons} z ${seasonsCounted} ostatnich sezonów uprawa (${cropName}) miała niedobór wody, najczęściej w miesiącach: ${criticalMonths
        .map((m) => ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'][m - 1])
        .join(', ')}. Zapas wody zgromadzony wiosną opóźnia ten niedobór.`,
      evidenceSourceIds: ['pogoda0', 'gleba', 'nmt'],
      fieldChecks: ['Miejsca, w których woda spływa z pola po roztopach i ulewach.', 'Stan rowów i przepustów na granicy działki.'],
      fieldTask: 'Przed roztopami (luty–marzec) sprawdź, którędy woda opuszcza pole, i zamknij lub przytkaj odpływ (zastawka, próg, zasyp bruzdy odpływowej), jeśli nie podtopi to sąsiednich działek.',
      evidenceNumbers: [
        { label: 'Sezony z niedoborem wody', value: `${deficitSeasons} z ${seasonsCounted}` },
        { label: 'Pełny zapas wody w glebie (TAW)', value: mm(tawMax) },
      ],
      suggestedArea: null,
    });
  }

  const candidate = terrain?.retentionCandidate ?? null;
  const waterMatters = histLevel === 'elevated' || histLevel === 'moderate' || level !== 'low';
  if (candidate && (waterMatters || avgRunoff >= 1 || recommendations.some((r) => r.category === 'retencja'))) {
    const ring = candidate.ring.map((p) => epsg2180ToWgs84(p as Xy) as [number, number]);
    recommendations.push({
      id: 'rec-miejsce',
      category: 'retencja',
      title: candidate.kind === 'depression' ? 'Zatrzymaj wodę w obniżeniu terenu na działce' : 'Spowolnij wodę tam, gdzie spływ zbiera się w strugę',
      action:
        candidate.kind === 'depression'
          ? 'W zaznaczonym obniżeniu woda zbiera się naturalnie: można je pogłębić w płytkie zagłębienie retencyjne (oczko śródpolne) albo zostawić pod trwałą roślinnością, żeby woda wsiąkała, zamiast odpływać.'
          : 'W zaznaczonym miejscu spływ z pola skupia się w jedną strugę: pas zadarnienia w poprzek spływu, niski wał lub próg z faszyny spowolnią wodę i dadzą jej czas wsiąknąć.',
      rationale: `${candidate.reasons.join(' ')} ${
        avgRunoff >= 1 ? `W ostatnich ${runoffSeasons.length} sezonach z pola spływało średnio ok. ${mm(avgRunoff)} wody na sezon (ok. ${m3PerParcel(avgRunoff).toLocaleString('pl-PL')} m³ z całej działki).` : ''
      }${upperDrier && contrast ? ` Satelita pokazuje suchszą górną część pola (NDMI ${fmt(contrast.upperMedian)} wobec ${fmt(contrast.lowerMedian)} niżej).` : ''}`,
      evidenceSourceIds: ['nmt', 'pogoda0', 'gleba', ...(upperDrier ? ['s2'] : [])],
      fieldChecks: [
        'Czy w tym miejscu po roztopach i ulewach stoi lub płynie woda?',
        'Czy nie ma tu drenażu, który odprowadza wodę z obniżenia?',
        'Zbiornik lub budowla piętrząca może wymagać zgłoszenia wodnoprawnego.',
      ],
      fieldTask:
        candidate.kind === 'depression'
          ? 'Po najbliższych roztopach lub ulewie obejdź zaznaczone obniżenie i oznacz palikami zasięg stojącej wody – to granica przyszłego zagłębienia retencyjnego.'
          : 'Po najbliższej ulewie sprawdź zaznaczone miejsce: gdzie płynie struga i czy wymywa glebę – tam wytycz pas zadarnienia w poprzek spływu (szer. co najmniej 6 m).',
      evidenceNumbers: [
        ...candidate.metrics.map((m) => ({ label: m.label.charAt(0).toLocaleUpperCase('pl-PL') + m.label.slice(1), value: m.value })),
        ...(avgRunoff >= 1
          ? [
              { label: 'Średni spływ z działki w sezonie', value: `${mm(avgRunoff)} (ok. ${m3PerParcel(avgRunoff).toLocaleString('pl-PL')} m³)` },
              { label: 'Średnie nachylenie działki', value: `${pl(slopeDeg)}°` },
            ]
          : []),
      ],
      suggestedArea: { label: candidate.title, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]!]] } },
    });
  }
  if (terrain && (slopeDeg >= 3 || steepPct >= 20) && avgRunoff >= 3) {
    recommendations.push({
      id: 'rec-stok',
      category: 'agrotechnika',
      title: 'Ogranicz spływ wody ze stoku',
      action: 'Wykonuj uprawę i siew w poprzek stoku, zostawiaj na powierzchni resztki pożniwne lub mulcz, a na najbardziej stromych fragmentach rozważ pasy zadarnienia.',
      rationale: `Średnie nachylenie działki to ${pl(slopeDeg)}°, a ${steepPct}% jej powierzchni ma ponad 5° (NMT). Według bilansu z pola spływa średnio ok. ${mm(avgRunoff)} wody na sezon – tyle uprawa traci, zanim woda wsiąknie.${
        upperDrier && contrast ? ` Zdjęcie satelitarne to potwierdza: wyżej rośliny są suchsze (NDMI ${fmt(contrast.upperMedian)}) niż niżej (${fmt(contrast.lowerMedian)}).` : ''
      }`,
      evidenceSourceIds: ['nmt', 'pogoda0', ...(upperDrier ? ['s2'] : [])],
      fieldChecks: ['Ślady spływu po ulewach: żłobiny, namyta ziemia u podnóża stoku.', 'Czy kierunek uprawy można zmienić bez utrudnień dla maszyn?'],
      fieldTask: 'Przy najbliższej uprawie wyznacz kierunek przejazdów w poprzek spadku (wzdłuż poziomic) – kierunek spadku pokazują strzałki w zakładce „Teren i spływ 3D”.',
      evidenceNumbers: [
        { label: 'Średnie nachylenie', value: `${pl(slopeDeg)}°` },
        { label: 'Część działki o nachyleniu ponad 5°', value: `${steepPct}%` },
        { label: 'Średni spływ w sezonie', value: `${mm(avgRunoff)} (ok. ${m3PerParcel(avgRunoff).toLocaleString('pl-PL')} m³)` },
      ],
      suggestedArea: null,
    });
  }
  const irrigationJustified = today.inSeason && today.dr > today.raw;
  return {
    ...base,
    currentState: {
      asOf: evalDate,
      level,
      headline,
      summary: summaryParts.join(' '),
      indicators: balanceIndicators,
    },
    historicalVulnerability: {
      level: histLevel,
      headline:
        histLevel === 'elevated'
          ? 'Działka podatna na suszę'
          : histLevel === 'moderate'
            ? 'Umiarkowana podatność na suszę'
            : histLevel === 'low'
              ? 'Niska podatność na suszę'
              : 'Za mało danych',
      summary: `${soilWord} (ok. ${mm(tawMax)} wody dostępnej przy pełnym ukorzenieniu). W ${deficitSeasons} z ${seasonsCounted} sezonów (${analysisYear - 10}–${analysisYear - 1}) uprawa (${cropName}) miała co najmniej ${STRESS_DAYS_FOR_DEFICIT_SEASON} dni niedoboru wody.`,
      period: { from: `${analysisYear - 10}-03-01`, to: evalDate },
      criticalMonths,
      indicators: [
        {
          id: 'sezony',
          label: 'Sezony z niedoborem wody',
          value: deficitSeasons,
          unit: `z ${seasonsCounted}`,
          reference: null,
          observedOn: null,
          interpretation: `Sezon liczony jako „z niedoborem” przy co najmniej ${STRESS_DAYS_FOR_DEFICIT_SEASON} dniach z ubytkiem powyżej progu.`,
          sourceId: 'pogoda0',
          isIndirect: false,
        },
        {
          id: 'taw',
          label: 'Pełny zapas wody dostępnej (TAW)',
          value: Math.round(tawMax),
          unit: 'mm',
          reference: null,
          observedOn: null,
          interpretation: `${soil.topsoilTexture ?? 'tekstura nieznana'}; korzenie do ${pl(crop.zrMax)} m.`,
          sourceId: 'gleba',
          isIndirect: false,
        },
        {
          id: 'splyw-sezon',
          label: 'Średni spływ po powierzchni w sezonie',
          value: Math.round(avgRunoff),
          unit: 'mm',
          reference: terrain ? { label: 'średnie nachylenie', value: `${pl(slopeDeg)}°` } : null,
          observedOn: null,
          interpretation:
            avgRunoff >= 1
              ? `Ok. ${m3PerParcel(avgRunoff).toLocaleString('pl-PL')} m³ wody z całej działki na sezon odpływa, zamiast wsiąknąć${steepPct > 0 ? `; ${steepPct}% działki ma nachylenie ponad 5°` : ''}.`
              : 'Woda z opadów niemal w całości wsiąka – spływ jest pomijalny.',
          sourceId: terrain ? 'nmt' : 'pogoda0',
          isIndirect: false,
        },
      ],
    },
    recommendations,
    irrigation: irrigationJustified
      ? {
          status: 'calculated',
          justified: true,
          summary: `Jeśli masz dostęp do wody, nawadnianie jest uzasadnione: do pełnego zapasu brakuje ok. ${mm(today.dr)}. Jednorazowo podawaj najwyżej 20–30 mm, żeby woda nie przesiąkła poniżej korzeni.`,
          window: null,
          doseMm: Math.min(30, Math.round(today.dr)),
        }
      : {
          status: 'calculated',
          justified: false,
          summary: today.inSeason
            ? 'Nawadnianie nie jest teraz potrzebne – zapas wody w glebie jest powyżej progu stresu.'
            : 'Poza sezonem uprawy – nawadnianie nie dotyczy.',
          window: null,
          doseMm: null,
        },
    forecast: forecastFor(today, evalDate),
  };
}

function missingSource(id: string, kind: DataSource['kind'], name: string, reason: string): DataSource {
  return {
    id,
    kind,
    name,
    provider: 'brak danych',
    url: null,
    license: null,
    availability: 'missing',
    observationDate: null,
    retrievedAt: null,
    coverage: null,
    limitations: [reason],
    details: null,
  };
}

function insufficientHistory() {
  return { level: 'insufficient_data' as const, headline: 'Za mało danych', summary: 'Brak danych.', period: null, criticalMonths: [], indicators: [] };
}
