/**
 * Teren i satelita w diagnozie: spływ powierzchniowy (metoda SCS-CN z poprawką na nachylenie z NMT), stan roślin
 * z NDMI (Sentinel-2) interpretowany według fazy uprawy oraz porównanie NDMI w wyższej i niższej części pola.
 *
 * Literatura:
 *  - USDA-NRCS, National Engineering Handbook, Part 630, rozdz. 9–10 (metoda Curve Number, tabele CN).
 *  - Williams J.R. (1995), poprawka CN na nachylenie (model EPIC/SWAT): CN2s = (CN3 − CN2)/3 · (1 − 2e^(−13,86·s)) + CN2.
 *  - FAO-56 (Allen i in., 1998), rozdz. 8: do bilansu wchodzi opad pomniejszony o spływ powierzchniowy (P − RO).
 *  - Gao B.-C. (1996), NDWI/NDMI jako wskaźnik zawartości wody w roślinach; NDMI zależy od zwarcia łanu,
 *    dlatego interpretujemy go tylko w fazach, w których łan zakrywa glebę.
 */
import { CROPS } from '../../src/data/crops';
import { cropDay, type Stage } from '../../src/data/cropParams';
import type { CropId } from '../../src/types/analysis';
import type { NdmiResult, TerrainResult, Xy } from '../../src/types/terrain';
import { pointInPolygon } from '../geo/geometry';

// ---------- Spływ powierzchniowy (SCS-CN) ----------

type Hsg = 'A' | 'B' | 'C';
/** CN2 (wilgotność przeciętna, nachylenie ok. 5%) dla grup glebowych A/B/C – NEH-630 tab. 9-1, „dobry stan hydrologiczny”. */
const CN_TABLE: Record<'row' | 'grain' | 'meadow', Record<Hsg, number>> = {
  row: { A: 67, B: 78, C: 85 }, // uprawy rzędowe, siew prosto
  grain: { A: 63, B: 75, C: 83 }, // zboża i rośliny gęstego siewu
  meadow: { A: 30, B: 58, C: 71 }, // łąki, wieloletnie pastewne
};

export function cropCover(cropId: CropId): 'row' | 'grain' | 'meadow' {
  if (cropId === 'uzytki_zielone' || cropId === 'lucerna' || cropId === 'koniczyna') return 'meadow';
  const group = CROPS.find((c) => c.id === cropId)?.group;
  if (group === 'okopowe' || group === 'warzywa' || group === 'owoce' || cropId.startsWith('kukurydza') || cropId === 'slonecznik' || cropId === 'soja') return 'row';
  return 'grain';
}

/** Grupa hydrologiczna gleby z kategorii tekstury (lekka – piaski, średnia – gliny lekkie i pyły, ciężka – gliny ciężkie, iły). */
export function hydrologicGroup(category: 'lekka' | 'średnia' | 'ciężka' | null): Hsg {
  return category === 'lekka' ? 'A' : category === 'ciężka' ? 'C' : 'B';
}

/** CN z poprawką Williamsa na nachylenie (tabele CN odpowiadają ok. 5%). */
export function curveNumber(cropId: CropId, soilCategory: 'lekka' | 'średnia' | 'ciężka' | null, slopeDeg: number): number {
  const cn2 = CN_TABLE[cropCover(cropId)][hydrologicGroup(soilCategory)];
  const cn3 = cn2 * Math.exp(0.00673 * (100 - cn2));
  const s = Math.tan((Math.max(0, slopeDeg) * Math.PI) / 180);
  const cn = ((cn3 - cn2) / 3) * (1 - 2 * Math.exp(-13.86 * s)) + cn2;
  return Math.max(25, Math.min(98, cn));
}

/** Dobowy spływ (mm) z opadu P przy danym CN; Ia = 0,2·S. */
export function runoffMm(p: number, cn: number): number {
  if (p <= 0) return 0;
  const s = 25400 / cn - 254;
  const ia = 0.2 * s;
  return p > ia ? ((p - ia) * (p - ia)) / (p - ia + s) : 0;
}

/** Średnie nachylenie działki, jeśli NMT jest dostępny; w przeciwnym razie typowe 2° (założenie widoczne w raporcie). */
export const DEFAULT_SLOPE_DEG = 2;

