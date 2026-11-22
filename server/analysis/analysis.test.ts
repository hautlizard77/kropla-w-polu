import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ParcelInfo } from '../../src/types/terrain';
import type { SoilProfile } from '../sources/soil';
import { saxtonRawls } from '../sources/soil';
import { addDays, dateRange, et0PenmanMonteith, type ForecastSeries, type WeatherSeries } from '../sources/weather';
import { buildAssessment, classify, seasonStart } from './assess';
import { cropDay } from '../../src/data/cropParams';
import { classifyDepletion, readilyAvailableWater, runDepletion, stressCoefficient, totalAvailableWater } from './waterBalance';

const uniformSoil = [{ topCm: 0, bottomCm: 150, thetaFc: 0.25, thetaWp: 0.13 }];

test('przykład kontrolny: ziemniak (Zr 0,5 m, p 0,35) TAW 60 / RAW 21, kukurydza (Zr 1,2 m, p 0,55) TAW 144 / RAW 79,2', () => {
  assert.equal(totalAvailableWater(uniformSoil, 0.5).tawMm, 60);
  assert.equal(readilyAvailableWater(60, 0.35), 21);
  assert.equal(totalAvailableWater(uniformSoil, 1.2).tawMm, 144);
  assert.equal(readilyAvailableWater(144, 0.55), 79.2);
  // Przy Dr 45 mm wynik względem progu jest różny.
  assert.equal(classifyDepletion(45, 21), 'stress');
  assert.equal(classifyDepletion(45, 79.2), 'no_stress');
  assert.ok(stressCoefficient(45, 60, 21) < 1);
  assert.equal(stressCoefficient(45, 144, 79.2), 1);
});

test('profil warstwowy: wkłady warstw w zasięgu korzeni, warstwa przecięta proporcjonalnie', () => {
  const r = totalAvailableWater(
    [
      { topCm: 0, bottomCm: 30, thetaFc: 0.3, thetaWp: 0.15 },
      { topCm: 30, bottomCm: 100, thetaFc: 0.2, thetaWp: 0.1 },
    ],
    0.6,
  );
  assert.equal(r.tawMm, 75);
  assert.equal(totalAvailableWater([{ topCm: 0, bottomCm: 40, thetaFc: 0.25, thetaWp: 0.13 }], 1).tawMm, null);
});

test('bilans dzienny zatrzymuje się na braku danych zamiast zakładać zero', () => {
  const run = runDepletion({
    initialDepletionMm: 10,
    tawMm: 60,
    kcForDate: () => 1,
    days: [
      { date: '2024-06-01', precipitationMm: 0, et0Mm: 5 },
      { date: '2024-06-02', precipitationMm: null, et0Mm: 4 },
      { date: '2024-06-03', precipitationMm: 0, et0Mm: 6 },
    ],
  });
  assert.equal(run.finalDrMm, 15);
  assert.deepEqual(run.missingDates, ['2024-06-02']);
});

test('ET0 Penman–Monteith: przykład FAO-56 nr 18 (Bruksela, 6 lipca) ≈ 3,9 mm', () => {
  const et0 = et0PenmanMonteith({ date: '2023-07-06', latDeg: 50.8, tMax: 21.5, tMin: 12.3, tMean: 16.9, rhMean: 73.5, wind2m: 2.078, rsMj: 22.07, elevationM: 100 });
  assert.ok(et0 !== null && Math.abs(et0 - 3.9) < 0.25, `ET0 = ${et0}`);
});

test('Saxton i Rawls: glina (40% piasku, 20% iłu, 2,5% materii org.) ≈ θFC 0,28, θWP 0,12', () => {
  const { thetaFc, thetaWp } = saxtonRawls(40, 20, 2.5);
  assert.ok(Math.abs(thetaFc - 0.28) < 0.015, `θFC ${thetaFc}`);
  assert.ok(Math.abs(thetaWp - 0.12) < 0.02, `θWP ${thetaWp}`);
  const sand = saxtonRawls(90, 3, 1);
  assert.ok(sand.thetaFc - sand.thetaWp < 0.1, 'piasek ma małą retencję');
});

