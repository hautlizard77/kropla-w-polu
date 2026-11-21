import type { Crop, CropGroup, CropId } from '../types/analysis';

export const CROP_GROUPS: { id: CropGroup; label: string }[] = [
  { id: 'zboza', label: 'Zboża' },
  { id: 'okopowe', label: 'Okopowe' },
  { id: 'oleiste', label: 'Oleiste' },
  { id: 'straczkowe', label: 'Strączkowe' },
  { id: 'pastewne', label: 'Pastewne i użytki zielone' },
  { id: 'warzywa', label: 'Warzywa polowe' },
  { id: 'owoce', label: 'Owoce i sady' },
];

/** Uprawy dostępne w formularzu. Miesiące krytyczne – okresy największej wrażliwości na niedobór wody (orientacyjnie). */
export const CROPS: Crop[] = [
  { id: 'pszenica_ozima', label: 'Pszenica ozima', group: 'zboza', criticalMonths: [4, 5, 6] },
  { id: 'pszenica_jara', label: 'Pszenica jara', group: 'zboza', criticalMonths: [5, 6] },
  { id: 'jeczmien_ozimy', label: 'Jęczmień ozimy', group: 'zboza', criticalMonths: [4, 5] },
  { id: 'jeczmien_jary', label: 'Jęczmień jary', group: 'zboza', criticalMonths: [5, 6] },
  { id: 'zyto', label: 'Żyto', group: 'zboza', criticalMonths: [4, 5] },
  { id: 'pszenzyto_ozime', label: 'Pszenżyto ozime', group: 'zboza', criticalMonths: [4, 5, 6] },
  { id: 'owies', label: 'Owies', group: 'zboza', criticalMonths: [5, 6] },
  { id: 'kukurydza_ziarno', label: 'Kukurydza na ziarno', group: 'zboza', criticalMonths: [6, 7, 8] },
  { id: 'gryka', label: 'Gryka', group: 'zboza', criticalMonths: [7] },
  { id: 'ziemniaki', label: 'Ziemniaki', group: 'okopowe', criticalMonths: [6, 7, 8] },
  { id: 'buraki_cukrowe', label: 'Buraki cukrowe', group: 'okopowe', criticalMonths: [6, 7, 8] },
  { id: 'rzepak_ozimy', label: 'Rzepak ozimy', group: 'oleiste', criticalMonths: [4, 5] },
  { id: 'rzepak_jary', label: 'Rzepak jary', group: 'oleiste', criticalMonths: [6, 7] },
  { id: 'slonecznik', label: 'Słonecznik', group: 'oleiste', criticalMonths: [7, 8] },
  { id: 'groch', label: 'Groch', group: 'straczkowe', criticalMonths: [5, 6] },
  { id: 'bobik', label: 'Bobik', group: 'straczkowe', criticalMonths: [6, 7] },
  { id: 'lubin', label: 'Łubin', group: 'straczkowe', criticalMonths: [6, 7] },
  { id: 'soja', label: 'Soja', group: 'straczkowe', criticalMonths: [7, 8] },
  { id: 'kukurydza_kiszonka', label: 'Kukurydza na kiszonkę', group: 'pastewne', criticalMonths: [6, 7, 8] },
  { id: 'lucerna', label: 'Lucerna', group: 'pastewne', criticalMonths: [6, 7, 8] },
  { id: 'koniczyna', label: 'Koniczyna', group: 'pastewne', criticalMonths: [6, 7] },
  { id: 'uzytki_zielone', label: 'Użytki zielone (łąki, pastwiska)', group: 'pastewne', criticalMonths: [5, 6, 7, 8] },
  { id: 'marchew', label: 'Marchew', group: 'warzywa', criticalMonths: [6, 7, 8] },
  { id: 'cebula', label: 'Cebula', group: 'warzywa', criticalMonths: [5, 6, 7] },
  { id: 'kapusta', label: 'Kapusta', group: 'warzywa', criticalMonths: [7, 8] },
  { id: 'truskawki', label: 'Truskawki', group: 'owoce', criticalMonths: [5, 6] },
  { id: 'sad_jablon', label: 'Sad jabłoniowy', group: 'owoce', criticalMonths: [6, 7, 8] },
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
