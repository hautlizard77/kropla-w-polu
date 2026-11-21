/**
 * Bilans wody w strefie korzeni (podejście FAO-56, rozdz. 8).
 *
 * Jednostki:
 * - θ (wilgotność objętościowa) – m³/m³,
 * - głębokość korzeni Zr – m,
 * - TAW, RAW, Dr, opad, ET0, ETc – mm.
 *
 * Czyste funkcje bez zależności od interfejsu – testowane w waterBalance.test.ts.
 * Brak danych sygnalizujemy przez `null` i listę przyczyn, nigdy przez zero.
 */
import type { IsoDate } from '../../src/types/analysis';

export interface SoilLayer {
  /** Górna granica warstwy, cm od powierzchni. */
  topCm: number;
  /** Dolna granica warstwy, cm od powierzchni. */
  bottomCm: number;
  /** Wilgotność przy polowej pojemności wodnej θFC, m³/m³. */
  thetaFc: number | null;
  /** Wilgotność w punkcie trwałego więdnięcia θWP, m³/m³. */
  thetaWp: number | null;
}

export interface TawResult {
  tawMm: number | null;
  /** Wkład każdej warstwy w zasięgu korzeni, mm. */
  contributions: { topCm: number; bottomCm: number; mm: number }[];
  /** Przyczyny braku wyniku. */
  missing: string[];
}

/**
 * TAW = Σ 1000 · (θFC − θWP) · miąższość warstwy w zasięgu korzeni [m].
 * Warstwy częściowo w zasięgu korzeni liczymy proporcjonalnie.
 */
export function totalAvailableWater(layers: SoilLayer[], rootDepthM: number): TawResult {
  const missing: string[] = [];
  if (!(rootDepthM > 0)) {
    return { tawMm: null, contributions: [], missing: ['Brak głębokości korzeni.'] };
  }
  const rootCm = rootDepthM * 100;
  const sorted = [...layers].sort((a, b) => a.topCm - b.topCm);
  const contributions: TawResult['contributions'] = [];
  let coveredToCm = 0;

  for (const layer of sorted) {
    const top = Math.max(layer.topCm, 0);
    const bottom = Math.min(layer.bottomCm, rootCm);
    if (bottom <= top) continue;
    if (top > coveredToCm + 1e-9) missing.push(`Brak danych o glebie między ${coveredToCm} a ${top} cm.`);
    coveredToCm = Math.max(coveredToCm, bottom);
    if (layer.thetaFc === null || layer.thetaWp === null) {
      missing.push(`Brak θFC lub θWP dla warstwy ${layer.topCm}–${layer.bottomCm} cm.`);
      continue;
    }
    if (layer.thetaFc < layer.thetaWp) {
      missing.push(`Niespójne dane warstwy ${layer.topCm}–${layer.bottomCm} cm: θFC < θWP.`);
      continue;
    }
    const thicknessM = (bottom - top) / 100;
    contributions.push({ topCm: top, bottomCm: bottom, mm: round(1000 * (layer.thetaFc - layer.thetaWp) * thicknessM) });
  }
  if (coveredToCm + 1e-9 < rootCm) missing.push(`Dane o glebie sięgają ${coveredToCm} cm, a korzenie ${round(rootCm)} cm.`);

  if (missing.length > 0) return { tawMm: null, contributions, missing };
  return { tawMm: round(contributions.reduce((sum, c) => sum + c.mm, 0)), contributions, missing };
}

/** RAW = p · TAW. */
export function readilyAvailableWater(tawMm: number, depletionFractionP: number): number {
  return round(depletionFractionP * tawMm);
}

/** ETc = Kc · ET0. */
export function cropEvapotranspiration(et0Mm: number, kc: number): number {
  return round(kc * et0Mm);
}

export interface DailyWeather {
  date: IsoDate;
  /** Opad dobowy, mm; null = brak obserwacji. */
  precipitationMm: number | null;
  /** Ewapotranspiracja wskaźnikowa ET0, mm; null = brak. */
  et0Mm: number | null;
}

