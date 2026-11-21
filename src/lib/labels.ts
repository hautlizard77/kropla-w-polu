import type { Availability, DataKind, RecommendationCategory, RiskLevel } from '../types/analysis';

/** Teksty stanów ryzyka – kolor w interfejsie tylko wspiera te etykiety. */
export const RISK_LABELS: Record<RiskLevel, string> = {
  elevated: 'Podwyższone ryzyko',
  moderate: 'Umiarkowane ryzyko',
  low: 'Niskie ryzyko',
  insufficient_data: 'Za mało danych',
};

/** Symbol tekstowy obok koloru, żeby stan był czytelny także bez rozróżniania barw i na wydruku cz-b. */
export const RISK_SYMBOLS: Record<RiskLevel, string> = {
  elevated: '▲',
  moderate: '●',
  low: '▼',
  insufficient_data: '?',
};

export const DATA_KIND_LABELS: Record<DataKind, string> = {
  granice: 'Granice działki',
  teren: 'Ukształtowanie terenu',
  pogoda: 'Pogoda i opady',
  satelita: 'Obserwacje satelitarne',
  gleba: 'Gleba',
  hydrologia: 'Wody i melioracje',
};

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  available: 'Dostępne',
  partial: 'Niepełne',
  missing: 'Brak danych',
};

export const CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  retencja: 'Zatrzymanie wody',
  agrotechnika: 'Uprawa i ochrona wilgoci',
};
