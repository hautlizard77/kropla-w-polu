/**
 * Analiza topografii działki: spływ, miejsca jego koncentracji, zastoiska, nachylenie i obszar do sprawdzenia
 * pod kątem retencji. Wejście: NMT w EPSG:2180 obejmujący działkę z otoczeniem.
 */
import type {
  ConcentrationPoint,
  Depression,
  FlowArrow,
  FlowLine,
  GridSpec,
  ParcelInfo,
  RetentionCandidate,
  SlopeClass,
  SourceInfo,
  TerrainResult,
  Xy,
} from '../../src/types/terrain';
import { boundsOf, pointInPolygon, simplify } from '../geo/geometry';
import {
  DIR_NODATA,
  DX,
  DY,
  accumulate,
  downstreamIndex,
  fillDepressions,
  findDepressions,
  flowDirections,
  slopeDegrees,
  type Raster,
} from './hydrology';

export const TERRAIN_VERSION = 3;
const MAX_ANALYSIS_CELLS = 1_600_000;
const DISPLAY_MAX_SIDE = 220;
const ARROWS_ACROSS = 18;
const MIN_DEPRESSION_DEPTH_M = 0.15;
const MIN_DEPRESSION_AREA_M2 = 40;
const SLOPE_BREAKS = [2, 5, 10, 15];

export interface TerrainInput {
  parcel: ParcelInfo;
  values: Float64Array;
  grid: GridSpec;
  demSource: SourceInfo;
}

