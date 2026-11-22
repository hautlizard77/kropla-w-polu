/**
 * Parametry upraw do bilansu wody (FAO-56, tab. 12, 17, 22), z kalendarzem dostosowanym do warunków w Polsce.
 * Daty to typowe terminy (miesiąc-dzień); rzeczywiste fazy zależą od roku i odmiany – to założenie modelu.
 */
import type { CropId } from '../types/analysis';

export interface CropParams {
  /** Początek sezonu: siew (uprawy jare) albo ruszenie wegetacji wiosną (ozime, użytki zielone). */
  start: string;
  /** Koniec fazy początkowej, rozwoju, fazy środkowej; zbiór. */
  iniEnd: string;
  devEnd: string;
  midEnd: string;
  harvest: string;
  kcIni: number;
  kcMid: number;
  kcEnd: number;
  /** Głębokość korzeni na początku sezonu i maksymalna (m). */
  zrStart: number;
  zrMax: number;
  /** Frakcja łatwo dostępnej wody p (FAO-56, tab. 22). */
  p: number;
  /** Źródło parametrów. */
  note: string;
}

const FAO = 'FAO-56 (Allen i in. 1998), tab. 12, 17 i 22; terminy faz dla Polski – typowe, przyjęte w modelu.';

const APPROX = 'Brak uprawy w tabelach FAO-56 – parametry przybliżone na podstawie upraw o podobnym rozwoju; terminy faz typowe dla Polski.';