test('kalendarz uprawy: pszenica ozima w czerwcu w pełni rozwoju, w grudniu poza sezonem', () => {
  assert.equal(cropDay('pszenica_ozima', '2024-06-10').stage, 'srodkowa');
  assert.equal(cropDay('pszenica_ozima', '2024-12-10').inSeason, false);
  assert.equal(seasonStart('2024-02-10'), '2023-03-01');
  assert.equal(classify(10, 100, 50), 'low');
  assert.equal(classify(60, 100, 50), 'moderate');
  assert.equal(classify(90, 100, 50), 'elevated');
});

function syntheticWeather(start: string, end: string, f: (date: string) => [number, number]): WeatherSeries {
  const days = dateRange(start, end).map((date) => {
    const [p, e] = f(date);
    return { date, precipitationMm: p, et0Mm: e, source: 'nasa-power' as const };
  });
  return {
    days,
    lastCompleteDate: end,
    notes: [],
    sources: [{ name: 'test', provider: 'test', url: null, origin: 'observed', retrievedAt: null, observationDate: null, resolutionM: null, durationMs: null, notes: [] }],
  };
}

const soil = (fc: number, wp: number, category: SoilProfile['category']): SoilProfile => ({
  horizons: [{ topCm: 0, bottomCm: 200, thetaFc: fc, thetaWp: wp, sandPct: 85, clayPct: 5, organicMatterPct: 1 }],
  topsoilTexture: 'piasek gliniasty',
  category,
  missing: [],
  source: { name: 'gleba', provider: 'test', url: null, origin: 'observed', retrievedAt: null, observationDate: null, resolutionM: 250, durationMs: null, notes: [] },
});

const parcel = {
  id: '040706_4.0001.9',
  ring2180: [[0, 0], [100, 0], [100, 100]],
  ringWgs84: [[18.31, 52.68], [18.311, 52.68], [18.311, 52.681]],
  areaHa: 1,
  voivodeship: 'kujawsko-pomorskie',
  county: null,
  commune: null,
  region: null,
  origin: 'observed',
  source: { name: 'ULDK', provider: 'GUGiK', url: null, origin: 'observed', retrievedAt: '2026-11-21T10:00:00Z', observationDate: null, resolutionM: null, durationMs: 100, notes: [] },
} as unknown as ParcelInfo;

test('susza na glebie lekkiej: podwyższone ryzyko, podatność, zalecenia wynikające z oceny', () => {
  // Każdego lata 1 mm opadu i 5 mm ET0 dziennie; poza latem wilgotno.
  const weather = syntheticWeather('2014-03-01', '2024-07-01', (d) => (d.slice(5, 7) >= '05' && d.slice(5, 7) <= '08' ? [1, 5] : [3, 1]));
  const result = buildAssessment({
    request: { parcelId: parcel.id, cropId: 'pszenica_ozima', analysisDate: '2024-07-01' },
    parcel,
    weather,
    soil: soil(0.14, 0.05, 'lekka'),
    hydro: null,
    now: new Date('2026-11-21T12:00:00Z'),
  });
  assert.equal(result.isDemo, false);
  assert.equal(result.currentState.level, 'elevated');
  assert.equal(result.historicalVulnerability.level, 'elevated');
  assert.ok(result.historicalVulnerability.criticalMonths.includes(6));
  assert.ok(result.recommendations.some((r) => r.id === 'rec-prochnica'));
  assert.ok(result.recommendations.some((r) => r.id === 'rec-wilgoc'));
  assert.equal(result.irrigation?.status === 'calculated' && result.irrigation.justified, true);
});

