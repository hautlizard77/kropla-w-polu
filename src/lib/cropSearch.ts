import { CROPS, CROP_GROUPS } from '../data/crops';
import type { Crop } from '../types/analysis';

/** Dodatkowe słowa, po których można znaleźć uprawę (potoczne nazwy). */
const ALIASES: Partial<Record<Crop['id'], string>> = {
  ziemniaki: 'kartofle',
  ziemniaki_wczesne: 'kartofle młode',
  uzytki_zielone: 'łąka pastwisko trawa siano',
  kukurydza_kiszonka: 'silos',
  sad_jablon: 'jabłoń jabłka',
  sad_grusza: 'grusza gruszki',
  sad_wisnia: 'wiśnia czereśnia',
  sad_sliwa: 'śliwa śliwki',
  borowka: 'jagoda',
  winorosl: 'winogrona wino',
  truskawki: 'truskawka',
  buraki_cukrowe: 'burak',
  buraki_pastewne: 'burak',
  fasola_szparagowa: 'fasolka',
  groszek_zielony: 'groch',
  len: 'siemię',
  lubin: 'łubin',
};

/** Małe litery bez polskich znaków – „zyto” znajdzie „Żyto”, „jablon” – „Sad jabłoniowy”. */
export function normalize(text: string): string {
  return text
    .toLocaleLowerCase('pl-PL')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Uprawy pasujące do wpisanego tekstu: każde słowo zapytania musi pasować do nazwy, grupy albo nazwy potocznej. */
export function searchCrops(query: string): Crop[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return CROPS;
  return CROPS.filter((crop) => {
    const group = CROP_GROUPS.find((g) => g.id === crop.group)?.label ?? '';
    // Fragment nazwy uprawy pasuje w dowolnym miejscu („zyto” → „Pszenżyto”); grupa i nazwy potoczne – od początku słowa
    // (żeby krótkie „oz” nie trafiało w „Zboża”).
    const label = normalize(crop.label);
    const extra = normalize(`${group} ${ALIASES[crop.id] ?? ''}`).split(/[\s,()]+/);
    return words.every((w) => label.includes(w) || extra.some((x) => x.startsWith(w)));
  }).sort((a, b) => Number(!normalize(a.label).startsWith(words[0]!)) - Number(!normalize(b.label).startsWith(words[0]!)));
}
