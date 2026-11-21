/**
 * Bilans wody na najbliższe dni i plan działań dla wybranej uprawy.
 *
 * Z prognozy (Open-Meteo: opad, ET0, temperatura) liczymy dalszy ciąg bilansu FAO-56 od stanu na dzień analizy:
 * ile wody uprawa potrzebuje (ETc = Kc · ET0), ile spadnie, ile z tego zostanie w strefie korzeni, a ile przepadnie
 * (nadmiar ponad pojemność gleby), jaki będzie zapas na koniec okresu i ile dni uprawa spędzi w stresie.
 * Osobno symulujemy wariant z nawadnianiem: dawka, gdy zapas spada poniżej progu stresu, chyba że w ciągu 2 dni
 * spadnie wystarczająco dużo deszczu. Z tego powstaje plan nawadniania (mm, m³/ha, m³ na działkę) i lista kroków.
 *
 * Progi reguł: silny opad ≥ 20 mm/dobę, przymrozek Tmin ≤ 0 °C (młode fazy), upał Tmax ≥ 30 °C,
 * dawka nawadniania 10–30 mm (więcej woda przesiąka poniżej korzeni), co najmniej 3 dni między dawkami.
 */
import { cropLabel, getCrop } from '../../src/data/crops';
import { CROP_PARAMS, cropDay, type Stage } from '../../src/data/cropParams';
import type { AnalysisRequest, ForecastBalance, ForecastStep, IrrigationEvent, IrrigationPlan, WaterForecast } from '../../src/types/analysis';
import type { SoilProfile } from '../sources/soil';
import type { ForecastDayRaw, ForecastSeries } from '../sources/weather';
import { classify, type SimDay } from './assess';
import { readilyAvailableWater, totalAvailableWater } from './waterBalance';

export const FORECAST_SOURCE_ID = 'prognoza';
/** Bilans pokazujemy, gdy data analizy to dziś albo jeden z 3 ostatnich dni. */
export const FORECAST_MAX_AGE_DAYS = 3;
const BALANCE_DAYS = 7;
const HEAVY_RAIN_MM = 20;
const MIN_DOSE_MM = 10;
const MAX_DOSE_MM = 30;
/** Najkrótszy odstęp między dawkami – woda musi wsiąknąć, a pole musi być dostępne dla sprzętu. */
const MIN_INTERVAL_DAYS = 3;
const MONTHS_NOM = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const WEEKDAYS = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
const IRRIGATED_GROUPS = new Set(['warzywa', 'okopowe', 'owoce']);

/** Krótka data: „pt. 27.11”. */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