export const CROP_PARAMS: Record<CropId, CropParams> = {
  // Zboża
  pszenica_ozima: { start: '03-20', iniEnd: '04-10', devEnd: '05-10', midEnd: '06-30', harvest: '07-25', kcIni: 0.7, kcMid: 1.15, kcEnd: 0.3, zrStart: 0.8, zrMax: 1.5, p: 0.55, note: FAO },
  pszenica_jara: { start: '04-01', iniEnd: '04-25', devEnd: '05-30', midEnd: '07-05', harvest: '08-05', kcIni: 0.3, kcMid: 1.15, kcEnd: 0.3, zrStart: 0.3, zrMax: 1.2, p: 0.55, note: FAO },
  jeczmien_ozimy: { start: '03-15', iniEnd: '04-05', devEnd: '05-05', midEnd: '06-20', harvest: '07-10', kcIni: 0.7, kcMid: 1.15, kcEnd: 0.25, zrStart: 0.8, zrMax: 1.3, p: 0.55, note: FAO },
  jeczmien_jary: { start: '04-01', iniEnd: '04-25', devEnd: '05-25', midEnd: '06-30', harvest: '07-25', kcIni: 0.3, kcMid: 1.15, kcEnd: 0.25, zrStart: 0.3, zrMax: 1.0, p: 0.55, note: FAO },
  zyto: { start: '03-20', iniEnd: '04-10', devEnd: '05-05', midEnd: '06-25', harvest: '07-20', kcIni: 0.7, kcMid: 1.15, kcEnd: 0.3, zrStart: 0.8, zrMax: 1.3, p: 0.55, note: FAO },
  pszenzyto_ozime: { start: '03-20', iniEnd: '04-10', devEnd: '05-10', midEnd: '06-30', harvest: '07-25', kcIni: 0.7, kcMid: 1.15, kcEnd: 0.3, zrStart: 0.8, zrMax: 1.4, p: 0.55, note: FAO },
  owies: { start: '04-01', iniEnd: '04-25', devEnd: '05-30', midEnd: '07-05', harvest: '08-05', kcIni: 0.3, kcMid: 1.15, kcEnd: 0.25, zrStart: 0.3, zrMax: 1.0, p: 0.55, note: FAO },
  kukurydza_ziarno: { start: '04-25', iniEnd: '05-20', devEnd: '07-05', midEnd: '08-25', harvest: '10-05', kcIni: 0.3, kcMid: 1.2, kcEnd: 0.35, zrStart: 0.3, zrMax: 1.2, p: 0.55, note: FAO },
  gryka: { start: '05-15', iniEnd: '06-05', devEnd: '07-05', midEnd: '08-10', harvest: '09-05', kcIni: 0.3, kcMid: 1.0, kcEnd: 0.3, zrStart: 0.2, zrMax: 0.6, p: 0.5, note: APPROX },
  // Okopowe
  ziemniaki: { start: '04-20', iniEnd: '05-15', devEnd: '06-20', midEnd: '08-10', harvest: '09-10', kcIni: 0.5, kcMid: 1.15, kcEnd: 0.75, zrStart: 0.2, zrMax: 0.5, p: 0.35, note: FAO },
  buraki_cukrowe: { start: '04-10', iniEnd: '05-10', devEnd: '06-20', midEnd: '08-31', harvest: '10-10', kcIni: 0.35, kcMid: 1.2, kcEnd: 0.7, zrStart: 0.3, zrMax: 1.0, p: 0.55, note: FAO },
  // Oleiste
  rzepak_ozimy: { start: '03-15', iniEnd: '04-01', devEnd: '04-25', midEnd: '06-10', harvest: '07-15', kcIni: 0.5, kcMid: 1.1, kcEnd: 0.35, zrStart: 0.8, zrMax: 1.3, p: 0.6, note: FAO },
  rzepak_jary: { start: '04-05', iniEnd: '04-30', devEnd: '06-01', midEnd: '07-15', harvest: '08-20', kcIni: 0.35, kcMid: 1.1, kcEnd: 0.35, zrStart: 0.3, zrMax: 1.0, p: 0.6, note: FAO },
  slonecznik: { start: '04-25', iniEnd: '05-20', devEnd: '06-30', midEnd: '08-15', harvest: '09-20', kcIni: 0.35, kcMid: 1.1, kcEnd: 0.35, zrStart: 0.3, zrMax: 1.5, p: 0.45, note: FAO },
  // Strączkowe
  groch: { start: '04-01', iniEnd: '04-25', devEnd: '05-25', midEnd: '06-30', harvest: '07-20', kcIni: 0.5, kcMid: 1.15, kcEnd: 0.3, zrStart: 0.3, zrMax: 0.8, p: 0.35, note: FAO },
  bobik: { start: '04-01', iniEnd: '04-25', devEnd: '05-30', midEnd: '07-15', harvest: '08-15', kcIni: 0.5, kcMid: 1.15, kcEnd: 0.3, zrStart: 0.3, zrMax: 0.7, p: 0.45, note: FAO },
  lubin: { start: '04-05', iniEnd: '04-30', devEnd: '06-05', midEnd: '07-20', harvest: '08-20', kcIni: 0.4, kcMid: 1.15, kcEnd: 0.35, zrStart: 0.3, zrMax: 1.0, p: 0.45, note: APPROX },
  soja: { start: '05-05', iniEnd: '05-25', devEnd: '07-05', midEnd: '08-25', harvest: '09-25', kcIni: 0.4, kcMid: 1.15, kcEnd: 0.5, zrStart: 0.3, zrMax: 1.0, p: 0.5, note: FAO },
  // Pastewne i użytki zielone
  kukurydza_kiszonka: { start: '04-25', iniEnd: '05-20', devEnd: '07-05', midEnd: '08-20', harvest: '09-15', kcIni: 0.3, kcMid: 1.2, kcEnd: 0.6, zrStart: 0.3, zrMax: 1.2, p: 0.55, note: FAO },
  lucerna: { start: '04-01', iniEnd: '04-15', devEnd: '05-01', midEnd: '09-30', harvest: '10-15', kcIni: 0.4, kcMid: 0.95, kcEnd: 0.9, zrStart: 1.0, zrMax: 1.5, p: 0.55, note: FAO },
  koniczyna: { start: '04-01', iniEnd: '04-15', devEnd: '05-01', midEnd: '09-30', harvest: '10-15', kcIni: 0.4, kcMid: 1.0, kcEnd: 0.85, zrStart: 0.6, zrMax: 0.9, p: 0.5, note: FAO },
  uzytki_zielone: { start: '04-01', iniEnd: '04-15', devEnd: '05-01', midEnd: '09-30', harvest: '10-31', kcIni: 0.5, kcMid: 0.95, kcEnd: 0.8, zrStart: 0.5, zrMax: 0.6, p: 0.6, note: FAO },
  // Warzywa
  marchew: { start: '04-15', iniEnd: '05-10', devEnd: '06-20', midEnd: '08-31', harvest: '09-30', kcIni: 0.7, kcMid: 1.05, kcEnd: 0.95, zrStart: 0.3, zrMax: 0.8, p: 0.35, note: FAO },
  cebula: { start: '04-05', iniEnd: '04-30', devEnd: '06-10', midEnd: '07-31', harvest: '08-25', kcIni: 0.7, kcMid: 1.05, kcEnd: 0.75, zrStart: 0.2, zrMax: 0.5, p: 0.3, note: FAO },
  kapusta: { start: '05-01', iniEnd: '05-25', devEnd: '06-30', midEnd: '09-10', harvest: '10-10', kcIni: 0.7, kcMid: 1.05, kcEnd: 0.95, zrStart: 0.3, zrMax: 0.7, p: 0.45, note: FAO },
  // Owoce
  truskawki: { start: '04-01', iniEnd: '04-20', devEnd: '05-15', midEnd: '07-15', harvest: '09-30', kcIni: 0.4, kcMid: 0.85, kcEnd: 0.75, zrStart: 0.2, zrMax: 0.3, p: 0.2, note: FAO },
  sad_jablon: { start: '04-10', iniEnd: '05-01', devEnd: '06-01', midEnd: '09-15', harvest: '10-20', kcIni: 0.6, kcMid: 0.95, kcEnd: 0.75, zrStart: 1.0, zrMax: 1.5, p: 0.5, note: FAO },
  // Dodane uprawy
  pszenzyto_jare: { start: '04-01', iniEnd: '04-25', devEnd: '05-30', midEnd: '07-05', harvest: '08-05', kcIni: 0.3, kcMid: 1.15, kcEnd: 0.3, zrStart: 0.3, zrMax: 1.1, p: 0.55, note: FAO },
  proso: { start: '05-15', iniEnd: '06-05', devEnd: '07-05', midEnd: '08-10', harvest: '09-05', kcIni: 0.3, kcMid: 1.0, kcEnd: 0.3, zrStart: 0.3, zrMax: 1.0, p: 0.55, note: FAO },
  sorgo: { start: '05-10', iniEnd: '06-01', devEnd: '07-10', midEnd: '08-25', harvest: '09-30', kcIni: 0.3, kcMid: 1.05, kcEnd: 0.55, zrStart: 0.3, zrMax: 1.2, p: 0.55, note: FAO },
  ziemniaki_wczesne: { start: '04-05', iniEnd: '04-30', devEnd: '05-30', midEnd: '06-30', harvest: '07-15', kcIni: 0.5, kcMid: 1.15, kcEnd: 0.75, zrStart: 0.2, zrMax: 0.4, p: 0.35, note: FAO },
  buraki_pastewne: { start: '04-10', iniEnd: '05-10', devEnd: '06-20', midEnd: '08-31', harvest: '10-10', kcIni: 0.35, kcMid: 1.2, kcEnd: 0.7, zrStart: 0.3, zrMax: 1.0, p: 0.55, note: FAO },
  len: { start: '04-10', iniEnd: '05-01', devEnd: '06-01', midEnd: '07-05', harvest: '08-01', kcIni: 0.35, kcMid: 1.1, kcEnd: 0.25, zrStart: 0.3, zrMax: 1.0, p: 0.5, note: FAO },
  gorczyca: { start: '04-10', iniEnd: '05-01', devEnd: '06-01', midEnd: '07-10', harvest: '08-10', kcIni: 0.35, kcMid: 1.05, kcEnd: 0.35, zrStart: 0.3, zrMax: 1.0, p: 0.6, note: APPROX },
  fasola: { start: '05-15', iniEnd: '06-05', devEnd: '07-05', midEnd: '08-15', harvest: '09-10', kcIni: 0.4, kcMid: 1.15, kcEnd: 0.35, zrStart: 0.3, zrMax: 0.7, p: 0.45, note: FAO },
  chmiel: { start: '04-15', iniEnd: '05-15', devEnd: '06-25', midEnd: '08-20', harvest: '09-10', kcIni: 0.3, kcMid: 1.05, kcEnd: 0.85, zrStart: 0.5, zrMax: 1.1, p: 0.5, note: FAO },
  tyton: { start: '05-15', iniEnd: '06-05', devEnd: '07-05', midEnd: '08-20', harvest: '09-15', kcIni: 0.5, kcMid: 1.1, kcEnd: 0.8, zrStart: 0.3, zrMax: 0.8, p: 0.5, note: APPROX },
  konopie: { start: '05-01', iniEnd: '05-25', devEnd: '07-01', midEnd: '08-15', harvest: '09-10', kcIni: 0.35, kcMid: 1.15, kcEnd: 0.5, zrStart: 0.3, zrMax: 1.2, p: 0.55, note: APPROX },
  pomidor: { start: '05-20', iniEnd: '06-10', devEnd: '07-10', midEnd: '08-31', harvest: '09-25', kcIni: 0.6, kcMid: 1.15, kcEnd: 0.8, zrStart: 0.3, zrMax: 1.0, p: 0.4, note: FAO },
  ogorek: { start: '05-20', iniEnd: '06-05', devEnd: '07-01', midEnd: '08-15', harvest: '09-05', kcIni: 0.6, kcMid: 1.0, kcEnd: 0.75, zrStart: 0.3, zrMax: 0.9, p: 0.5, note: FAO },
  kalafior: { start: '05-01', iniEnd: '05-20', devEnd: '06-20', midEnd: '07-25', harvest: '08-10', kcIni: 0.7, kcMid: 1.05, kcEnd: 0.95, zrStart: 0.2, zrMax: 0.6, p: 0.45, note: FAO },
  brokul: { start: '05-01', iniEnd: '05-20', devEnd: '06-20', midEnd: '07-20', harvest: '08-05', kcIni: 0.7, kcMid: 1.05, kcEnd: 0.95, zrStart: 0.2, zrMax: 0.5, p: 0.45, note: FAO },
  salata: { start: '04-20', iniEnd: '05-05', devEnd: '05-25', midEnd: '06-15', harvest: '06-25', kcIni: 0.7, kcMid: 1.0, kcEnd: 0.95, zrStart: 0.15, zrMax: 0.4, p: 0.3, note: FAO },
  szpinak: { start: '04-05', iniEnd: '04-20', devEnd: '05-05', midEnd: '05-25', harvest: '06-05', kcIni: 0.7, kcMid: 1.0, kcEnd: 0.95, zrStart: 0.15, zrMax: 0.4, p: 0.2, note: FAO },
  burak_cwiklowy: { start: '04-25', iniEnd: '05-20', devEnd: '06-25', midEnd: '08-20', harvest: '09-20', kcIni: 0.5, kcMid: 1.05, kcEnd: 0.95, zrStart: 0.3, zrMax: 0.8, p: 0.5, note: FAO },
  pietruszka: { start: '04-10', iniEnd: '05-10', devEnd: '06-20', midEnd: '08-31', harvest: '10-01', kcIni: 0.7, kcMid: 1.05, kcEnd: 0.95, zrStart: 0.3, zrMax: 0.8, p: 0.35, note: APPROX },
  seler: { start: '05-20', iniEnd: '06-10', devEnd: '07-10', midEnd: '09-10', harvest: '10-10', kcIni: 0.7, kcMid: 1.05, kcEnd: 1.0, zrStart: 0.2, zrMax: 0.5, p: 0.2, note: FAO },
  por: { start: '05-10', iniEnd: '06-01', devEnd: '07-10', midEnd: '09-15', harvest: '10-15', kcIni: 0.7, kcMid: 1.0, kcEnd: 1.0, zrStart: 0.2, zrMax: 0.5, p: 0.3, note: APPROX },
  czosnek: { start: '03-25', iniEnd: '04-20', devEnd: '05-20', midEnd: '06-25', harvest: '07-15', kcIni: 0.7, kcMid: 1.0, kcEnd: 0.7, zrStart: 0.2, zrMax: 0.4, p: 0.3, note: FAO },
  fasola_szparagowa: { start: '05-20', iniEnd: '06-05', devEnd: '06-30', midEnd: '07-25', harvest: '08-10', kcIni: 0.5, kcMid: 1.05, kcEnd: 0.9, zrStart: 0.3, zrMax: 0.6, p: 0.45, note: FAO },
  groszek_zielony: { start: '04-01', iniEnd: '04-25', devEnd: '05-20', midEnd: '06-15', harvest: '06-30', kcIni: 0.5, kcMid: 1.15, kcEnd: 1.1, zrStart: 0.3, zrMax: 0.8, p: 0.35, note: FAO },
  dynia: { start: '05-20', iniEnd: '06-10', devEnd: '07-10', midEnd: '08-31', harvest: '09-30', kcIni: 0.5, kcMid: 1.0, kcEnd: 0.8, zrStart: 0.3, zrMax: 1.0, p: 0.35, note: FAO },
  kukurydza_cukrowa: { start: '05-10', iniEnd: '06-01', devEnd: '07-05', midEnd: '08-10', harvest: '08-31', kcIni: 0.3, kcMid: 1.15, kcEnd: 1.05, zrStart: 0.3, zrMax: 1.0, p: 0.5, note: FAO },
  sad_grusza: { start: '04-10', iniEnd: '05-01', devEnd: '06-01', midEnd: '09-10', harvest: '10-10', kcIni: 0.6, kcMid: 0.95, kcEnd: 0.75, zrStart: 1.0, zrMax: 1.5, p: 0.5, note: FAO },
  sad_wisnia: { start: '04-01', iniEnd: '04-25', devEnd: '05-25', midEnd: '08-31', harvest: '10-10', kcIni: 0.6, kcMid: 0.95, kcEnd: 0.75, zrStart: 1.0, zrMax: 1.5, p: 0.5, note: FAO },
  sad_sliwa: { start: '04-05', iniEnd: '04-30', devEnd: '05-30', midEnd: '09-10', harvest: '10-10', kcIni: 0.6, kcMid: 0.95, kcEnd: 0.75, zrStart: 1.0, zrMax: 1.5, p: 0.5, note: FAO },
  porzeczka: { start: '04-01', iniEnd: '04-20', devEnd: '05-20', midEnd: '08-15', harvest: '10-01', kcIni: 0.3, kcMid: 1.05, kcEnd: 0.5, zrStart: 0.4, zrMax: 0.8, p: 0.5, note: FAO },
  malina: { start: '04-10', iniEnd: '05-01', devEnd: '06-01', midEnd: '08-31', harvest: '10-01', kcIni: 0.3, kcMid: 1.05, kcEnd: 0.5, zrStart: 0.3, zrMax: 0.6, p: 0.5, note: FAO },
  borowka: { start: '04-15', iniEnd: '05-05', devEnd: '06-01', midEnd: '08-31', harvest: '10-01', kcIni: 0.3, kcMid: 1.0, kcEnd: 0.5, zrStart: 0.2, zrMax: 0.4, p: 0.4, note: APPROX },
  aronia: { start: '04-10', iniEnd: '05-01', devEnd: '06-01', midEnd: '08-31', harvest: '10-01', kcIni: 0.3, kcMid: 1.05, kcEnd: 0.5, zrStart: 0.4, zrMax: 0.8, p: 0.5, note: APPROX },
  winorosl: { start: '04-25', iniEnd: '05-20', devEnd: '06-30', midEnd: '08-31', harvest: '10-10', kcIni: 0.3, kcMid: 0.85, kcEnd: 0.45, zrStart: 0.8, zrMax: 1.5, p: 0.35, note: FAO },
};

