/**
 * Dzienne dane pogodowe dla punktu: opad i ewapotranspiracja wskaźnikowa ET0 (FAO-56), w mm.
 *
 * Kolejność źródeł:
 * 1. Open-Meteo – archiwum (reanaliza ERA5 i pochodne), ET0 liczone przez usługę.
 * 2. NASA POWER (gdy Open-Meteo odmówi, np. po przekroczeniu dziennego limitu) – ET0 liczymy sami (Penman–Monteith FAO-56).
 * 3. Ostatnie dni, których archiwa jeszcze nie mają, uzupełniamy z Open-Meteo Forecast (dane modelowe z ostatnich dni).
 * Brakujące dni zostają jako null – nie zastępujemy ich zerem.
 */
import type { SourceInfo } from '../../src/types/terrain';
import { cacheGet, cacheSet, once } from '../cache';
import { errorText } from './uldk';

export interface WeatherDay {
  date: string;
  precipitationMm: number | null;
  et0Mm: number | null;
  source: 'open-meteo-archive' | 'nasa-power' | 'open-meteo-forecast' | null;
}

export interface WeatherSeries {
  days: WeatherDay[];
  sources: SourceInfo[];
  /** Ostatni dzień z kompletem danych (opad i ET0). */
  lastCompleteDate: string | null;
  notes: string[];
}

const WEATHER_VERSION = 1;

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export async function getWeather(lat: number, lon: number, start: string, end: string, today: string): Promise<WeatherSeries> {
  const rLat = Math.round(lat * 20) / 20;
  const rLon = Math.round(lon * 20) / 20;
  const key = `v${WEATHER_VERSION}:${rLat}:${rLon}:${start}:${end}`;
  // Wynik z ostatnimi dniami (z prognozy) zmienia się w czasie – bufor tylko dla zakresów zakończonych ponad 10 dni temu.
  const cacheable = end <= addDays(today, -10);
  if (cacheable) {
    const cached = await cacheGet<WeatherSeries>('weather', key);
    if (cached) return cached;
  }
  return once(`weather:${key}`, async () => {
    const result = await fetchWeather(rLat, rLon, start, end, today);
    if (cacheable && result.lastCompleteDate === end) await cacheSet('weather', key, result);
    return result;
  });
}