export interface DepletionStep {
  date: IsoDate;
  precipitationMm: number;
  irrigationMm: number;
  etcMm: number;
  deepPercolationMm: number;
  /** Ubytek wody na koniec dnia, mm. */
  drMm: number;
}

export interface DepletionRun {
  steps: DepletionStep[];
  /** Ubytek na ostatni dzień z kompletnymi danymi; null, jeśli nie policzono żadnego dnia. */
  finalDrMm: number | null;
  lastCompleteDate: IsoDate | null;
  /** Dni, na których bilans się zatrzymał z powodu braku danych. */
  missingDates: IsoDate[];
}

/**
 * Dzienny bilans ubytku wody w strefie korzeni (FAO-56, równ. 85, bez spływu i podsiąku):
 * Dr,i = Dr,i−1 − P,i − I,i + ETc,i, ograniczone do [0, TAW]; nadmiar wody to przesiąk DP.
 *
 * Gdy brakuje opadu lub ET0, bilans zatrzymuje się na ostatnim kompletnym dniu,
 * zamiast zakładać zero.
 */
export function runDepletion(params: {
  initialDepletionMm: number;
  tawMm: number;
  days: DailyWeather[];
  kcForDate: (date: IsoDate) => number | null;
  /** Nawadnianie, mm; brak informacji = 0 tylko w jawnym scenariuszu „bez nawadniania”. */
  irrigationForDate?: (date: IsoDate) => number;
}): DepletionRun {
  const { tawMm, days, kcForDate, irrigationForDate = () => 0 } = params;
  let dr = clamp(params.initialDepletionMm, 0, tawMm);
  const steps: DepletionStep[] = [];
  const missingDates: IsoDate[] = [];

  for (const day of days) {
    const kc = kcForDate(day.date);
    if (day.precipitationMm === null || day.et0Mm === null || kc === null) {
      missingDates.push(day.date);
      break;
    }
    const irrigation = irrigationForDate(day.date);
    const etc = cropEvapotranspiration(day.et0Mm, kc);
    const raw = dr - day.precipitationMm - irrigation + etc;
    const deepPercolation = raw < 0 ? -raw : 0;
    dr = clamp(raw, 0, tawMm);
    steps.push({
      date: day.date,
      precipitationMm: day.precipitationMm,
      irrigationMm: irrigation,
      etcMm: etc,
      deepPercolationMm: round(deepPercolation),
      drMm: round(dr),
    });
  }

  const last = steps[steps.length - 1];
  return {
    steps,
    finalDrMm: last ? last.drMm : null,
    lastCompleteDate: last ? last.date : null,
    missingDates,
  };
}

export type StressClass = 'no_stress' | 'stress' | 'ambiguous';

/**
 * Współczynnik stresu Ks (FAO-56, równ. 84): 1, gdy Dr ≤ RAW; w przeciwnym razie (TAW − Dr) / ((1 − p) · TAW).
 */
export function stressCoefficient(drMm: number, tawMm: number, rawMm: number): number {
  if (drMm <= rawMm) return 1;
  const denominator = tawMm - rawMm;
  if (denominator <= 0) return 0;
  return round(clamp((tawMm - drMm) / denominator, 0, 1), 3);
}

/** Klasyfikacja pojedynczej wartości: stres, gdy ubytek przekracza RAW. */
export function classifyDepletion(drMm: number, rawMm: number): Exclude<StressClass, 'ambiguous'> {
  return drMm > rawMm ? 'stress' : 'no_stress';
}

/**
 * Klasyfikacja przy niepewnych wejściach: jeśli sensowny zakres Dr lub RAW przecina próg,
 * wynik jest niejednoznaczny.
 */
export function classifyRange(dr: { min: number; max: number }, raw: { min: number; max: number }): StressClass {
  if (dr.min > raw.max) return 'stress';
  if (dr.max <= raw.min) return 'no_stress';
  return 'ambiguous';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