/** Kc i głębokość korzeni poza sezonem (ściernisko, gleba bez okrywy). */
const OFF_SEASON = { kc: 0.3, zr: 0.3 };

export type Stage = 'poza_sezonem' | 'poczatkowa' | 'rozwoju' | 'srodkowa' | 'koncowa';

export const STAGE_LABELS: Record<Stage, string> = {
  poza_sezonem: 'poza sezonem uprawy',
  poczatkowa: 'faza początkowa',
  rozwoju: 'faza rozwoju',
  srodkowa: 'faza pełnego rozwoju (największe zapotrzebowanie na wodę)',
  koncowa: 'faza dojrzewania',
};

function dayOfYear(monthDay: string, year: number): number {
  const [m, d] = monthDay.split('-').map(Number) as [number, number];
  return (Date.UTC(year, m - 1, d) - Date.UTC(year, 0, 1)) / 86400000;
}

export function cropDay(cropId: CropId, date: string): { kc: number; zr: number; stage: Stage; inSeason: boolean } {
  const c = CROP_PARAMS[cropId];
  const year = Number(date.slice(0, 4));
  const t = dayOfYear(date.slice(5), year);
  const s = dayOfYear(c.start, year);
  const i = dayOfYear(c.iniEnd, year);
  const dv = dayOfYear(c.devEnd, year);
  const md = dayOfYear(c.midEnd, year);
  const h = dayOfYear(c.harvest, year);
  if (t < s || t > h) return { ...OFF_SEASON, stage: 'poza_sezonem', inSeason: false };
  // Korzenie rosną od startu do końca fazy rozwoju, potem mają głębokość maksymalną.
  const zr = t >= dv ? c.zrMax : c.zrStart + ((c.zrMax - c.zrStart) * (t - s)) / Math.max(1, dv - s);
  if (t <= i) return { kc: c.kcIni, zr, stage: 'poczatkowa', inSeason: true };
  if (t <= dv) return { kc: c.kcIni + ((c.kcMid - c.kcIni) * (t - i)) / Math.max(1, dv - i), zr, stage: 'rozwoju', inSeason: true };
  if (t <= md) return { kc: c.kcMid, zr, stage: 'srodkowa', inSeason: true };
  return { kc: c.kcMid + ((c.kcEnd - c.kcMid) * (t - md)) / Math.max(1, h - md), zr, stage: 'koncowa', inSeason: true };
}