async function fetchWeather(lat: number, lon: number, start: string, end: string, today: string): Promise<WeatherSeries> {
  const byDate = new Map<string, WeatherDay>(dateRange(start, end).map((date) => [date, { date, precipitationMm: null, et0Mm: null, source: null }]));
  const sources: SourceInfo[] = [];
  const notes: string[] = [];

  // 1. Open-Meteo archiwum.
  const t0 = Date.now();
  let archiveOk = false;
  try {
    const url =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}` +
      '&daily=precipitation_sum,et0_fao_evapotranspiration&timezone=Europe%2FWarsaw';
    const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const json = (await response.json()) as { daily?: { time: string[]; precipitation_sum: (number | null)[]; et0_fao_evapotranspiration: (number | null)[] }; reason?: string };
    if (!response.ok || !json.daily) throw new Error(json.reason ?? `HTTP ${response.status}`);
    json.daily.time.forEach((date, i) => {
      const day = byDate.get(date);
      const p = json.daily?.precipitation_sum[i];
      const e = json.daily?.et0_fao_evapotranspiration[i];
      if (day && typeof p === 'number' && typeof e === 'number') Object.assign(day, { precipitationMm: p, et0Mm: e, source: 'open-meteo-archive' });
    });
    archiveOk = true;
    sources.push(source('Opad i ET0 (FAO-56) – archiwum Open-Meteo', 'Open-Meteo (reanaliza ERA5/ERA5-Land, ECMWF)', 'https://open-meteo.com/en/docs/historical-weather-api', Date.now() - t0, 'Siatka ok. 10–25 km; licencja CC BY 4.0.'));
  } catch (error) {
    notes.push(`Archiwum Open-Meteo niedostępne (${errorText(error)}) – użyto NASA POWER.`);
  }

  // 2. NASA POWER, gdy archiwum Open-Meteo zawiodło.
  if (!archiveOk) {
    const t1 = Date.now();
    try {
      const url =
        `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,T2M,T2M_MAX,T2M_MIN,RH2M,WS2M,ALLSKY_SFC_SW_DWN` +
        `&community=AG&longitude=${lon}&latitude=${lat}&start=${start.replaceAll('-', '')}&end=${end.replaceAll('-', '')}&format=JSON`;
      const response = await fetch(url, { signal: AbortSignal.timeout(40000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as { properties?: { parameter?: Record<string, Record<string, number>> } };
      const p = json.properties?.parameter ?? {};
      for (const [compact, precip] of Object.entries(p.PRECTOTCORR ?? {})) {
        const date = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
        const day = byDate.get(date);
        if (!day) continue;
        const et0 = et0PenmanMonteith({
          date,
          latDeg: lat,
          tMax: p.T2M_MAX?.[compact],
          tMin: p.T2M_MIN?.[compact],
          tMean: p.T2M?.[compact],
          rhMean: p.RH2M?.[compact],
          wind2m: p.WS2M?.[compact],
          rsMj: p.ALLSKY_SFC_SW_DWN?.[compact],
        });
        if (precip > -900 && et0 !== null) Object.assign(day, { precipitationMm: precip, et0Mm: et0, source: 'nasa-power' });
      }
      sources.push(
        source(
          'Opad, temperatura, wilgotność, wiatr i promieniowanie – NASA POWER',
          'NASA Langley Research Center, projekt POWER (MERRA-2, GPM)',
          'https://power.larc.nasa.gov/',
          Date.now() - t1,
          'Siatka ok. 50 km; ET0 liczone w aplikacji metodą Penmana–Monteitha (FAO-56).',
        ),
      );
    } catch (error) {
      notes.push(`NASA POWER niedostępne (${errorText(error)}).`);
    }
  }

  // 3. Ostatnie dni z Open-Meteo Forecast (archiwa mają kilka dni opóźnienia).
  const missingTail = [...byDate.values()].filter((d) => d.precipitationMm === null || d.et0Mm === null).map((d) => d.date);
  const pastDays = Math.ceil((Date.parse(today) - Date.parse(start)) / 86400000);
  if (missingTail.length > 0 && missingTail[0] !== undefined && missingTail[0] >= addDays(today, -90)) {
    const t2 = Date.now();
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&past_days=${Math.min(92, Math.max(1, pastDays))}` +
        '&forecast_days=1&daily=precipitation_sum,et0_fao_evapotranspiration&timezone=Europe%2FWarsaw';
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const json = (await response.json()) as { daily?: { time: string[]; precipitation_sum: (number | null)[]; et0_fao_evapotranspiration: (number | null)[] } };
      let filled = 0;
      json.daily?.time.forEach((date, i) => {
        const day = byDate.get(date);
        const p = json.daily?.precipitation_sum[i];
        const e = json.daily?.et0_fao_evapotranspiration[i];
        if (day && (day.precipitationMm === null || day.et0Mm === null) && typeof p === 'number' && typeof e === 'number') {
          Object.assign(day, { precipitationMm: p, et0Mm: e, source: 'open-meteo-forecast' });
          filled += 1;
        }
      });
      if (filled > 0) {
        sources.push(
          source(
            'Ostatnie dni – model prognostyczny Open-Meteo',
            'Open-Meteo Forecast (modele ICON, ECMWF i inne)',
            'https://open-meteo.com/en/docs',
            Date.now() - t2,
            `Uzupełniono ${filled} ostatnich dni, których archiwa jeszcze nie zawierają – to dane modelowe, nie pomiary.`,
          ),
        );
      }
    } catch (error) {
      notes.push(`Prognoza Open-Meteo niedostępna (${errorText(error)}).`);
    }
  }

  const days = [...byDate.values()];
  let lastCompleteDate: string | null = null;
  for (const day of days) {
    if (day.precipitationMm === null || day.et0Mm === null) break;
    lastCompleteDate = day.date;
  }
  return { days, sources, lastCompleteDate, notes };
}