export function computeTerrain(input: TerrainInput): Omit<TerrainResult, 'cached' | 'timings'> {
  const { parcel } = input;
  const analysis = aggregate(input.values, input.grid, Math.max(1, Math.ceil(Math.sqrt((input.grid.width * input.grid.height) / MAX_ANALYSIS_CELLS))));
  const grid = analysis.grid;
  const raster: Raster = { width: grid.width, height: grid.height, cellSize: grid.cellSize, values: analysis.values };
  const n = grid.width * grid.height;
  const cellArea = grid.cellSize * grid.cellSize;

  const filledEps = fillDepressions(raster, 1e-5);
  const filledFlat = fillDepressions(raster, 0);
  const dir = flowDirections(raster, filledEps);
  const { accumulation, truncated } = accumulate(raster, dir);
  const slope = slopeDegrees(raster);

  const center = (i: number): Xy => {
    const x = i % grid.width;
    const y = (i - x) / grid.width;
    return [grid.originX + (x + 0.5) * grid.cellSize, grid.originY - (y + 0.5) * grid.cellSize];
  };

  // Maska działki na siatce analizy.
  const inParcel = new Uint8Array(n);
  const pb = boundsOf(parcel.ring2180);
  let parcelCells = 0;
  for (let i = 0; i < n; i += 1) {
    const p = center(i);
    if (p[0] < pb.minX || p[0] > pb.maxX || p[1] < pb.minY || p[1] > pb.maxY) continue;
    if (pointInPolygon(p, parcel.ring2180) && dir[i] !== DIR_NODATA) {
      inParcel[i] = 1;
      parcelCells += 1;
    }
  }

  // Linie spływu: komórki z akumulacją powyżej progu.
  // Próg linii spływu: co najmniej 1000 m² zlewni i 1,5% powierzchni działki (najwyżej 1 ha) – pokazujemy skupiony spływ, nie każdą bruzdę.
  const parcelAreaM2 = parcel.areaHa * 10000;
  let threshold = Math.max(1000, 20 * cellArea, Math.min(10000, 0.015 * parcelAreaM2));
  let channelCount = 0;
  for (let i = 0; i < n; i += 1) if ((accumulation[i] as number) >= threshold) channelCount += 1;
  if (channelCount > 60000) {
    threshold = percentile(accumulation, 1 - 60000 / n);
  }
  const flowLines = traceChannels(raster, dir, accumulation, threshold, center);
  const maxAccumulationM2 = flowLines.reduce((max, line) => Math.max(max, ...line.accumulationM2), threshold);

  // Miejsca koncentracji spływu w działce.
  const concentration = concentrationPoints(raster, dir, accumulation, truncated, inParcel, threshold, center);

  // Zastoiska.
  const depressionCells = findDepressions(
    raster,
    filledFlat,
    accumulation,
    MIN_DEPRESSION_DEPTH_M,
    Math.max(3, Math.ceil(MIN_DEPRESSION_AREA_M2 / cellArea)),
  );
  const nearParcel = (cells: number[]): { inside: number; near: boolean } => {
    let inside = 0;
    let near = false;
    const margin = 30;
    for (const c of cells) {
      if (inParcel[c]) inside += 1;
      const p = center(c);
      if (p[0] >= pb.minX - margin && p[0] <= pb.maxX + margin && p[1] >= pb.minY - margin && p[1] <= pb.maxY + margin) near = true;
    }
    return { inside, near };
  };
  const depressions: Depression[] = [];
  const collectors = new Map<number, number>();
  const depressionMaskAnalysis = new Uint8Array(n);
  for (const item of depressionCells) {
    const { inside, near } = nearParcel(item.cells);
    if (!near) continue;
    let sx = 0;
    let sy = 0;
    for (const c of item.cells) {
      depressionMaskAnalysis[c] = 1;
      const p = center(c);
      sx += p[0];
      sy += p[1];
    }
    collectors.set(item.id, item.collector);
    depressions.push({
      id: item.id,
      centroid: [sx / item.cells.length, sy / item.cells.length],
      areaM2: item.cells.length * cellArea,
      maxDepthM: item.maxDepth,
      volumeM3: item.volume,
      contributingAreaM2: accumulation[item.collector] as number,
      insideParcel: inside / item.cells.length >= 0.3,
    });
  }
  depressions.sort((a, b) => b.volumeM3 - a.volumeM3);
  const keptDepressions = depressions.slice(0, 40);

  // Dopływ spoza rastra.
  let truncatedParcel = 0;
  for (let i = 0; i < n; i += 1) if (inParcel[i] && truncated[i]) truncatedParcel += 1;
  const truncatedPct = parcelCells > 0 ? (100 * truncatedParcel) / parcelCells : 0;

  // Nachylenie w działce.
  const classCounts = [0, 0, 0, 0, 0];
  let slopeSum = 0;
  let slopeMax = 0;
  let slopeCount = 0;
  for (let i = 0; i < n; i += 1) {
    if (!inParcel[i]) continue;
    const s = slope[i] as number;
    if (Number.isNaN(s)) continue;
    slopeSum += s;
    slopeMax = Math.max(slopeMax, s);
    slopeCount += 1;
    const cls = slopeClassOf(s);
    classCounts[cls] = (classCounts[cls] as number) + 1;
  }

  // Siatka wyświetlania.
  const factor = Math.max(1, Math.ceil(Math.max(grid.width, grid.height) / DISPLAY_MAX_SIDE));
  const display = aggregate(analysis.values, grid, factor);
  const slopeDisplay = aggregate(slope, grid, factor).values;
  const depressionDisplay = aggregateMax(depressionMaskAnalysis, grid, factor);
  const elevation: (number | null)[] = Array.from(display.values, (v) => (Number.isNaN(v) ? null : round(v, 2)));
  const finite = elevation.filter((v): v is number => v !== null);
  let minE = Infinity;
  let maxE = -Infinity;
  for (const v of finite) {
    if (v < minE) minE = v;
    if (v > maxE) maxE = v;
  }
  const elevationRange: [number, number] = finite.length > 0 ? [minE, maxE] : [0, 0];

  const retentionCandidate = chooseRetention(
    keptDepressions,
    collectors,
    raster,
    dir,
    accumulation,
    truncated,
    inParcel,
    slope,
    threshold,
    center,
  );

  const sources = [parcel.source, input.demSource];
  return {
    version: TERRAIN_VERSION,
    parcelId: parcel.id,
    origin: parcel.origin === 'demo' || input.demSource.origin === 'demo' ? 'demo' : 'observed',
    parcel,
    analysisGrid: grid,
    displayGrid: display.grid,
    elevation,
    elevationRange,
    slopeDeg: Array.from(slopeDisplay, (v) => (Number.isNaN(v) ? null : round(v, 1))),
    slopeClass: Array.from(slopeDisplay, (v) => (Number.isNaN(v) ? null : slopeClassOf(v))),
    depressionMask: Array.from(depressionDisplay),
    flowLines,
    maxAccumulationM2,
    arrows: flowArrows(raster, dir, slope, center),
    concentration,
    depressions: keptDepressions.map((d) => ({
      ...d,
      areaM2: round(d.areaM2, 0),
      maxDepthM: round(d.maxDepthM, 2),
      volumeM3: round(d.volumeM3, 0),
      contributingAreaM2: round(d.contributingAreaM2, 0),
    })),
    inflowBeyondRaster: {
      affectsParcel: truncatedParcel > 0,
      parcelCellsPct: round(truncatedPct, 1),
      note:
        truncatedParcel > 0
          ? `Do ${round(truncatedPct, 0)}% powierzchni działki może dopływać woda spoza pobranego fragmentu NMT – rzeczywisty obszar dopływu jest większy niż w analizie.`
          : 'Obszar dopływu do działki mieści się w pobranym fragmencie NMT.',
    },
    erosion: {
      soilDataAvailable: false,
      basis:
        'Brak danych glebowych w tej wersji – warstwa pokazuje samo nachylenie terenu (klasy: do 2°, 2–5°, 5–10°, 10–15°, ponad 15°).',
      parcelSlopeMeanDeg: slopeCount > 0 ? round(slopeSum / slopeCount, 1) : 0,
      parcelSlopeMaxDeg: round(slopeMax, 1),
      parcelClassPct: classCounts.map((c) => (slopeCount > 0 ? round((100 * c) / slopeCount, 1) : 0)),
    },
    retentionCandidate,
    sources,
    computedAt: new Date().toISOString(),
    method:
      `Wypełnienie zagłębień Priority-Flood, kierunek spływu D8, akumulacja spływu; siatka analizy ${round(grid.cellSize, 2)} m ` +
      `(${grid.width} × ${grid.height}), próg linii spływu ${Math.round(threshold)} m² zlewni.`,
    limitations: [
      'Analiza topografii – nie uwzględnia opadu, infiltracji, uprawy ani drenażu.',
      'Kierunek D8 prowadzi wodę do jednego sąsiada; rozpraszanie spływu na stokach jest pominięte.',
      'Przepusty, rowy pod drogami i drenaż podziemny nie są widoczne w NMT – mogą zmieniać rzeczywisty odpływ.',
      `Zastoiska to zagłębienia głębsze niż ${MIN_DEPRESSION_DEPTH_M} m i większe niż ${MIN_DEPRESSION_AREA_M2} m² – nie liczymy głębokości zalania.`,
    ],
    // Uzupełniane przez warstwę API.
  } as Omit<TerrainResult, 'cached' | 'timings'>;
}