/** Część roku zajęta przez kolejne fazy (dzień roku od–do) – do osi czasu w raporcie. */
export function cropPhases(cropId: CropId, year: number): { stage: Exclude<Stage, 'poza_sezonem'>; from: number; to: number }[] {
  const c = CROP_PARAMS[cropId];
  const d = (md: string) => dayOfYear(md, year);
  return [
    { stage: 'poczatkowa', from: d(c.start), to: d(c.iniEnd) },
    { stage: 'rozwoju', from: d(c.iniEnd), to: d(c.devEnd) },
    { stage: 'srodkowa', from: d(c.devEnd), to: d(c.midEnd) },
    { stage: 'koncowa', from: d(c.midEnd), to: d(c.harvest) },
  ];
}

export { dayOfYear };

/** Krótki opis zapotrzebowania na wodę wg Kc. */
export function waterDemand(kc: number): 'wysokie' | 'średnie' | 'niskie' {
  return kc >= 1 ? 'wysokie' : kc >= 0.6 ? 'średnie' : 'niskie';
}

/** Wrażliwość na niedobór wody wg frakcji p (im mniejsze p, tym wcześniej roślina odczuwa stres). */
export function droughtSensitivity(p: number): 'duża' | 'średnia' | 'mała' {
  return p <= 0.4 ? 'duża' : p <= 0.5 ? 'średnia' : 'mała';
}