function source(name: string, provider: string, url: string, durationMs: number, note: string): SourceInfo {
  return {
    name,
    provider,
    url,
    origin: 'observed',
    retrievedAt: new Date().toISOString(),
    observationDate: null,
    resolutionM: null,
    durationMs,
    notes: [note],
  };
}

/**
 * Ewapotranspiracja wskaźnikowa ET0 (FAO-56, równ. 6) z danych dobowych.
 * Wejście: temperatury °C, wilgotność względna %, wiatr na 2 m [m/s], promieniowanie całkowite Rs [MJ/m²/doba].
 */
export function et0PenmanMonteith(input: {
  date: string;
  latDeg: number;
  tMax: number | undefined;
  tMin: number | undefined;
  tMean: number | undefined;
  rhMean: number | undefined;
  wind2m: number | undefined;
  rsMj: number | undefined;
  elevationM?: number;
}): number | null {
  const { tMax, tMin, rhMean, wind2m, rsMj } = input;
  const valid = (v: number | undefined): v is number => typeof v === 'number' && v > -900;
  if (!valid(tMax) || !valid(tMin) || !valid(rhMean) || !valid(wind2m) || !valid(rsMj)) return null;
  const tMean = valid(input.tMean) ? input.tMean : (tMax + tMin) / 2;
  const z = input.elevationM ?? 150;
  const pressure = 101.3 * ((293 - 0.0065 * z) / 293) ** 5.26;
  const gamma = 0.000665 * pressure;
  const es = (t: number) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
  const esMean = (es(tMax) + es(tMin)) / 2;
  const ea = (rhMean / 100) * esMean;
  const delta = (4098 * es(tMean)) / (tMean + 237.3) ** 2;
  // Promieniowanie pozaziemskie Ra i promieniowanie przy bezchmurnym niebie Rso.
  const ra = extraterrestrialRadiation(input.date, input.latDeg);
  const rso = (0.75 + 2e-5 * z) * ra;
  const rns = 0.77 * rsMj;
  const sigma = 4.903e-9;
  const tk4 = ((tMax + 273.16) ** 4 + (tMin + 273.16) ** 4) / 2;
  const ratio = rso > 0 ? Math.min(1, rsMj / rso) : 0.5;
  const rnl = sigma * tk4 * (0.34 - 0.14 * Math.sqrt(Math.max(0, ea))) * (1.35 * ratio - 0.35);
  const rn = rns - rnl;
  const et0 = (0.408 * delta * rn + gamma * (900 / (tMean + 273)) * wind2m * (esMean - ea)) / (delta + gamma * (1 + 0.34 * wind2m));
  return Math.max(0, Math.round(et0 * 100) / 100);
}

/** Promieniowanie pozaziemskie Ra [MJ/m²/doba] (FAO-56, równ. 21). */
export function extraterrestrialRadiation(date: string, latDeg: number): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const doy = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
  const phi = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
  const decl = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(decl))));
  return ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.sin(ws));
}

export interface ForecastDayRaw {
  date: string;
  precipitationMm: number | null;
  /** Największe prawdopodobieństwo opadu w ciągu dnia (%). */
  probabilityPct: number | null;
  et0Mm: number | null;
  tMax: number | null;
  tMin: number | null;
  /** true – dzień już minął (dane modelowe z ostatnich dni), false – prognoza. */
  past: boolean;
}

export interface ForecastSeries {
  days: ForecastDayRaw[];
  issuedAt: string;
  source: SourceInfo;
}

const forecastMemory = new Map<string, { at: number; value: ForecastSeries }>();
const FORECAST_TTL_MS = 60 * 60 * 1000;

/**
 * Prognoza dzienna na ok. 10 dni; bufor 1 h w pamięci i na dysku (restart serwera nie zużywa limitu zapytań).
 * Kolejność: Open-Meteo (z prawdopodobieństwem opadu i ET0) → MET Norway (gdy Open-Meteo odmówi, np. dzienny limit 429).
 */
