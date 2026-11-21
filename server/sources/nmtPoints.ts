/**
 * NMT z usługi wysokości punktów GUGiK (`services.gugik.gov.pl/nmt`, GetHByPointList).
 *
 * Usługa zwraca wysokość z NMT 1 m dla listy punktów – do 1000 punktów na zapytanie, w ok. 1 s.
 * Siatkę wokół działki próbkujemy co 2–15 m (tak, by wyszło do ok. 7 tys. punktów), wysyłając
 * najwyżej 3 zapytania naraz: przy większej liczbie usługa zwraca punkty bez wysokości.
 * Usługa przetwarza ok. 1300 punktów/s (więcej równoległych zapytań nie przyspiesza), więc to ok. 4–6 s
 * zamiast 1–2 minut usługi WCS.
 *
 * Konwencja usługi: x = północ, y = wschód (geodezyjna), odpowiedź „x y h” w kolejności zapytania.
 */
import type { GridSpec } from '../../src/types/terrain';
import type { Bounds } from '../geo/geometry';
import type { DemRaster } from './nmt';
import { NmtError } from './nmt';
import { errorText } from './uldk';

export const NMT_POINTS_URL = 'https://services.gugik.gov.pl/nmt/';
const BATCH = 1000;
const CONCURRENCY = 3;
const TARGET_POINTS = 7_000;
const MAX_MISSING_SHARE = 0.05;
const REQUEST_TIMEOUT_MS = 15_000;

/** Krok siatki: najmniejszy z 2, 3, 4, 5, 6, 8, 10, 12, 15 m, przy którym liczba punktów nie przekracza celu. */
export function pointStep(b: Bounds): number {
  const area = (b.maxX - b.minX) * (b.maxY - b.minY);
  for (const step of [2, 3, 4, 5, 6, 8, 10, 12, 15]) {
    if (area / (step * step) <= TARGET_POINTS) return step;
  }
  return 15;
}

/** Siatka, której środki komórek leżą w całkowitych współrzędnych (usługa dostaje liczby całkowite). */
export function pointGrid(b: Bounds, step: number): { grid: GridSpec; points: [number, number][] } {
  const x0 = Math.round(b.minX);
  const y0 = Math.round(b.maxY);
  const width = Math.max(2, Math.ceil((b.maxX - b.minX) / step));
  const height = Math.max(2, Math.ceil((b.maxY - b.minY) / step));
  const points: [number, number][] = [];
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) points.push([x0 + c * step, y0 - r * step]);
  }
  return {
    grid: { width, height, cellSize: step, originX: x0 - step / 2, originY: y0 + step / 2 },
    points,
  };
}

/** Odczytuje odpowiedź „x y h,x y h,…”; zwraca wysokości w kolejności punktów (NaN, gdy brak). */
export function parsePointList(text: string, points: [number, number][]): Float64Array {
  const out = new Float64Array(points.length).fill(Number.NaN);
  const byKey = new Map<string, number>();
  for (const item of text.split(',')) {
    const parts = item.trim().split(/\s+/);
    if (parts.length !== 3) continue;
    const h = Number(parts[2]);
    if (Number.isFinite(h) && h > -1000 && h < 3000) byKey.set(`${Number(parts[0])} ${Number(parts[1])}`, h);
  }
  points.forEach(([e, n], i) => {
    const h = byKey.get(`${n} ${e}`);
    if (h !== undefined) out[i] = h;
  });
  return out;
}

/** Usługa obsługuje najwyżej 3 jednoczesne zapytania – limit jest wspólny dla wszystkich pobieranych działek. */
let active = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  if (active >= CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await run();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

/** Nagłówki jak w przeglądarce – usługi GUGiK odpowiadają na nie najstabilniej. */
const HEADERS = {
  Accept: '*/*',
  'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
};

async function fetchBatch(points: [number, number][]): Promise<Float64Array> {
  const list = points.map(([e, n]) => `${n} ${e}`).join(',');
  let last: Float64Array = new Float64Array(points.length).fill(Number.NaN);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * attempt));
    try {
      const text = await withSlot(async () => {
        const response = await fetch(NMT_POINTS_URL, {
          method: 'POST',
          headers: HEADERS,
          body: new URLSearchParams({ request: 'GetHByPointList', list }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        return response.ok ? response.text() : null;
      });
      if (text === null) continue;
      last = parsePointList(text, points);
      // Przeciążona usługa odsyła współrzędne bez wysokości – wtedy ponawiamy.
      if (last.some((v) => !Number.isNaN(v))) return last;
    } catch {
      // ponów
    }
  }
  return last;
}

export async function fetchNmtPoints(bounds: Bounds): Promise<DemRaster> {
  const started = Date.now();
  const step = pointStep(bounds);
  const { grid, points } = pointGrid(bounds, step);
  const values = new Float64Array(points.length).fill(Number.NaN);
  const batches: number[] = [];
  for (let i = 0; i < points.length; i += BATCH) batches.push(i);

  let next = 0;
  let failed = false;
  try {
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < batches.length && !failed) {
          const start = batches[next++] as number;
          const batch = await fetchBatch(points.slice(start, start + BATCH));
          // Paczka bez żadnej wysokości po 3 próbach – usługa nie działa; nie męczymy jej resztą paczek.
          if (batch.every((v) => Number.isNaN(v))) failed = true;
          values.set(batch, start);
        }
      }),
    );
  } catch (error) {
    throw new NmtError(`Usługa wysokości GUGiK: ${errorText(error)}`);
  }

  let missing = 0;
  for (const v of values) if (Number.isNaN(v)) missing += 1;
  if (missing / values.length > MAX_MISSING_SHARE) {
    throw new NmtError(`Usługa wysokości GUGiK zwróciła ${Math.round((100 * missing) / values.length)}% punktów bez wysokości.`);
  }

  return {
    values,
    grid,
    source: {
      name: 'Numeryczny Model Terenu (NMT), wysokości normalne',
      provider: 'GUGiK – usługa wysokości punktów (services.gugik.gov.pl/nmt, NMT 1 m)',
      url: NMT_POINTS_URL,
      origin: 'observed',
      retrievedAt: new Date().toISOString(),
      observationDate: null,
      resolutionM: step,
      durationMs: Date.now() - started,
      notes: [
        `Siatka ${grid.width} × ${grid.height} punktów co ${step} m, wysokości odczytane z NMT o rozdzielczości 1 m.`,
        `${batches.length} zapytań po maks. ${BATCH} punktów; wysokości z dokładnością 0,1 m.`,
        missing > 0 ? `${missing} punktów bez wysokości (pominięte w analizie).` : 'Wszystkie punkty mają wysokość.',
        'Data pomiaru lotniczego (LiDAR) różni się między obszarami; usługa jej nie zwraca.',
      ],
    },
  };
}
