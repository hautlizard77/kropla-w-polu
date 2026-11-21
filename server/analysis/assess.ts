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
  Recommendation,
  RiskLevel,
} from '../../src/types/analysis';
import type { ParcelInfo, SourceInfo } from '../../src/types/terrain';
import type { HydroResult } from '../sources/hydro';
import type { SoilProfile } from '../sources/soil';
import { addDays, type ForecastSeries, type WeatherSeries } from '../sources/weather';
import { FORECAST_MAX_AGE_DAYS, FORECAST_SOURCE_ID, buildForecast, notApplicableForecast, unavailableForecast } from './forecast';
import { CROP_PARAMS, cropDay, type Stage } from '../../src/data/cropParams';
import { readilyAvailableWater, totalAvailableWater } from './waterBalance';

export const ASSESS_VERSION = 2;
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
}

export interface SimDay {
  date: string;
  dr: number;
  etc: number;
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
  input: { cropId: AnalysisRequest['cropId']; horizons: SoilProfile['horizons']; tawScale: number; from: string; to: string; initialDr?: number },
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
    dr = Math.min(taw, Math.max(0, dr - day.precipitationMm + etc));
    out.push({ date: day.date, dr: Math.round(dr * 10) / 10, etc: Math.round(etc * 10) / 10, taw: Math.round(taw * 10) / 10, raw: Math.round(raw * 10) / 10, kc: crop.kc, stage: crop.stage, inSeason: crop.inSeason });
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
    dataSources.push(toDataSource('hydro', 'hydrologia', hydro.source, { license: 'ODbL', details: hydro.message }));
  } else {
    dataSources.push(missingSource('hydro', 'hydrologia', 'Cieki i rowy w pobliżu', hydro?.message ?? 'Brak danych.'));
  }
  dataSources.push({
    id: 'nmt',
    kind: 'teren',
    name: 'Numeryczny Model Terenu',
    provider: 'GUGiK – Geoportal (WCS)',
    url: 'https://www.geoportal.gov.pl',
    license: 'Dane publiczne GUGiK',
    availability: 'available',
    observationDate: null,
    retrievedAt: null,
    coverage: null,
    limitations: [],
    details: 'Pobierany przy otwarciu raportu i pokazywany w zakładce „Teren i spływ 3D”.',
  });

  const base: Omit<AnalysisResult, 'currentState' | 'historicalVulnerability' | 'recommendations' | 'irrigation'> = {
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
    return buildForecast({ request, forecast: input.forecast, evalDate: evalDay, state, horizons: soil?.horizons ?? null, areaHa: parcel.areaHa > 0 ? parcel.areaHa : null });
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
  const runs = [1, 0.75, 1.25].map((scale) => simulate(weather, { cropId: request.cropId, horizons: soil.horizons, tawScale: scale, from, to: evalDate }));
  const [mainRun, lowRun, highRun] = runs as [SimDay[], SimDay[], SimDay[]];
  const today = mainRun[mainRun.length - 1];
  if (!today) {
    return { ...base, currentState: insufficient(request, weatherIndicators), historicalVulnerability: insufficientHistory(), recommendations: [], irrigation: { status: 'not_calculated', note: 'Brak bilansu.' }, forecast: forecastFor(null, evalDate) };
  }
  const level = classify(today.dr, today.taw, today.raw);
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
    `W strefie korzeni (${pl(cropDay(request.cropId, evalDate).zr)} m) uprawa (${cropName}) ma ok. ${mm(today.taw - today.dr)} wody dostępnej dla roślin z ${mm(today.taw)} możliwych (${reservePct}%).`,
    today.dr > today.raw
      ? `Ubytek (${mm(today.dr)}) przekracza próg łatwo dostępnej wody (${mm(today.raw)}) – rośliny mogą ograniczać wzrost.`
      : `Ubytek (${mm(today.dr)}) nie przekracza progu łatwo dostępnej wody (${mm(today.raw)}).`,
  ];
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
    ...weatherIndicators,
  ];

  // Podatność historyczna: 10 poprzednich sezonów.
  const analysisYear = Number(evalDate.slice(0, 4));
  let deficitSeasons = 0;
  let seasonsCounted = 0;
  const monthHits = new Map<number, number>();
  for (let y = analysisYear - 10; y < analysisYear; y += 1) {
    const run = simulate(weather, { cropId: request.cropId, horizons: soil.horizons, tawScale: 1, from: `${y}-03-01`, to: `${y}-${crop.harvest}` });
    if (run.length === 0 || run[run.length - 1]?.date !== `${y}-${crop.harvest}`) continue;
    seasonsCounted += 1;
    const stressDays = run.filter((d) => d.inSeason && d.dr > d.raw);
    if (stressDays.length >= STRESS_DAYS_FOR_DEFICIT_SEASON) deficitSeasons += 1;
    const perMonth = new Map<number, number>();
    for (const d of stressDays) perMonth.set(Number(d.date.slice(5, 7)), (perMonth.get(Number(d.date.slice(5, 7))) ?? 0) + 1);
    for (const [m, n] of perMonth) if (n >= 7) monthHits.set(m, (monthHits.get(m) ?? 0) + 1);
  }
  const criticalMonths = [...monthHits.entries()].filter(([, n]) => seasonsCounted > 0 && n / seasonsCounted >= 0.3).map(([m]) => m).sort((a, b) => a - b);
  const histLevel: RiskLevel = seasonsCounted < 5 ? 'insufficient_data' : deficitSeasons >= 6 ? 'elevated' : deficitSeasons >= 3 ? 'moderate' : 'low';
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
      title: `Sprawdź możliwość spowolnienia odpływu w pobliskim ${w.kind === 'rzeka' || w.kind === 'strumień' ? 'cieku' : 'rowie'}`,
      action:
        w.kind === 'rów' || w.kind === 'rów odwadniający'
          ? 'Rozważ zastawkę lub próg na rowie i spiętrzanie wody wczesną wiosną, zanim odpłyną wody roztopowe.'
          : 'Rozważ działania spowalniające odpływ (np. pas zadrzewień lub zadarnienia przy cieku); budowle na cieku wymagają zgody Wód Polskich.',
      rationale: `${w.distanceM === 0 ? 'Przez działkę przebiega' : `W odległości ok. ${w.distanceM} m od działki przebiega`} ${w.kind}${w.name ? ` (${w.name})` : ''}. ${
        deficitSeasons > 0 ? `W ${deficitSeasons} z ${seasonsCounted} ostatnich sezonów uprawie brakowało wody.` : ''
      }`,
      evidenceSourceIds: ['hydro', 'pogoda0'],
      fieldChecks: [
        'Kto jest właścicielem i zarządcą rowu lub cieku (spółka wodna, gmina, Wody Polskie)?',
        'Czy potrzebne jest zgłoszenie wodnoprawne lub pozwolenie?',
        'Czy spiętrzenie nie podtopi sąsiednich działek, dróg ani drenażu?',
        'Dane o rowach pochodzą z OpenStreetMap – potwierdź przebieg w terenie.',
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
      }`,
      evidenceSourceIds: ['pogoda0', 'gleba'],
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

function insufficient(request: AnalysisRequest, indicators: Indicator[]) {
  return {
    asOf: request.analysisDate,
    level: 'insufficient_data' as const,
    headline: 'Za mało danych do oceny stresu wodnego',
    summary: 'Nie udało się policzyć bilansu wody.',
    indicators,
  };
}

function insufficientHistory() {
  return { level: 'insufficient_data' as const, headline: 'Za mało danych', summary: 'Brak danych.', period: null, criticalMonths: [], indicators: [] };
}
