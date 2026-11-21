/**
 * Parametry upraw do bilansu wody (FAO-56, tab. 12, 17, 22), z kalendarzem dostosowanym do warunków w Polsce.
 * Daty to typowe terminy (miesiąc-dzień); rzeczywiste fazy zależą od roku i odmiany – to założenie modelu.
 */
import type { CropId } from '../../src/types/analysis';

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

export const CROP_PARAMS: Record<CropId, CropParams> = {
  pszenica_ozima: { start: '03-20', iniEnd: '04-10', devEnd: '05-10', midEnd: '06-30', harvest: '07-25', kcIni: 0.7, kcMid: 1.15, kcEnd: 0.3, zrStart: 0.8, zrMax: 1.5, p: 0.55, note: FAO },
  pszenica_jara: { start: '04-01', iniEnd: '04-25', devEnd: '05-30', midEnd: '07-05', harvest: '08-05', kcIni: 0.3, kcMid: 1.15, kcEnd: 0.3, zrStart: 0.3, zrMax: 1.2, p: 0.55, note: FAO },
  jeczmien_jary: { start: '04-01', iniEnd: '04-25', devEnd: '05-25', midEnd: '06-30', harvest: '07-25', kcIni: 0.3, kcMid: 1.15, kcEnd: 0.25, zrStart: 0.3, zrMax: 1.0, p: 0.55, note: FAO },
  zyto: { start: '03-20', iniEnd: '04-10', devEnd: '05-05', midEnd: '06-25', harvest: '07-20', kcIni: 0.7, kcMid: 1.15, kcEnd: 0.3, zrStart: 0.8, zrMax: 1.3, p: 0.55, note: FAO },
  kukurydza_ziarno: { start: '04-25', iniEnd: '05-20', devEnd: '07-05', midEnd: '08-25', harvest: '10-05', kcIni: 0.3, kcMid: 1.2, kcEnd: 0.35, zrStart: 0.3, zrMax: 1.2, p: 0.55, note: FAO },
  kukurydza_kiszonka: { start: '04-25', iniEnd: '05-20', devEnd: '07-05', midEnd: '08-20', harvest: '09-15', kcIni: 0.3, kcMid: 1.2, kcEnd: 0.6, zrStart: 0.3, zrMax: 1.2, p: 0.55, note: FAO },
  rzepak_ozimy: { start: '03-15', iniEnd: '04-01', devEnd: '04-25', midEnd: '06-10', harvest: '07-15', kcIni: 0.5, kcMid: 1.1, kcEnd: 0.35, zrStart: 0.8, zrMax: 1.3, p: 0.6, note: FAO },
  ziemniaki: { start: '04-20', iniEnd: '05-15', devEnd: '06-20', midEnd: '08-10', harvest: '09-10', kcIni: 0.5, kcMid: 1.15, kcEnd: 0.75, zrStart: 0.2, zrMax: 0.5, p: 0.35, note: FAO },
  buraki_cukrowe: { start: '04-10', iniEnd: '05-10', devEnd: '06-20', midEnd: '08-31', harvest: '10-10', kcIni: 0.35, kcMid: 1.2, kcEnd: 0.7, zrStart: 0.3, zrMax: 1.0, p: 0.55, note: FAO },
  uzytki_zielone: { start: '04-01', iniEnd: '04-15', devEnd: '05-01', midEnd: '09-30', harvest: '10-31', kcIni: 0.5, kcMid: 0.95, kcEnd: 0.8, zrStart: 0.5, zrMax: 0.6, p: 0.6, note: FAO },
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
