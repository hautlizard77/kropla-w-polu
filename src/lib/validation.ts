import { isCropId } from '../data/crops';
import type { AnalysisRequest } from '../types/analysis';
import { compareIsoDates, earliestAnalysisDate, formatDatePl, isValidIsoDate, todayInPoland } from './dates';

/** Wartości formularza – zawsze napisy, bo tak przychodzą z pól. */
export interface FormValues {
  parcelId: string;
  cropId: string;
  analysisDate: string;
}

export type FieldErrors = Partial<Record<keyof FormValues, string>>;

/**
 * Identyfikator działki ewidencyjnej: WWPPGG_R.OOOO[.AR_n].NR[/NR]
 * np. 040705_5.0012.245/3 lub 146501_8.0101.AR_12.45
 */
const PARCEL_ID = /^\d{6}_\d\.\d{4}(\.AR_\d+)?\.\d+[A-Za-z]?(\/\d+[A-Za-z]?)?$/;

export function isValidParcelId(value: string): boolean {
  return PARCEL_ID.test(value);
}

export const PARCEL_ID_FORMAT_ERROR =
  'To nie wygląda na identyfikator działki ewidencyjnej. Wzór: 040705_5.0012.245/3 (kod gminy_obręb.numer działki).';

export function normalizeParcelId(value: string): string {
  return value.trim().replace(/\s+/g, '');
}

export function validateForm(
  values: FormValues,
  today: string = todayInPoland(),
): { request: AnalysisRequest; errors: null } | { request: null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const parcelId = normalizeParcelId(values.parcelId);

  if (!parcelId) {
    errors.parcelId = 'Podaj identyfikator działki albo wskaż działkę na mapie.';
  } else if (!PARCEL_ID.test(parcelId)) {
    errors.parcelId = PARCEL_ID_FORMAT_ERROR;
  }

  if (!values.cropId) {
    errors.cropId = 'Wybierz uprawę.';
  } else if (!isCropId(values.cropId)) {
    errors.cropId = 'Wybierz uprawę z listy.';
  }

  const earliest = earliestAnalysisDate(today);
  if (!values.analysisDate) {
    errors.analysisDate = 'Podaj datę analizy.';
  } else if (!isValidIsoDate(values.analysisDate)) {
    errors.analysisDate = 'Podaj poprawną datę w formacie RRRR-MM-DD.';
  } else if (compareIsoDates(values.analysisDate, today) > 0) {
    errors.analysisDate = 'Data analizy nie może być z przyszłości.';
  } else if (compareIsoDates(values.analysisDate, earliest) < 0) {
    errors.analysisDate = `Wybierz datę z ostatnich 10 lat – najwcześniej ${formatDatePl(earliest)}.`;
  }

  if (Object.keys(errors).length > 0 || !isCropId(values.cropId)) {
    return { request: null, errors };
  }
  return {
    request: { parcelId, cropId: values.cropId, analysisDate: values.analysisDate },
    errors: null,
  };
}
