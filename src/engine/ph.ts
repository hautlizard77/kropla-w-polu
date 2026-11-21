/**
 * Porównanie odczynu gleby z wymaganiami uprawy.
 *
 * pH mierzone w KCl i w H₂O różni się systematycznie, więc liczbowo porównujemy tylko
 * wartości zmierzone tą samą, znaną metodą. Zakres uprawy z metodą `unspecified`
 * pokazujemy jako informację opisową.
 */
export type PhMethod = 'KCl' | 'H2O' | 'CaCl2' | 'unspecified';

export interface ParcelPh {
  value: number | null;
  /** null = metoda pomiaru nieznana. */
  method: PhMethod | null;
}

export interface CropPhRange {
  min: number | null;
  max: number | null;
  method: PhMethod;
}

export type PhComparison =
  | { kind: 'in_range' | 'below' | 'above'; message: string }
  | { kind: 'no_comparable_data'; message: string }
  | { kind: 'descriptive_only'; message: string }
  | { kind: 'no_data'; message: string };

export function comparePh(parcel: ParcelPh, crop: CropPhRange): PhComparison {
  if (parcel.value === null) {
    return { kind: 'no_data', message: 'Brak pomiaru pH dla działki.' };
  }
  if (crop.min === null && crop.max === null) {
    return { kind: 'no_data', message: 'Brak zakresu pH dla tej uprawy.' };
  }
  if (crop.method === 'unspecified') {
    return {
      kind: 'descriptive_only',
      message: `Zakres dla uprawy ${formatRange(crop)} podano bez metody pomiaru – służy tylko jako informacja.`,
    };
  }
  if (parcel.method === null || parcel.method === 'unspecified' || parcel.method !== crop.method) {
    return {
      kind: 'no_comparable_data',
      message: `Brak porównywalnych danych: pH działki ${parcel.method ? `w ${label(parcel.method)}` : 'bez znanej metody'}, zakres uprawy w ${label(crop.method)}.`,
    };
  }
  if (crop.min !== null && parcel.value < crop.min) {
    return { kind: 'below', message: `pH ${parcel.value} (${label(parcel.method)}) poniżej zakresu ${formatRange(crop)}.` };
  }
  if (crop.max !== null && parcel.value > crop.max) {
    return { kind: 'above', message: `pH ${parcel.value} (${label(parcel.method)}) powyżej zakresu ${formatRange(crop)}.` };
  }
  return { kind: 'in_range', message: `pH ${parcel.value} (${label(parcel.method)}) w zakresie ${formatRange(crop)}.` };
}

function label(method: PhMethod): string {
  return method === 'H2O' ? 'H₂O' : method === 'CaCl2' ? 'CaCl₂' : method === 'unspecified' ? 'nieokreślonej metodzie' : method;
}

function formatRange(range: CropPhRange): string {
  const min = range.min ?? '?';
  const max = range.max ?? '?';
  return `${min}–${max}`;
}