export async function getForecast(lat: number, lon: number, today: string): Promise<ForecastSeries> {
  const rLat = Math.round(lat * 20) / 20;
  const rLon = Math.round(lon * 20) / 20;
  const key = `${rLat}:${rLon}:${today}`;
  const hit = forecastMemory.get(key) ?? (await cacheGet<{ at: number; value: ForecastSeries }>('forecast', key));
  if (hit && Date.now() - hit.at < FORECAST_TTL_MS) return hit.value;
  return once(`forecast:${key}`, async () => {
    const errors: string[] = [];
    let value: ForecastSeries | null = null;
    try {
      value = await fetchOpenMeteoForecast(rLat, rLon, today);
    } catch (error) {
      errors.push(`Open-Meteo: ${errorText(error)}`);
    }
    if (!value) {
      try {
        value = await fetchMetNoForecast(rLat, rLon, today);
        value.source.notes.unshift(`Open-Meteo niedostępne (${errors.join('; ')}) – użyto prognozy MET Norway.`);
      } catch (error) {
        errors.push(`MET Norway: ${errorText(error)}`);
      }
    }
    if (!value) throw new Error(`Prognoza pogody niedostępna – ${errors.join('; ')}`);
    const entry = { at: Date.now(), value };
    forecastMemory.set(key, entry);
    await cacheSet('forecast', key, entry);
    return value;
  });
}

async function fetchOpenMeteoForecast(rLat: number, rLon: number, today: string): Promise<ForecastSeries> {
  const t0 = Date.now();
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${rLat}&longitude=${rLon}&past_days=7&forecast_days=10` +
    '&daily=precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,temperature_2m_max,temperature_2m_min' +
    '&timezone=Europe%2FWarsaw';
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Open-Meteo Forecast: HTTP ${response.status}`);
  const json = (await response.json()) as {
    daily?: {
      time: string[];
      precipitation_sum: (number | null)[];
      precipitation_probability_max: (number | null)[];
      et0_fao_evapotranspiration: (number | null)[];
      temperature_2m_max: (number | null)[];
      temperature_2m_min: (number | null)[];
    };
  };
  const d = json.daily;
  if (!d) throw new Error('Open-Meteo Forecast: brak danych dziennych');
  const value: ForecastSeries = {
    issuedAt: new Date().toISOString(),
    days: d.time.map((date, i) => ({
      date,
      precipitationMm: d.precipitation_sum[i] ?? null,
      probabilityPct: d.precipitation_probability_max[i] ?? null,
      et0Mm: d.et0_fao_evapotranspiration[i] ?? null,
      tMax: d.temperature_2m_max[i] ?? null,
      tMin: d.temperature_2m_min[i] ?? null,
      past: date < today,
    })),
    source: source(
      'Prognoza opadu, ET0 i temperatury na 10 dni',
      'Open-Meteo Forecast (najlepsze dostępne modele numeryczne dla punktu, m.in. ICON, ECMWF)',
      'https://open-meteo.com/en/docs',
      Date.now() - t0,
      'Prognoza – im dalszy dzień, tym większa niepewność, szczególnie dla opadów konwekcyjnych (burz).',
    ),
  };
  return value;
}

const warsawDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * MET Norway Locationforecast 2.0 (dane CC BY 4.0, wymagany identyfikujący User-Agent). Kroki godzinowe, dalej 6-godzinne;
 * sumujemy je do dni (czas polski). ET0 liczymy wzorem FAO-56 Penman–Monteith; promieniowanie z zachmurzenia
 * (Ångström: Rs = (0,25 + 0,5·(1 − zachmurzenie))·Ra), wiatr z 10 m przeliczony na 2 m (×0,748).
 */
export async function fetchMetNoForecast(lat: number, lon: number, today: string): Promise<ForecastSeries> {
  const t0 = Date.now();
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'KroplaWPolu/1.0 (+https://github.com/hautlizard77/woda-na-polu)', Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = (await response.json()) as {
    properties?: {
      timeseries?: {
        time: string;
        data: {
          instant: { details: Record<string, number> };
          next_1_hours?: { details?: { precipitation_amount?: number } };
          next_6_hours?: { details?: { precipitation_amount?: number; air_temperature_max?: number; air_temperature_min?: number } };
        };
      }[];
    };
  };
  const series = json.properties?.timeseries ?? [];
  if (series.length === 0) throw new Error('brak danych prognozy');
  return { issuedAt: new Date().toISOString(), days: aggregateMetNo(series, lat, today), source: metSource(Date.now() - t0) };
}