test('dane po dacie analizy nie wpływają na ocenę', () => {
  const dry = (d: string): [number, number] => (d.slice(5, 7) >= '05' && d.slice(5, 7) <= '08' ? [1, 5] : [3, 1]);
  const base = syntheticWeather('2014-03-01', '2024-06-15', dry);
  // Ta sama seria z dodatkowymi, bardzo mokrymi dniami po dacie analizy.
  const extended = syntheticWeather('2014-03-01', '2024-07-15', (d) => (d > '2024-06-15' ? [50, 1] : dry(d)));
  const req = { parcelId: parcel.id, cropId: 'kukurydza_ziarno' as const, analysisDate: '2024-06-15' };
  const a = buildAssessment({ request: req, parcel, weather: base, soil: soil(0.25, 0.12, 'średnia'), hydro: null });
  const b = buildAssessment({ request: req, parcel, weather: extended, soil: soil(0.25, 0.12, 'średnia'), hydro: null });
  assert.equal(a.currentState.level, b.currentState.level);
  assert.equal(a.currentState.indicators[0]?.value, b.currentState.indicators[0]?.value);
});

test('brak danych o glebie: „Za mało danych”, bez zaleceń, ale ze wskaźnikami pogodowymi', () => {
  const weather = syntheticWeather('2014-03-01', '2024-07-01', () => [2, 2]);
  const result = buildAssessment({ request: { parcelId: parcel.id, cropId: 'ziemniaki', analysisDate: '2024-07-01' }, parcel, weather, soil: null, hydro: null });
  assert.equal(result.currentState.level, 'insufficient_data');
  assert.equal(result.recommendations.length, 0);
  assert.ok(result.currentState.indicators.some((i) => i.id === 'opad30'));
  assert.equal(result.dataSources.find((s) => s.kind === 'gleba')?.availability, 'missing');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
});

test('każda uprawa z listy ma spójne parametry i kalendarz', async () => {
  const { CROPS, CROP_GROUPS } = await import('../../src/data/crops');
  const { CROP_PARAMS, cropPhases } = await import('../../src/data/cropParams');
  assert.ok(CROPS.length >= 60);
  for (const crop of CROPS) {
    const c = CROP_PARAMS[crop.id];
    assert.ok(c, `brak parametrów: ${crop.id}`);
    assert.ok(CROP_GROUPS.some((g) => g.id === crop.group), `nieznana grupa: ${crop.id}`);
    const phases = cropPhases(crop.id, 2024);
    for (let i = 0; i < phases.length; i += 1) {
      assert.ok(phases[i]!.from < phases[i]!.to, `${crop.id}: faza ${phases[i]!.stage} ma zerową długość`);
      if (i > 0) assert.equal(phases[i]!.from, phases[i - 1]!.to);
    }
    assert.ok(c.zrStart <= c.zrMax && c.p > 0 && c.p < 1 && c.kcMid >= c.kcIni * 0.9, crop.id);
    assert.ok(crop.criticalMonths.every((m) => m >= 3 && m <= 11), crop.id);
  }
});

test('różne uprawy na tym samym polu dają różną ocenę', () => {
  // Umiarkowanie suche lato na glebie średniej: płytko ukorzenione ziemniaki odczuwają niedobór, lucerna z głębokimi korzeniami – nie.
  const weather = syntheticWeather('2014-03-01', '2024-07-10', (d) => (d.slice(5, 7) >= '05' && d.slice(5, 7) <= '08' ? [2, 4] : [3, 1]));
  const run = (cropId: 'ziemniaki' | 'lucerna') =>
    buildAssessment({
      request: { parcelId: parcel.id, cropId, analysisDate: '2024-07-10' },
      parcel,
      weather,
      soil: soil(0.3, 0.13, 'średnia'),
      hydro: null,
      now: new Date('2026-11-21T12:00:00Z'),
    });
  const potatoes = run('ziemniaki');
  const lucerne = run('lucerna');
  assert.notEqual(potatoes.currentState.summary, lucerne.currentState.summary);
  const order = { low: 0, moderate: 1, elevated: 2, insufficient_data: -1 } as const;
  assert.ok(order[potatoes.currentState.level] > order[lucerne.currentState.level], `${potatoes.currentState.level} vs ${lucerne.currentState.level}`);
});