function slopeClassOf(deg: number): SlopeClass {
  let cls = 0;
  for (const limit of SLOPE_BREAKS) if (deg >= limit) cls += 1;
  return cls as SlopeClass;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function percentile(values: Float64Array, q: number): number {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))] as number;
}

/** Uśrednienie siatki blokami factor × factor (z pominięciem braków). */
export function aggregate(values: Float64Array, grid: GridSpec, factor: number): { values: Float64Array; grid: GridSpec } {
  if (factor <= 1) return { values, grid };
  const width = Math.ceil(grid.width / factor);
  const height = Math.ceil(grid.height / factor);
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let yy = y * factor; yy < Math.min(grid.height, (y + 1) * factor); yy += 1) {
        for (let xx = x * factor; xx < Math.min(grid.width, (x + 1) * factor); xx += 1) {
          const v = values[yy * grid.width + xx] as number;
          if (!Number.isNaN(v)) {
            sum += v;
            count += 1;
          }
        }
      }
      out[y * width + x] = count > 0 ? sum / count : Number.NaN;
    }
  }
  return { values: out, grid: { width, height, cellSize: grid.cellSize * factor, originX: grid.originX, originY: grid.originY } };
}

function aggregateMax(values: Uint8Array, grid: GridSpec, factor: number): Uint8Array {
  const width = Math.ceil(grid.width / factor);
  const height = Math.ceil(grid.height / factor);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (values[y * grid.width + x]) out[Math.floor(y / factor) * width + Math.floor(x / factor)] = 1;
    }
  }
  return out;
}