export function aggregateMetNo(
  series: {
    time: string;
    data: {
      instant: { details: Record<string, number> };
      next_1_hours?: { details?: { precipitation_amount?: number } };
      next_6_hours?: { details?: { precipitation_amount?: number; air_temperature_max?: number; air_temperature_min?: number } };
    };
  }[],
  lat: number,
  today: string,
): ForecastDayRaw[] {
  type Acc = { hours: number; precip: number; tMax: number; tMin: number; tSum: number; rhSum: number; windSum: number; cloudSum: number };
  const days = new Map<string, Acc>();
  series.forEach((point, i) => {
    const next = series[i + 1];
    const stepH = next ? (Date.parse(next.time) - Date.parse(point.time)) / 3_600_000 : 6;
    const date = warsawDate.format(new Date(point.time));
    const d = point.data.instant.details;
    const acc = days.get(date) ?? { hours: 0, precip: 0, tMax: -Infinity, tMin: Infinity, tSum: 0, rhSum: 0, windSum: 0, cloudSum: 0 };
    const t = d.air_temperature ?? NaN;
    acc.hours += stepH;
    acc.tSum += t * stepH;
    acc.rhSum += (d.relative_humidity ?? NaN) * stepH;
    acc.windSum += (d.wind_speed ?? NaN) * stepH;
    acc.cloudSum += (d.cloud_area_fraction ?? NaN) * stepH;
    acc.tMax = Math.max(acc.tMax, t, point.data.next_6_hours?.details?.air_temperature_max ?? -Infinity);
    acc.tMin = Math.min(acc.tMin, t, point.data.next_6_hours?.details?.air_temperature_min ?? Infinity);
    acc.precip += stepH <= 1.01 ? (point.data.next_1_hours?.details?.precipitation_amount ?? 0) : (point.data.next_6_hours?.details?.precipitation_amount ?? 0);
    days.set(date, acc);
  });
  const out: ForecastDayRaw[] = [];
  for (const [date, a] of [...days.entries()].sort(([x], [y]) => (x < y ? -1 : 1))) {
    // Tylko dni pokryte prognozą w większości (pierwszy i ostatni bywają niepełne).
    if (a.hours < 18 || date < today) continue;
    const tMean = a.tSum / a.hours;
    const cloud = Math.min(1, Math.max(0, a.cloudSum / a.hours / 100));
    const ra = extraterrestrialRadiation(date, lat);
    const et0 = et0PenmanMonteith({
      date,
      latDeg: lat,
      tMax: a.tMax,
      tMin: a.tMin,
      tMean,
      rhMean: a.rhSum / a.hours,
      wind2m: (a.windSum / a.hours) * 0.748,
      rsMj: (0.25 + 0.5 * (1 - cloud)) * ra,
    });
    if (!Number.isFinite(tMean) || et0 === null) continue;
    out.push({
      date,
      precipitationMm: Math.round(a.precip * 10) / 10,
      probabilityPct: null,
      et0Mm: et0,
      tMax: Math.round(a.tMax * 10) / 10,
      tMin: Math.round(a.tMin * 10) / 10,
      past: false,
    });
  }
  return out;
}

function metSource(durationMs: number): SourceInfo {
  return source(
    'Prognoza opadu i temperatury (ET0 liczone w aplikacji)',
    'MET Norway – Locationforecast 2.0 (Norweski Instytut Meteorologiczny), CC BY 4.0',
    'https://api.met.no/weatherapi/locationforecast/2.0/documentation',
    durationMs,
    'ET0 policzone wzorem FAO-56 z temperatury, wilgotności, wiatru i zachmurzenia (promieniowanie szacowane). Prognoza – im dalszy dzień, tym większa niepewność.',
  );
}