function forecastSeries(start: string, n: number, f: (i: number) => { p: number; e: number; tMin?: number; tMax?: number }): ForecastSeries {
  return {
    issuedAt: '2024-07-01T06:00:00Z',
    days: Array.from({ length: n }, (_, i) => {
      const v = f(i);
      return { date: addDays(start, i), precipitationMm: v.p, probabilityPct: v.p > 0 ? 80 : 10, et0Mm: v.e, tMax: v.tMax ?? 24, tMin: v.tMin ?? 12, past: false };
    }),
    source: { name: 'prognoza', provider: 'test', url: null, origin: 'observed', retrievedAt: null, observationDate: null, resolutionM: null, durationMs: null, notes: [] },
  };
}

const dryHistory = (d: string): [number, number] => (d.slice(5, 7) >= '05' && d.slice(5, 7) <= '08' ? [1, 5] : [3, 1]);

test('bilans prognozy: w stresie, za 2 dni ulewa – nie nawadniaj teraz, rachunek się zgadza, ostrzeżenie o ulewie', () => {
  const weather = syntheticWeather('2014-03-01', '2024-07-01', dryHistory);
  const result = buildAssessment({
    request: { parcelId: parcel.id, cropId: 'ziemniaki', analysisDate: '2024-07-01' },
    parcel, weather, soil: soil(0.14, 0.05, 'lekka'), hydro: null,
    now: new Date('2024-07-01T12:00:00Z'), todayDate: '2024-07-01',
    forecast: forecastSeries('2024-07-02', 10, (i) => ({ p: i === 1 ? 60 : 0, e: 4 })),
  });
  const f = result.forecast!;
  assert.equal(f.status, 'ok');
  const b = f.balance!;
  assert.equal(b.horizonDays, 7);
  assert.equal(b.rainMm, 60);
  assert.equal(b.rainUsedMm + b.rainLostMm, b.rainMm);
  assert.ok(b.rainLostMm > 0, 'gleba nie przyjmie ulewy ponad swoją pojemność');
  // Pierwsza dawka nie wcześniej niż po deszczu.
  const plan = f.irrigationPlan!;
  assert.equal(plan.typicallyIrrigated, true);
  assert.ok(plan.events.every((e) => e.date > '2024-07-03'), JSON.stringify(plan.events));
  assert.ok(plan.events.every((e) => e.m3PerHa === e.doseMm * 10 && e.m3Parcel === e.doseMm * 10 * parcel.areaHa));
  const ids = f.steps.map((s) => s.id);
  assert.ok(ids.includes('ulewa'), ids.join());
  assert.ok(result.dataSources.some((s) => s.id === 'prognoza'));
});

test('bilans prognozy: dobry zapas, sucho i gorąco – plan nawadniania z datą, upał', () => {
  const wet = (d: string): [number, number] => (d.slice(5, 7) >= '05' && d.slice(5, 7) <= '08' ? [4, 3] : [3, 1]);
  const weather = syntheticWeather('2014-03-01', '2024-07-01', wet);
  const result = buildAssessment({
    request: { parcelId: parcel.id, cropId: 'ziemniaki', analysisDate: '2024-07-01' },
    parcel, weather, soil: soil(0.3, 0.13, 'średnia'), hydro: null,
    now: new Date('2024-07-01T12:00:00Z'), todayDate: '2024-07-01',
    forecast: forecastSeries('2024-07-02', 10, () => ({ p: 0, e: 6, tMax: 32 })),
  });
  assert.equal(result.currentState.level, 'low');
  const f = result.forecast!;
  assert.ok(f.balance!.needMm > 0 && f.balance!.rainMm === 0);
  assert.ok(f.balance!.endReservePct < f.balance!.startReservePct);
  assert.ok(f.irrigationPlan!.events.length > 0);
  const dates = f.irrigationPlan!.events.map((e) => Date.parse(e.date));
  assert.ok(dates.every((d, i) => i === 0 || d - dates[i - 1]! >= 3 * 86400000), 'odstęp między dawkami ≥ 3 dni');
  const ids = f.steps.map((s) => s.id);
  assert.ok(ids.includes('nawadnianie'), ids.join());
  assert.ok(ids.includes('upal'), ids.join());
});