function traceChannels(
  raster: Raster,
  dir: Int8Array,
  accumulation: Float64Array,
  threshold: number,
  center: (i: number) => Xy,
): FlowLine[] {
  const { width } = raster;
  const n = dir.length;
  const isChannel = (i: number) => (accumulation[i] as number) >= threshold;
  // Liczba dopływów-kanałów do każdej komórki – źródła linii to kanały bez kanałowych dopływów.
  const channelInflow = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const d = dir[i] as number;
    if (d >= 0 && isChannel(i)) {
      const j = downstreamIndex(i, d, width);
      channelInflow[j] = (channelInflow[j] as number) + 1;
    }
  }
  const visited = new Uint8Array(n);
  const lines: FlowLine[] = [];
  const starts: number[] = [];
  for (let i = 0; i < n; i += 1) if (isChannel(i) && channelInflow[i] === 0) starts.push(i);
  // Najpierw linie z największym ujściem, żeby przy limicie zostały najważniejsze.
  for (const start of starts) {
    const points: Xy[] = [];
    const acc: number[] = [];
    let c = start;
    for (;;) {
      points.push(center(c));
      acc.push(accumulation[c] as number);
      if (visited[c]) break;
      visited[c] = 1;
      const d = dir[c] as number;
      if (d < 0) break;
      c = downstreamIndex(c, d, width);
    }
    if (points.length < 2) continue;
    const keep = simplify(points, raster.cellSize * 0.6);
    lines.push({
      points: keep.map((k) => points[k] as Xy).map(([x, y]) => [round(x, 1), round(y, 1)] as Xy),
      accumulationM2: keep.map((k) => Math.round(acc[k] as number)),
    });
  }
  const peak = (values: number[]) => values.reduce((m, v) => (v > m ? v : m), -Infinity);
  lines.sort((a, b) => peak(b.accumulationM2) - peak(a.accumulationM2));
  return lines.slice(0, 1500);
}

function concentrationPoints(
  raster: Raster,
  dir: Int8Array,
  accumulation: Float64Array,
  truncated: Uint8Array,
  inParcel: Uint8Array,
  threshold: number,
  center: (i: number) => Xy,
): ConcentrationPoint[] {
  const { width } = raster;
  const outlets: number[] = [];
  let maxInside = -1;
  for (let i = 0; i < dir.length; i += 1) {
    if (!inParcel[i]) continue;
    if (maxInside < 0 || (accumulation[i] as number) > (accumulation[maxInside] as number)) maxInside = i;
    if ((accumulation[i] as number) < threshold) continue;
    const d = dir[i] as number;
    if (d < 0 || !inParcel[downstreamIndex(i, d, width)]) outlets.push(i);
  }
  outlets.sort((a, b) => (accumulation[b] as number) - (accumulation[a] as number));
  const chosen = outlets.slice(0, 3);
  const points: ConcentrationPoint[] = chosen.map((i) => ({
    at: center(i),
    accumulationM2: Math.round(accumulation[i] as number),
    kind: 'outlet',
    truncated: truncated[i] === 1,
  }));
  if (maxInside >= 0 && !chosen.includes(maxInside) && (accumulation[maxInside] as number) >= threshold) {
    points.push({
      at: center(maxInside),
      accumulationM2: Math.round(accumulation[maxInside] as number),
      kind: 'max_inside',
      truncated: truncated[maxInside] === 1,
    });
  }
  return points;
}

