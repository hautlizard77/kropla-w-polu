/**
 * Prognoza na najbliższe dni: opad i ET0 z Open-Meteo, a z nich – dalszy ciąg bilansu wody w strefie korzeni
 * od stanu na dzień analizy. Na tej podstawie wskazówki, jak postępować z wybraną uprawą.
 *
 * Reguły są proste i jawne (każda wskazówka podaje liczby, z których wynika). Progi:
 * - ulewa: ≥ 20 mm/dobę (silny opad – ryzyko spływu i erozji), opad znaczący: ≥ 10 mm w 3 dni,
 * - przymrozek: Tmin ≤ 0 °C w sezonie, upał: Tmax ≥ 30 °C.
 */
import { cropLabel, getCrop } from '../../src/data/crops';
import { STAGE_LABELS } from '../../src/data/cropParams';
import type { AnalysisRequest, ForecastAdvice, ForecastDay, RiskLevel, WaterForecast } from '../../src/types/analysis';
import type { SoilProfile } from '../sources/soil';
import type { ForecastSeries, WeatherSeries } from '../sources/weather';
import { classify, simulate, type SimDay } from './assess';

export const FORECAST_SOURCE_ID = 'prognoza';
/** Prognozę pokazujemy, gdy data analizy to dziś albo jeden z 3 ostatnich dni. */
export const FORECAST_MAX_AGE_DAYS = 3;
const HEAVY_RAIN_MM = 20;
const MAX_DOSE_MM = 30;
const MONTHS_NOM = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const WEEKDAYS = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];

/** Krótka data: „pt. 27.11”. */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

const r = (v: number) => Math.round(v);
const sum = (values: (number | null)[]) => values.reduce<number>((a, b) => a + (b ?? 0), 0);

export function notApplicableForecast(message: string): WaterForecast {
  return { status: 'not_applicable', message, issuedAt: null, stressThresholdPct: null, days: [], advice: [], totals: null, sourceId: null };
}

export function unavailableForecast(message: string): WaterForecast {
  return { status: 'unavailable', message, issuedAt: null, stressThresholdPct: null, days: [], advice: [], totals: null, sourceId: null };
}

export interface ForecastInput {
  request: AnalysisRequest;
  forecast: ForecastSeries;
  /** Dzień, na który policzono bilans (może być wcześniejszy od daty analizy, gdy brak najnowszych danych). */
  evalDate: string;
  /** Stan na dzień oceny; null – bez bilansu (brak gleby lub pogody), wtedy pokazujemy samą prognozę. */
  state: SimDay | null;
  horizons: SoilProfile['horizons'] | null;
}

export function buildForecast(input: ForecastInput): WaterForecast {
  const { request, forecast, evalDate, state, horizons } = input;
  const raw = forecast.days.filter((d) => d.date > evalDate);
  if (raw.length === 0) return unavailableForecast('Prognoza nie obejmuje dni po dacie analizy.');

  // Dalszy ciąg bilansu od stanu na dzień oceny.
  let projection: SimDay[] = [];
  if (state && horizons) {
    const series: WeatherSeries = {
      days: raw.map((d) => ({ date: d.date, precipitationMm: d.precipitationMm, et0Mm: d.et0Mm, source: 'open-meteo-forecast' as const })),
      sources: [],
      lastCompleteDate: null,
      notes: [],
    };
    projection = simulate(series, {
      cropId: request.cropId,
      horizons,
      tawScale: 1,
      from: raw[0]!.date,
      to: raw[raw.length - 1]!.date,
      initialDr: state.dr,
    });
  }
  const byDate = new Map(projection.map((p) => [p.date, p]));

  const days: ForecastDay[] = raw.map((d) => {
    const p = byDate.get(d.date);
    return {
      date: d.date,
      past: d.past,
      precipitationMm: d.precipitationMm === null ? null : Math.round(d.precipitationMm * 10) / 10,
      probabilityPct: d.probabilityPct,
      et0Mm: d.et0Mm === null ? null : Math.round(d.et0Mm * 10) / 10,
      etcMm: p ? p.etc : null,
      tMax: d.tMax === null ? null : Math.round(d.tMax),
      tMin: d.tMin === null ? null : Math.round(d.tMin),
      reservePct: p ? r((100 * (p.taw - p.dr)) / Math.max(1, p.taw)) : null,
      level: (p ? classify(p.dr, p.taw, p.raw) : 'insufficient_data') as RiskLevel,
    };
  });

  const future = days.filter((d) => !d.past);
  const next = (n: number) => future.slice(0, n);
  const totals = {
    rain3: r(sum(next(3).map((d) => d.precipitationMm))),
    rain7: r(sum(next(7).map((d) => d.precipitationMm))),
    rain10: r(sum(future.map((d) => d.precipitationMm))),
    etc7: r(sum(next(7).map((d) => d.etcMm))),
  };

  const advice = buildAdvice({ request, state, projection, days, future, totals });
  const stressThresholdPct = state ? r((100 * (state.taw - state.raw)) / Math.max(1, state.taw)) : null;
  const pastCount = days.length - future.length;

  return {
    status: 'ok',
    message:
      `Prognoza na ${future.length} dni od ${shortDate(future[0]?.date ?? raw[0]!.date)}` +
      (pastCount > 0 ? `, poprzedzona ${pastCount} ostatnimi dniami (dane modelowe), których nie było jeszcze w archiwum.` : '.') +
      (state ? '' : ' Bez danych o glebie nie liczymy zapasu wody – pokazujemy samą pogodę.'),
    issuedAt: forecast.issuedAt,
    stressThresholdPct,
    days,
    advice,
    totals,
    sourceId: FORECAST_SOURCE_ID,
  };
}