test('bilans prognozy: zboże bez deszczowni dostaje kroki ograniczania strat', () => {
  const weather = syntheticWeather('2014-03-01', '2024-06-10', dryHistory);
  const result = buildAssessment({
    request: { parcelId: parcel.id, cropId: 'pszenica_ozima', analysisDate: '2024-06-10' },
    parcel, weather, soil: soil(0.14, 0.05, 'lekka'), hydro: null,
    now: new Date('2024-06-10T12:00:00Z'), todayDate: '2024-06-10',
    forecast: forecastSeries('2024-06-11', 10, () => ({ p: 0.5, e: 5 })),
  });
  const ids = result.forecast!.steps.map((s) => s.id);
  assert.deepEqual(ids.slice(0, 2), ['nawadnianie', 'bez-deszczowni']);
  assert.ok(result.forecast!.steps[0]!.title.startsWith('Jeśli masz deszczownię'));
});

test('bilans prognozy: analiza historyczna – nie dotyczy; poza sezonem – zatrzymaj wodę, mróz', () => {
  const weather = syntheticWeather('2014-03-01', '2024-11-20', dryHistory);
  const past = buildAssessment({
    request: { parcelId: parcel.id, cropId: 'ziemniaki', analysisDate: '2024-07-01' },
    parcel, weather, soil: soil(0.3, 0.13, 'średnia'), hydro: null, todayDate: '2024-11-20', now: new Date('2024-11-20T12:00:00Z'),
  });
  assert.equal(past.forecast?.status, 'not_applicable');
  const off = buildAssessment({
    request: { parcelId: parcel.id, cropId: 'ziemniaki', analysisDate: '2024-11-20' },
    parcel, weather, soil: soil(0.3, 0.13, 'średnia'), hydro: null, todayDate: '2024-11-20', now: new Date('2024-11-20T12:00:00Z'),
    forecast: forecastSeries('2024-11-21', 10, (i) => ({ p: i % 2 ? 4 : 0, e: 0.5, tMin: -2, tMax: 3 })),
  });
  assert.deepEqual(off.forecast!.steps.map((s) => s.id), ['poza-sezonem', 'mroz']);
  assert.equal(off.forecast!.irrigationPlan!.events.length, 0);
});

test('luka w pogodzie (brak 1 kwietnia) blokuje diagnozę na 30 czerwca: „Za mało danych”, ostatnia wiarygodna data, bez zaleceń', () => {
  const weather = syntheticWeather('2014-03-01', '2024-06-30', (d) => (d.slice(5, 7) >= '05' && d.slice(5, 7) <= '08' ? [1, 5] : [3, 1]));
  for (const day of weather.days) if (day.date === '2024-04-01') day.precipitationMm = null as unknown as number;
  const result = buildAssessment({
    request: { parcelId: parcel.id, cropId: 'pszenica_ozima', analysisDate: '2024-06-30' },
    parcel,
    weather,
    soil: soil(0.14, 0.05, 'lekka'),
    hydro: null,
    now: new Date('2026-11-21T12:00:00Z'),
  });
  assert.equal(result.currentState.level, 'insufficient_data');
  assert.match(result.currentState.summary, /1 kwietnia 2024/);
  assert.match(result.currentState.summary, /Ostatni dzień z wiarygodnym bilansem: 31 marca 2024/);
  assert.equal(result.recommendations.length, 0);
  assert.equal(result.irrigation?.status, 'not_calculated');
});