function flowArrows(raster: Raster, dir: Int8Array, slope: Float64Array, center: (i: number) => Xy): FlowArrow[] {
  const { width, height } = raster;
  const step = Math.max(1, Math.ceil(Math.max(width, height) / ARROWS_ACROSS));
  const arrows: FlowArrow[] = [];
  for (let by = 0; by < height; by += step) {
    for (let bx = 0; bx < width; bx += step) {
      let vx = 0;
      let vy = 0;
      let slopeSum = 0;
      let count = 0;
      for (let y = by; y < Math.min(height, by + step); y += 1) {
        for (let x = bx; x < Math.min(width, bx + step); x += 1) {
          const i = y * width + x;
          const d = dir[i] as number;
          if (d < 0) continue;
          const len = Math.hypot(DX[d] as number, DY[d] as number);
          vx += (DX[d] as number) / len;
          vy -= (DY[d] as number) / len;
          slopeSum += slope[i] as number;
          count += 1;
        }
      }
      if (count === 0) continue;
      const magnitude = Math.hypot(vx, vy);
      // Pomijamy płaskie bloki i bloki bez wyraźnego kierunku.
      if (magnitude / count < 0.35 || slopeSum / count < 0.3) continue;
      const cx = Math.min(width - 1, bx + Math.floor(step / 2));
      const cy = Math.min(height - 1, by + Math.floor(step / 2));
      const at = center(cy * width + cx);
      arrows.push({ at: [round(at[0], 1), round(at[1], 1)], dir: [round(vx / magnitude, 3), round(vy / magnitude, 3)] });
    }
  }
  return arrows;
}

/** Komórki, z których woda spływa do komórki `target` (przeszukiwanie w górę spływu). */
function upstream(raster: Raster, dir: Int8Array, target: number): number[] {
  const { width, height } = raster;
  const out: number[] = [target];
  const seen = new Uint8Array(dir.length);
  seen[target] = 1;
  for (let k = 0; k < out.length; k += 1) {
    const c = out[k] as number;
    const cx = c % width;
    const cy = (c - cx) / width;
    for (let d = 0; d < 8; d += 1) {
      const nx = cx + (DX[d] as number);
      const ny = cy + (DY[d] as number);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (seen[ni]) continue;
      const nd = dir[ni] as number;
      if (nd >= 0 && downstreamIndex(ni, nd, width) === c) {
        seen[ni] = 1;
        out.push(ni);
      }
    }
  }
  return out;
}

function formatHa(m2: number): string {
  const ha = m2 / 10000;
  return ha >= 10 ? `${Math.round(ha)} ha` : `${ha.toLocaleString('pl-PL', { maximumFractionDigits: ha < 1 ? 2 : 1 })} ha`;
}

function squareRing([x, y]: Xy, half: number): Xy[] {
  return [
    [x - half, y - half],
    [x + half, y - half],
    [x + half, y + half],
    [x - half, y + half],
  ];
}