const IRRIGATED_GROUPS = new Set(['warzywa', 'okopowe', 'owoce']);

function buildAdvice(ctx: Parameters<typeof buildAdviceInner>[0]): ForecastAdvice[] {
  const { main, heavy } = buildAdviceInner(ctx);
  return main.length > 0 ? [main[0]!, ...heavy, ...main.slice(1)] : heavy;
}

function buildAdviceInner(ctx: {
  request: AnalysisRequest;
  state: SimDay | null;
  projection: SimDay[];
  days: ForecastDay[];
  future: ForecastDay[];
  totals: { rain3: number; rain7: number; rain10: number; etc7: number };
}): { main: ForecastAdvice[]; heavy: ForecastAdvice[] } {
  const { request, state, projection, future, totals } = ctx;
  const crop = getCrop(request.cropId);
  const name = cropLabel(request.cropId).toLowerCase();
  const advice: ForecastAdvice[] = [];
  const first = future[0];
  if (!first) return { main: advice, heavy: [] };

  const heavy = future.filter((d) => (d.precipitationMm ?? 0) >= HEAVY_RAIN_MM);
  const frost = future.slice(0, 7).find((d) => d.tMin !== null && d.tMin <= 0);
  const heat = future.slice(0, 7).filter((d) => d.tMax !== null && d.tMax >= 30);
  const inSeason = state?.inSeason ?? false;
  const irrigatedTypically = crop ? IRRIGATED_GROUPS.has(crop.group) : false;
  const month = Number(first.date.slice(5, 7));
  const criticalNow = crop?.criticalMonths.includes(month) ?? false;
  const rainWhen = (n: number) => {
    const wet = future.slice(0, n).filter((d) => (d.precipitationMm ?? 0) >= 2);
    return wet.length > 0 ? wet.map((d) => `${shortDate(d.date)} – ${r(d.precipitationMm ?? 0)} mm`).join(', ') : 'brak dni z opadem powyżej 2 mm';
  };

  // Ulewa – niezależnie od sezonu; wstawiana zaraz po głównej wskazówce dla uprawy.
  const heavyAdvice: ForecastAdvice[] = [];
  if (heavy.length > 0) {
    const d = heavy[0]!;
    heavyAdvice.push({
      id: 'ulewa',
      tone: 'warning',
      title: `Silny opad ${shortDate(d.date)}: ok. ${r(d.precipitationMm ?? 0)} mm`,
      text:
        'Nie planuj na ten czas oprysków ani nawożenia – deszcz zmyje środki i nawóz. Na stokach i gołej glebie rośnie ryzyko spływu i erozji. ' +
        'Jeśli na działce lub obok jest rów z zastawką albo zagłębienie, w którym zbiera się woda, wykorzystaj je, żeby zatrzymać wodę na polu ' +
        '(gdzie spływa woda, pokazuje zakładka „Teren i spływ 3D”).',
    });
  }

  if (!state) {
    advice.push({
      id: 'opady',
      tone: 'info',
      title: `W ciągu 7 dni ok. ${totals.rain7} mm deszczu`,
      text: `Dni z opadem: ${rainWhen(7)}. Bez danych o glebie nie oceniamy, czy ta ilość wystarczy uprawie.`,
    });
    return { main: advice, heavy: heavyAdvice };
  }

  if (!inSeason) {
    advice.push({
      id: 'poza-sezonem',
      tone: totals.rain7 >= 10 ? 'good' : 'info',
      title: totals.rain7 >= 10 ? 'Opady uzupełnią zapas wody w glebie' : `Poza sezonem uprawy (${name})`,
      text:
        `W ciągu 7 dni prognozowane ok. ${totals.rain7} mm (${rainWhen(7)}). Zapas wody w glebie: ${ctx.days[0]?.reservePct ?? '–'}%. ` +
        'Teraz najważniejsze jest zatrzymanie wody na następny sezon: zostaw resztki pożniwne albo międzyplon i nie pozostawiaj gleby gołej na zimę.',
    });
    if (frost) {
      advice.push({ id: 'mroz', tone: 'info', title: `Mróz ${shortDate(frost.date)} (${frost.tMin} °C)`, text: 'Nie wykonuj zabiegów na zamarzniętej glebie – ugniatasz ją i pogarszasz wsiąkanie wody.' });
    }
    return { main: advice, heavy: heavyAdvice };
  }

  const deficitNow = Math.max(0, state.dr - state.raw);
  const stressedNow = state.dr > state.raw;
  const byDate = new Map(projection.map((p) => [p.date, p]));
  const futureProj = future.map((d) => byDate.get(d.date)).filter((p): p is SimDay => Boolean(p));
  const stressStart = stressedNow ? null : futureProj.find((p) => p.dr > p.raw) ?? null;
  const lowest = futureProj.reduce<SimDay | null>((m, p) => (m === null || p.taw - p.dr < m.taw - m.dr ? p : m), null);
  const lowestPct = lowest ? r((100 * (lowest.taw - lowest.dr)) / Math.max(1, lowest.taw)) : null;
  const doseFor = (p: SimDay) => Math.min(MAX_DOSE_MM, r(p.dr));
  const stageText = STAGE_LABELS[state.stage];
  /** Po odbudowie zapasu przez deszcz – czy niedobór wróci jeszcze w okresie prognozy. */
  const relapseText = () => {
    const recovered = futureProj.findIndex((p) => p.dr <= p.raw);
    if (recovered < 0) return '';
    const back = futureProj.slice(recovered).find((p) => p.dr > p.raw);
    return back ? ` Uwaga: bez kolejnych opadów zapas znów spadnie poniżej progu stresu ok. ${shortDate(back.date)} – wtedy wróć do nawadniania.` : '';
  };

  if (stressedNow) {
    if (totals.rain3 >= 10 && totals.rain3 >= 0.8 * deficitNow) {
      advice.push({
        id: 'wstrzymaj-nawadnianie',
        tone: 'good',
        title: 'Wstrzymaj się z nawadnianiem – deszcz uzupełni wodę',
        text:
          `W ciągu 3 dni prognozowane ok. ${totals.rain3} mm (${rainWhen(3)}), a do wyjścia ze stresu brakuje ok. ${r(deficitNow)} mm. ` +
          'Nawadnianie tuż przed deszczem zwykle się marnuje (odpływ, wymywanie azotu). Sprawdź wilgotność gleby po opadach.' +
          relapseText(),
      });
    } else if (totals.rain7 < 10) {
      const last = futureProj[Math.min(6, futureProj.length - 1)];
      advice.push({
        id: 'susza-trwa',
        tone: 'warning',
        title: `Niedobór wody się pogłębi – ${name} jest w stresie`,
        text:
          `W 7 dni spadnie tylko ok. ${totals.rain7} mm, a uprawa zużyje ok. ${totals.etc7} mm. ` +
          (last ? `Zapas wody spadnie do ok. ${r((100 * (last.taw - last.dr)) / Math.max(1, last.taw))}% (${shortDate(last.date)}). ` : '') +
          (irrigatedTypically
            ? `Jeśli masz możliwość nawadniania, nie czekaj na deszcz: podaj do ${doseFor(state)} mm jednorazowo, rano lub wieczorem, i powtórz po kilku dniach według stanu gleby.`
            : `Jeśli masz deszczownię, nawadnianie dawką do ${doseFor(state)} mm jest uzasadnione. Bez niej ogranicz straty wody: nie spulchniaj teraz gleby i odłóż pogłówne nawożenie azotem do deszczu – w suchej glebie słabo działa.`),
      });
    } else {
      advice.push({
        id: 'deszcz-czesciowo',
        tone: 'info',
        title: 'Deszcz tylko częściowo złagodzi niedobór',
        text:
          `W 7 dni prognozowane ok. ${totals.rain7} mm (${rainWhen(7)}) wobec zużycia ok. ${totals.etc7} mm przez uprawę` +
          (lowestPct !== null ? `; zapas wody najniżej ok. ${lowestPct}%` : '') +
          '. ' +
          (irrigatedTypically
            ? 'Nawadniaj tylko wtedy, gdy deszcz nie spadnie w zapowiadanym terminie – sprawdź prognozę ponownie jutro.'
            : 'Odłóż zabiegi uprawowe do opadów i sprawdź prognozę ponownie jutro.'),
      });
    }
  } else if (stressStart) {
    const daysAhead = Math.round((Date.parse(stressStart.date) - Date.parse(first.date)) / 86400000) + 1;
    advice.push({
      id: 'stres-wkrotce',
      tone: 'warning',
      title: `Za ok. ${daysAhead} ${daysAhead === 1 ? 'dzień' : 'dni'} zacznie brakować wody`,
      text:
        `Od ${shortDate(stressStart.date)} zapas wody spadnie poniżej progu, przy którym ${name} ogranicza wzrost. ` +
        `Prognozowany opad do tego dnia: ${r(sum(future.filter((d) => d.date <= stressStart.date).map((d) => d.precipitationMm)))} mm, zużycie wody przez uprawę ok. ${r(sum(future.filter((d) => d.date <= stressStart.date).map((d) => d.etcMm)))} mm. ` +
        (irrigatedTypically
          ? `Przygotuj nawadnianie od ok. ${shortDate(stressStart.date)} (dawka do ${doseFor(stressStart)} mm).`
          : 'Zaplanuj zabiegi tak, żeby nie przesuszać gleby (bez głębokiego spulchniania), a nawożenie pogłówne – przed zapowiadanym deszczem, nie w suszy.'),
    });
  } else {
    advice.push({
      id: 'zapas-wystarczy',
      tone: 'good',
      title: 'Zapas wody wystarczy na najbliższe dni',
      text:
        `Przy prognozowanych ok. ${totals.rain7} mm deszczu w 7 dni i zużyciu ok. ${totals.etc7} mm przez uprawę zapas nie spadnie poniżej progu stresu` +
        (lowestPct !== null ? ` (najniżej ok. ${lowestPct}%)` : '') +
        '. Nawadnianie nie jest potrzebne.',
    });
  }

  if (criticalNow && (stressedNow || stressStart)) {
    advice.push({
      id: 'okres-krytyczny',
      tone: 'info',
      title: `${MONTHS_NOM[month - 1]} to okres największej wrażliwości uprawy`,
      text: `Uprawa: ${name}, ${stageText}. Niedobór wody w tym okresie najmocniej obniża plon – jeśli wody do nawadniania jest mało, tej uprawie warto ją przeznaczyć w pierwszej kolejności.`,
    });
  }

  if (frost && (state.stage === 'poczatkowa' || state.stage === 'rozwoju')) {
    advice.push({
      id: 'przymrozek',
      tone: 'warning',
      title: `Możliwy przymrozek ${shortDate(frost.date)} (${frost.tMin} °C)`,
      text:
        `Młode rośliny (${name}) są wrażliwe na przymrozki – obejrzyj plantację po tej nocy.` +
        (crop?.group === 'owoce' ? ' W sadach i na truskawkach stosuje się osłony (agrowłóknina) lub zraszanie przeciwprzymrozkowe.' : ''),
    });
  }

  if (heat.length > 0) {
    const hottest = heat.reduce((a, b) => ((b.tMax ?? 0) > (a.tMax ?? 0) ? b : a));
    advice.push({
      id: 'upal',
      tone: 'info',
      title: `Upał ${shortDate(hottest.date)} (${hottest.tMax} °C) – większe zużycie wody`,
      text: `W upalne dni uprawa zużywa nawet ${r(hottest.etcMm ?? 0)} mm wody dziennie. Jeśli nawadniasz, rób to rano lub wieczorem – w południe dużo wody odparowuje.`,
    });
  }

  return { main: advice, heavy: heavyAdvice };
}