// ---------- NDMI ----------

export type SatSignal = 'ok' | 'watch' | 'stress' | 'na';

/** Dlaczego NDMI nie daje się porównać z oczekiwaniem dla uprawy. */
export type NoComparisonReason = 'unavailable' | 'no_scene' | 'low_coverage' | 'stale' | 'phase';

export interface NdmiReading {
  signal: SatSignal;
  /** Powód braku porównania (gdy signal = 'na'). */
  reason: NoComparisonReason | null;
  median: number | null;
  sceneDate: string | null;
  ageDays: number | null;
  coveragePct: number | null;
  /** Próg „dobrego uwodnienia” dla fazy, jeśli faza pozwala interpretować NDMI. */
  okFrom: number | null;
  stressBelow: number | null;
  stage: Stage;
  /** Zdanie dla rolnika: co widać na zdjęciu albo konkretny powód braku porównania. */
  text: string;
  deviatingPct: number | null;
}

/** Ile dni może mieć zdjęcie, żeby opisywało „stan teraz”. */
export const MAX_SCENE_AGE_DAYS = 10;
/** Najmniejsza widoczna część działki, przy której zdjęcie jest użyte (jak w server/sources/sentinel.ts). */
export const MIN_SCENE_COVERAGE_PCT = 60;

/**
 * Progi NDMI dla łanu, który zakrywa glebę: powyżej ok. 0,2 rośliny są dobrze uwodnione, poniżej ok. 0 – wyraźnie
 * brakuje im wody. W fazie rozwoju łan jest rzadszy, więc progi są niższe. W fazie początkowej, dojrzewania i poza
 * sezonem NDMI opisuje głównie glebę lub zasychające rośliny – nie wnioskujemy z niego o stresie.
 * Progi są orientacyjne (literatura dla zbóż i kukurydzy) – dlatego NDMI nie zmienia klasy ryzyka, tylko ją potwierdza
 * albo wskazuje rozbieżność do sprawdzenia w terenie.
 */
export function ndmiThresholds(stage: Stage): { okFrom: number; stressBelow: number } | null {
  if (stage === 'srodkowa') return { okFrom: 0.2, stressBelow: 0.05 };
  if (stage === 'rozwoju') return { okFrom: 0.1, stressBelow: -0.05 };
  return null;
}

export function readNdmi(ndmi: NdmiResult | null, cropId: CropId, evalDate: string, failure: string | null): NdmiReading {
  const stage = cropDay(cropId, evalDate).stage;
  const empty = { stage, okFrom: null, stressBelow: null, deviatingPct: null, median: null, sceneDate: null, ageDays: null, coveragePct: null, signal: 'na' as const };
  if (!ndmi) {
    return { ...empty, reason: 'unavailable', text: failure ?? 'Zdjęcie satelitarne nie zostało pobrane (usługa Sentinel-2 nie odpowiedziała).' };
  }
  if (!ndmi.scene || !ndmi.stats) {
    const best = ndmi.checkedScenes.reduce((m, sc) => Math.max(m, sc.usefulCoveragePct), 0);
    if (ndmi.checkedScenes.length > 0) {
      return {
        ...empty,
        reason: 'low_coverage',
        coveragePct: Math.round(best),
        text: `Na ${ndmi.checkedScenes.length} ${ndmi.checkedScenes.length === 1 ? 'zdjęciu' : 'zdjęciach'} z ostatnich 45 dni działka była widoczna najwyżej w ${Math.round(best)}% (potrzeba co najmniej ${MIN_SCENE_COVERAGE_PCT}%) – zasłaniały ją chmury lub ich cienie.`,
      };
    }
    return { ...empty, reason: 'no_scene', text: 'W ostatnich 45 dniach przed datą analizy nie ma zdjęcia Sentinel-2 obejmującego działkę.' };
  }
  const median = Math.round(ndmi.stats.median * 100) / 100;
  const ageDays = Math.round((Date.parse(evalDate) - Date.parse(ndmi.scene.date)) / 86400000);
  const reading = {
    ...empty,
    median,
    sceneDate: ndmi.scene.date,
    ageDays,
    coveragePct: Math.round(ndmi.scene.usefulCoveragePct),
    deviatingPct: ndmi.stats.deviatingPixelsPct,
  };
  const t = ndmiThresholds(stage);
  if (!t) {
    return {
      ...reading,
      reason: 'phase',
      text: `W ${stageWord(stage)} NDMI (${fmt(median)}) opisuje głównie glebę lub dojrzewające rośliny, a nie ich zaopatrzenie w wodę – nie ma z czym porównać.`,
    };
  }
  if (ageDays > MAX_SCENE_AGE_DAYS) {
    return {
      ...reading,
      okFrom: t.okFrom,
      stressBelow: t.stressBelow,
      reason: 'stale',
      text: `Ostatnie bezchmurne zdjęcie jest sprzed ${ageDays} dni (NDMI ${fmt(median)}) – za stare, żeby opisywało stan roślin na dzień analizy (najwyżej ${MAX_SCENE_AGE_DAYS} dni).`,
    };
  }
  const signal: SatSignal = median >= t.okFrom ? 'ok' : median < t.stressBelow ? 'stress' : 'watch';
  const verdict =
    signal === 'ok'
      ? 'rośliny wyglądają na dobrze uwodnione'
      : signal === 'stress'
        ? 'rośliny wyraźnie tracą wodę'
        : 'rośliny są słabiej uwodnione niż w dobrych warunkach';
  return {
    ...reading,
    okFrom: t.okFrom,
    stressBelow: t.stressBelow,
    signal,
    reason: null,
    text: `Na zdjęciu ${ageText(ageDays)} ${verdict} (NDMI ${fmt(median)}; w ${stageWord(stage)} dobre uwodnienie od ${fmt(t.okFrom)}).`,
  };
}

