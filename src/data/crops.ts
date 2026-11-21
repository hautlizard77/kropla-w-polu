import type { Crop, CropId } from '../types/analysis';

/** Uprawy dostępne w formularzu. Miesiące krytyczne są orientacyjne i posłużą silnikowi oceny. */
export const CROPS: Crop[] = [
  { id: 'pszenica_ozima', label: 'Pszenica ozima', criticalMonths: [4, 5, 6] },
  { id: 'pszenica_jara', label: 'Pszenica jara', criticalMonths: [5, 6] },
  { id: 'jeczmien_jary', label: 'Jęczmień jary', criticalMonths: [5, 6] },
  { id: 'zyto', label: 'Żyto', criticalMonths: [4, 5] },
  { id: 'kukurydza_ziarno', label: 'Kukurydza na ziarno', criticalMonths: [6, 7, 8] },
  { id: 'kukurydza_kiszonka', label: 'Kukurydza na kiszonkę', criticalMonths: [6, 7, 8] },
  { id: 'rzepak_ozimy', label: 'Rzepak ozimy', criticalMonths: [4, 5] },
  { id: 'ziemniaki', label: 'Ziemniaki', criticalMonths: [6, 7, 8] },
  { id: 'buraki_cukrowe', label: 'Buraki cukrowe', criticalMonths: [6, 7, 8] },
  { id: 'uzytki_zielone', label: 'Użytki zielone (łąki, pastwiska)', criticalMonths: [5, 6, 7, 8] },
];

export function getCrop(id: CropId): Crop | undefined {
  return CROPS.find((crop) => crop.id === id);
}

export function cropLabel(id: CropId): string {
  return getCrop(id)?.label ?? id;
}

export function isCropId(value: string): value is CropId {
  return CROPS.some((crop) => crop.id === value);
}