const r = (v: number) => Math.round(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const m3 = (mm: number) => r(mm * 10);
const fmt = (v: number) => v.toLocaleString('pl-PL');

export function notApplicableForecast(message: string): WaterForecast {
  return { status: 'not_applicable', message, issuedAt: null, balance: null, irrigationPlan: null, steps: [], sourceId: null };
}

export function unavailableForecast(message: string): WaterForecast {
  return { status: 'unavailable', message, issuedAt: null, balance: null, irrigationPlan: null, steps: [], sourceId: null };
}

export interface ForecastInput {
  request: AnalysisRequest;
  forecast: ForecastSeries;
  /** Dzień, na który policzono bilans (może być wcześniejszy od daty analizy, gdy brak najnowszych danych). */
  evalDate: string;
  /** Stan na dzień oceny; null – bez bilansu (brak gleby lub pogody). */
  state: SimDay | null;
  horizons: SoilProfile['horizons'] | null;
  areaHa: number | null;
}

interface DayRun {
  date: string;
  past: boolean;
  rain: number;
  et0: number;
  tMin: number | null;
  tMax: number | null;
  stage: Stage;
  inSeason: boolean;
  taw: number;
  raw: number;
  /** ETc bez niedoboru i rzeczywiste (z Ks). */
  etcPotential: number;
  etcActual: number;
  rainUsed: number;
  rainLost: number;
  irrigation: number;
  /** Ubytek na koniec dnia. */
  dr: number;
}

/** Dzienny bilans od ubytku dr0; z nawadnianiem – dawka rano, gdy zapas jest poniżej progu, a deszcz go nie uzupełni. */
function runDays(cropId: AnalysisRequest['cropId'], horizons: SoilProfile['horizons'], dr0: number, days: ForecastDayRaw[], irrigate: boolean): DayRun[] {
  const p = CROP_PARAMS[cropId].p;
  const tawCache = new Map<number, number>();
  const tawFor = (zr: number) => {
    const key = Math.round(zr * 20) / 20;
    if (!tawCache.has(key)) tawCache.set(key, totalAvailableWater(horizons, key).tawMm ?? 0);
    return tawCache.get(key)!;
  };
  const out: DayRun[] = [];
  let dr = dr0;
  let lastIrrigation = -Infinity;
  days.forEach((day, i) => {
    const crop = cropDay(cropId, day.date);
    const taw = tawFor(crop.zr);
    const raw = readilyAvailableWater(taw, p);
    dr = Math.min(dr, taw);
    const rain = day.precipitationMm ?? 0;
    const et0 = day.et0Mm ?? 0;
    let irrigation = 0;
    if (irrigate && !day.past && crop.inSeason && dr > raw && i - lastIrrigation >= MIN_INTERVAL_DAYS) {
      const rainSoon = days.slice(i, i + 2).reduce((s, d) => s + (d.precipitationMm ?? 0), 0);
      if (rainSoon < dr - raw) {
        irrigation = Math.max(MIN_DOSE_MM, Math.min(MAX_DOSE_MM, r(dr)));
        dr = Math.max(0, dr - irrigation);
        lastIrrigation = i;
      }
    }
    const ks = dr <= raw ? 1 : Math.max(0, (taw - dr) / Math.max(1e-6, taw - raw));
    const etcPotential = crop.kc * et0;
    const etcActual = etcPotential * ks;
    const before = dr + etcActual;
    const rainUsed = Math.min(rain, before);
    dr = Math.min(taw, Math.max(0, before - rain));
    out.push({
      date: day.date,
      past: day.past,
      rain,
      et0,
      tMin: day.tMin,
      tMax: day.tMax,
      stage: crop.stage,
      inSeason: crop.inSeason,
      taw,
      raw,
      etcPotential,
      etcActual,
      rainUsed,
      rainLost: rain - rainUsed,
      irrigation,
      dr,
    });
  });
  return out;
}

export function buildForecast(input: ForecastInput): WaterForecast {
  const { request, forecast, evalDate, state, horizons, areaHa } = input;
  const raw = forecast.days.filter((d) => d.date > evalDate && d.precipitationMm !== null && d.et0Mm !== null);
  const futureRaw = raw.filter((d) => !d.past);
  if (futureRaw.length === 0) return unavailableForecast('Prognoza nie obejmuje dni po dacie analizy.');
  const issuedAt = forecast.issuedAt;

  if (!state || !horizons) {
    const rain = r(futureRaw.slice(0, BALANCE_DAYS).reduce((s, d) => s + (d.precipitationMm ?? 0), 0));
    return {
      status: 'ok',
      message: 'Bez danych o glebie nie da się policzyć bilansu wody – podajemy tylko prognozowany opad.',
      issuedAt,
      balance: null,
      irrigationPlan: null,
      steps: [
        {
          id: 'opady',
          when: `Do ${shortDate(futureRaw[Math.min(BALANCE_DAYS, futureRaw.length) - 1]!.date)}`,
          tone: 'info',
          title: `Prognozowany opad: ok. ${rain} mm w ${Math.min(BALANCE_DAYS, futureRaw.length)} dni`,
          text: 'Bez danych o glebie nie oceniamy, czy ta ilość wystarczy uprawie. Sprawdź wilgotność gleby w terenie (próba na kulkę z ziemi z głębokości 20–30 cm).',
        },
      ],
      sourceId: FORECAST_SOURCE_ID,
    };
  }

  // Dni, które już minęły (brak ich w archiwum), przesuwają stan do „dziś” – bez nawadniania.
  const dry = runDays(request.cropId, horizons, state.dr, raw, false);
  const withIrrigation = runDays(request.cropId, horizons, state.dr, raw, true);
  const future = dry.filter((d) => !d.past);
  const pastRuns = dry.filter((d) => d.past);
  const startDr = pastRuns.length > 0 ? pastRuns[pastRuns.length - 1]!.dr : state.dr;
  const startTaw = future[0]!.taw;
  const startRaw = future[0]!.raw;
  const window = future.slice(0, BALANCE_DAYS);
  const end = window[window.length - 1]!;
  const sum = (f: (d: DayRun) => number) => window.reduce((s, d) => s + f(d), 0);

  const balance: ForecastBalance = {
    horizonDays: window.length,
    from: window[0]!.date,
    to: end.date,
    startReserveMm: r(Math.max(0, startTaw - startDr)),
    startReservePct: r((100 * Math.max(0, startTaw - startDr)) / Math.max(1, startTaw)),
    fullReserveMm: r(startTaw),
    stressThresholdPct: r((100 * (startTaw - startRaw)) / Math.max(1, startTaw)),
    needMm: r(sum((d) => d.etcPotential)),
    rainMm: r(sum((d) => d.rain)),
    rainUsedMm: r(sum((d) => d.rainUsed)),
    rainLostMm: r(sum((d) => d.rainLost)),
    endReserveMm: r(end.taw - end.dr),
    endReservePct: r((100 * (end.taw - end.dr)) / Math.max(1, end.taw)),
    endLevel: classify(end.dr, end.taw, end.raw),
    stressDays: window.filter((d) => d.inSeason && d.dr > d.raw).length,
  };

  const crop = getCrop(request.cropId);
  const typicallyIrrigated = crop ? IRRIGATED_GROUPS.has(crop.group) : false;
  const events: IrrigationEvent[] = withIrrigation
    .filter((d) => d.irrigation > 0)
    .map((d) => ({ date: d.date, doseMm: d.irrigation, m3PerHa: m3(d.irrigation), m3Parcel: areaHa ? r(m3(d.irrigation) * areaHa) : null }));
  const totalMm = events.reduce((s, e) => s + e.doseMm, 0);
  const irrigationPlan: IrrigationPlan = {
    events,
    totalMm,
    totalM3PerHa: m3(totalMm),
    totalM3Parcel: areaHa ? r(m3(totalMm) * areaHa) : null,
    typicallyIrrigated,
    horizonDays: future.length,
  };

  const steps = buildSteps({ request, future, startDr, startRaw, balance, plan: irrigationPlan, areaHa });

  return {
    status: 'ok',
    message:
      `Bilans na ${balance.horizonDays} dni (${shortDate(balance.from)} – ${shortDate(balance.to)}), plan nawadniania na ${future.length} dni.` +
      (pastRuns.length > 0 ? ` Uwzględniono też ${pastRuns.length} ostatnie dni, których nie ma jeszcze w archiwum pogody.` : ''),
    issuedAt,
    balance,
    irrigationPlan,
    steps,
    sourceId: FORECAST_SOURCE_ID,
  };
}

function buildSteps(ctx: {
  request: AnalysisRequest;
  future: DayRun[];
  startDr: number;
  startRaw: number;
  balance: ForecastBalance;
  plan: IrrigationPlan;
  areaHa: number | null;
}): ForecastStep[] {
  const { request, future, startDr, startRaw, balance, plan, areaHa } = ctx;
  const crop = getCrop(request.cropId);
  const name = cropLabel(request.cropId).toLowerCase();
  const first = future[0]!;
  const inSeason = first.inSeason;
  const steps: ForecastStep[] = [];
  const heavy = future.find((d) => d.rain >= HEAVY_RAIN_MM);
  const frost = future.slice(0, 7).find((d) => d.tMin !== null && d.tMin <= 0);
  const heat = future.slice(0, 7).filter((d) => d.tMax !== null && d.tMax >= 30);
  const month = Number(first.date.slice(5, 7));
  const stressedNow = inSeason && startDr > startRaw;
  const stressStart = stressedNow ? null : future.find((d) => d.inSeason && d.dr > d.raw) ?? null;
  const parcelM3 = (mm: number) => (areaHa ? `, czyli ok. ${fmt(r(m3(mm) * areaHa))} m³ na całą działkę (${fmt(r1(areaHa))} ha)` : '');

  // 1. Główny krok: co z wodą dla tej uprawy.
  if (!inSeason) {
    steps.push({
      id: 'poza-sezonem',
      when: 'Teraz',
      tone: balance.rainMm >= 10 ? 'good' : 'info',
      title: balance.rainMm >= 10 ? 'Zatrzymaj wodę z opadów na następny sezon' : `Poza sezonem uprawy (${name}) – zadbaj o zapas na wiosnę`,
      text:
        `W ciągu ${balance.horizonDays} dni spadnie ok. ${balance.rainMm} mm, z czego ok. ${balance.rainUsedMm} mm uzupełni glebę. ` +
        'Zostaw resztki pożniwne albo międzyplon i nie zostawiaj gleby gołej na zimę – okrywa zatrzymuje wodę i chroni przed erozją.',
    });
  } else if (plan.events.length === 0) {
    steps.push({
      id: stressedNow ? 'deszcz-wystarczy' : 'zapas-wystarczy',
      when: 'Ten tydzień',
      tone: 'good',
      title: stressedNow ? 'Nie nawadniaj – deszcz uzupełni wodę' : 'Nawadnianie nie jest potrzebne',
      text: stressedNow
        ? `Uprawa jest teraz w stresie, ale prognozowany deszcz (${balance.rainMm} mm) wyprowadzi zapas powyżej progu. Nawadnianie tuż przed deszczem marnuje wodę (odpływ, wymywanie azotu).`
        : `Opad (${balance.rainMm} mm) i zapas w glebie (${balance.startReserveMm} mm) pokryją potrzeby uprawy (${balance.needMm} mm). Na koniec okresu zapas: ${balance.endReservePct}%.`,
    });
  } else {
    const e0 = plan.events[0]!;
    const later = plan.events.slice(1).map((e) => `${shortDate(e.date)} – ${e.doseMm} mm`).join(', ');
    const waitForRain = stressedNow && e0.date !== first.date;
    steps.push({
      id: 'nawadnianie',
      when: e0.date === first.date ? 'Teraz' : shortDate(e0.date),
      tone: 'warning',
      title: plan.typicallyIrrigated
        ? `Nawodnij: ${e0.doseMm} mm (${fmt(e0.m3PerHa)} m³/ha)`
        : `Jeśli masz deszczownię: ${e0.doseMm} mm (${fmt(e0.m3PerHa)} m³/ha)`,
      text:
        (waitForRain ? 'Do tego dnia wstrzymaj się – wcześniej spadnie deszcz. ' : '') +
        `To ${fmt(e0.m3PerHa)} m³ wody na hektar${parcelM3(e0.doseMm)}. Podawaj rano lub wieczorem.` +
        (later ? ' Kolejne dawki – w tabeli „Plan nawadniania” poniżej.' : ''),
    });
    if (!plan.typicallyIrrigated) {
      steps.push({
        id: 'bez-deszczowni',
        when: 'Ten tydzień',
        tone: 'info',
        title: 'Bez nawadniania – ogranicz straty wody',
        text: `${cropLabel(request.cropId)} rzadko się nawadnia. Bez deszczowni: nie spulchniaj teraz gleby (każdy zabieg przesusza wierzchnią warstwę) i odłóż pogłówne nawożenie azotem do deszczu – w suchej glebie słabo działa.`,
      });
    }
  }

  if (stressStart && plan.events.length > 0 && stressStart.date !== plan.events[0]!.date) {
    steps.push({
      id: 'stres-od',
      when: `Od ${shortDate(stressStart.date)}`,
      tone: 'info',
      title: 'Od tego dnia zacznie brakować wody',
      text: `Bez nawadniania zapas spadnie poniżej progu stresu (${balance.stressThresholdPct}% pełnego zapasu) – ${name} zacznie ograniczać wzrost.`,
    });
  }

  // 2. Ulewa.
  if (heavy) {
    steps.push({
      id: 'ulewa',
      when: shortDate(heavy.date),
      tone: 'warning',
      title: `Silny opad: ok. ${r(heavy.rain)} mm – bez oprysków i nawożenia`,
      text:
        'Przesuń opryski i nawożenie na po deszczu – inaczej zostaną zmyte. ' +
        (heavy.rainLost > 1 ? `Gleba przyjmie tylko część opadu – ok. ${r(heavy.rainLost)} mm przesiąknie głębiej lub spłynie. ` : '') +
        'Jeśli jest rów z zastawką albo zagłębienie, w którym zbiera się woda, zatrzymaj w nim wodę (zakładka „Teren i spływ 3D” pokazuje, gdzie spływa).',
    });
  }

  // 3. Okres krytyczny uprawy.
  if (inSeason && crop?.criticalMonths.includes(month) && (stressedNow || stressStart || plan.events.length > 0)) {
    steps.push({
      id: 'okres-krytyczny',
      when: MONTHS_NOM[month - 1]!,
      tone: 'info',
      title: 'Okres największej wrażliwości uprawy',
      text: 'Niedobór wody w tym miesiącu najmocniej obniża plon – jeśli wody jest mało, przeznacz ją tej uprawie w pierwszej kolejności.',
    });
  }

  // 4. Przymrozek i upał.
  if (frost && inSeason && (first.stage === 'poczatkowa' || first.stage === 'rozwoju')) {
    steps.push({
      id: 'przymrozek',
      when: shortDate(frost.date),
      tone: 'warning',
      title: `Możliwy przymrozek (${frost.tMin} °C)`,
      text:
        `Młode rośliny (${name}) są wrażliwe – obejrzyj plantację po tej nocy.` +
        (crop?.group === 'owoce' ? ' W sadach i na truskawkach stosuje się osłony (agrowłóknina) lub zraszanie przeciwprzymrozkowe.' : ''),
    });
  } else if (frost && !inSeason) {
    steps.push({
      id: 'mroz',
      when: shortDate(frost.date),
      tone: 'info',
      title: `Mróz (${frost.tMin} °C) – bez zabiegów na zamarzniętej glebie`,
      text: 'Wjazd na zamarzniętą lub rozmarzającą glebę ją ugniata i pogarsza wsiąkanie wody.',
    });
  }
  if (inSeason && heat.length > 0) {
    const hottest = heat.reduce((a, b) => ((b.tMax ?? 0) > (a.tMax ?? 0) ? b : a));
    steps.push({
      id: 'upal',
      when: shortDate(hottest.date),
      tone: 'info',
      title: `Upał (${hottest.tMax} °C) – uprawa zużyje ok. ${fmt(r1(hottest.etcPotential))} mm wody`,
      text: 'W upalne dni nie nawadniaj w południe – dużo wody odparowuje. Najlepiej wcześnie rano.',
    });
  }

  return orderSteps(steps, first.date, future);
}

/** Kolejność kroków: według dnia, którego dotyczą; kroki ogólne („Teraz”, „Ten tydzień”) na początku, miesiąc na końcu. */
function orderSteps(steps: ForecastStep[], firstDate: string, future: DayRun[]): ForecastStep[] {
  const dateOf = (step: ForecastStep): string => {
    if (step.when === 'Teraz' || step.when === 'Ten tydzień') return firstDate;
    const match = future.find((d) => step.when.endsWith(shortDate(d.date)));
    return match ? match.date : '9999-12-31';
  };
  return steps
    .map((step, index) => ({ step, index, date: dateOf(step) }))
    .sort((a, b) => (a.date === b.date ? a.index - b.index : a.date < b.date ? -1 : 1))
    .map((x) => x.step);
}