function stageWord(stage: Stage): string {
  return { poza_sezonem: 'okresie poza sezonem', poczatkowa: 'fazie początkowej', rozwoju: 'fazie rozwoju', srodkowa: 'fazie pełnego rozwoju', koncowa: 'fazie dojrzewania' }[stage];
}

function ageText(days: number): string {
  return days <= 0 ? 'z dnia analizy' : days === 1 ? 'sprzed 1 dnia' : `sprzed ${days} dni`;
}

export function fmt(v: number): string {
  return v.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- Satelita × teren ----------

export interface SlopeContrast {
  upperMedian: number;
  lowerMedian: number;
  reliefM: number;
  pixels: number;
}

/**
 * NDMI w wyższej i niższej części działki (górna i dolna trzecia część wysokości). Wymaga NDMI na siatce terenu.
 * Zwraca null, gdy działka jest płaska (deniwelacja < 1,5 m) albo pikseli jest za mało.
 */
export function slopeContrast(terrain: TerrainResult, ndmi: NdmiResult): SlopeContrast | null {
  const g = terrain.displayGrid;
  if (ndmi.values.length !== g.width * g.height || terrain.elevation.length !== g.width * g.height) return null;
  const ring = terrain.parcel.ring2180 as Xy[];
  const cells: { z: number; v: number }[] = [];
  for (let row = 0; row < g.height; row += 1) {
    for (let col = 0; col < g.width; col += 1) {
      const i = row * g.width + col;
      const z = terrain.elevation[i];
      const v = ndmi.values[i];
      if (z === null || z === undefined || v === null || v === undefined) continue;
      const center: Xy = [g.originX + (col + 0.5) * g.cellSize, g.originY - (row + 0.5) * g.cellSize];
      if (pointInPolygon(center, ring)) cells.push({ z, v });
    }
  }
  if (cells.length < 30) return null;
  const zs = cells.map((c) => c.z).sort((a, b) => a - b);
  const lo = quantile(zs, 0.05);
  const hi = quantile(zs, 0.95);
  const relief = hi - lo;
  if (relief < 1.5) return null;
  const upper = cells.filter((c) => c.z >= lo + (2 * relief) / 3).map((c) => c.v);
  const lower = cells.filter((c) => c.z <= lo + relief / 3).map((c) => c.v);
  if (upper.length < 10 || lower.length < 10) return null;
  return {
    upperMedian: Math.round(median(upper) * 100) / 100,
    lowerMedian: Math.round(median(lower) * 100) / 100,
    reliefM: Math.round(relief * 10) / 10,
    pixels: cells.length,
  };
}

function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i]!;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return quantile(s, 0.5);
}