function chooseRetention(
  depressions: Depression[],
  collectors: Map<number, number>,
  raster: Raster,
  dir: Int8Array,
  accumulation: Float64Array,
  truncated: Uint8Array,
  inParcel: Uint8Array,
  slope: Float64Array,
  threshold: number,
  center: (i: number) => Xy,
): RetentionCandidate | null {
  const cellArea = raster.cellSize * raster.cellSize;
  const indexAt = ([x, y]: Xy): number => {
    const col = Math.min(raster.width - 1, Math.max(0, Math.floor((x - center(0)[0]) / raster.cellSize + 0.5)));
    const row = Math.min(raster.height - 1, Math.max(0, Math.floor((center(0)[1] - y) / raster.cellSize + 0.5)));
    return row * raster.width + col;
  };
  const upstreamSplit = (target: number) => {
    const cells = upstream(raster, dir, target);
    let outside = 0;
    for (const c of cells) if (!inParcel[c]) outside += 1;
    return { total: cells.length * cellArea, outside: outside * cellArea };
  };

  const scored = depressions
    .filter((d) => d.contributingAreaM2 >= Math.max(300, 50 * cellArea))
    .map((d) => ({ d, score: d.contributingAreaM2 * Math.sqrt(d.maxDepthM) * (d.insideParcel ? 1 : 0.6) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.d;
  if (best) {
    const collector = collectors.get(best.id) ?? indexAt(best.centroid);
    const split = upstreamSplit(collector);
    const half = Math.max(10, Math.sqrt(best.areaM2) / 2 + raster.cellSize);
    const reasons = [
      `Obniżenie terenu o głębokości do ${best.maxDepthM.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} m i powierzchni ok. ${Math.round(best.areaM2)} m² – po opadach woda może tu stagnować.`,
      `Spływa do niego woda z ok. ${formatHa(split.total)}` +
        (split.outside > 0 ? `, w tym ok. ${formatHa(split.outside)} spoza działki.` : '.'),
    ];
    if (truncated[collector]) reasons.push('Część obszaru dopływu leży poza pobranym fragmentem NMT – zlewnia może być większa.');
    reasons.push('Do sprawdzenia w terenie: czy woda rzeczywiście tu stoi, rodzaj gleby, drenaż i zgodność z przepisami wodnymi.');
    return {
      kind: 'depression',
      at: best.centroid,
      ring: squareRing(best.centroid, half),
      title: best.insideParcel ? 'Obniżenie terenu w obrębie działki' : 'Obniżenie terenu przy granicy działki',
      reasons,
      metrics: [
        { label: 'Głębokość zagłębienia', value: `${best.maxDepthM.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} m` },
        { label: 'Powierzchnia zagłębienia', value: `${Math.round(best.areaM2)} m²` },
        { label: 'Objętość zagłębienia (topograficzna)', value: `${Math.round(best.volumeM3)} m³` },
        { label: 'Obszar dopływu', value: formatHa(split.total) },
        { label: 'w tym spoza działki', value: formatHa(split.outside) },
      ],
    };
  }

  // Bez zagłębień: najsilniejsze skupienie spływu w działce na możliwie płaskim terenie.
  let pick = -1;
  for (let i = 0; i < dir.length; i += 1) {
    if (!inParcel[i] || (accumulation[i] as number) < threshold) continue;
    const s = slope[i] as number;
    const score = (accumulation[i] as number) / (1 + Math.max(0, s - 1));
    if (pick < 0) pick = i;
    else {
      const ps = slope[pick] as number;
      if (score > (accumulation[pick] as number) / (1 + Math.max(0, ps - 1))) pick = i;
    }
  }
  if (pick < 0) return null;
  const split = upstreamSplit(pick);
  const at = center(pick);
  const s = slope[pick] as number;
  const reasons = [
    `Spływ skupia się tu z ok. ${formatHa(accumulation[pick] as number)}` +
      (split.outside > 0 ? `, w tym ok. ${formatHa(split.outside)} spoza działki.` : '.'),
    `Nachylenie w tym miejscu wynosi ok. ${s.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}° – ${
      s < 3 ? 'woda zwalnia, co sprzyja jej zatrzymaniu.' : 'woda płynie szybko; spowolnienie odpływu wymaga przeszkody (np. pasa zadarnienia).'
    }`,
    'Nie znaleziono zagłębienia z większym obszarem dopływu – wskazujemy miejsce skupienia spływu.',
  ];
  if (truncated[pick]) reasons.push('Część obszaru dopływu leży poza pobranym fragmentem NMT – zlewnia może być większa.');
  reasons.push('Do sprawdzenia w terenie: ślady spływu i erozji po ulewach, rodzaj gleby, drenaż.');
  return {
    kind: 'flow_concentration',
    at,
    ring: squareRing(at, Math.max(12, raster.cellSize * 6)),
    title: 'Miejsce skupienia spływu',
    reasons,
    metrics: [
      { label: 'Obszar dopływu', value: formatHa(accumulation[pick] as number) },
      { label: 'Nachylenie w miejscu', value: `${s.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}°` },
    ],
  };
}
