import type { Xy } from '../../src/types/terrain';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Xy[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

export function expand(bounds: Bounds, margin: number): Bounds {
  return { minX: bounds.minX - margin, minY: bounds.minY - margin, maxX: bounds.maxX + margin, maxY: bounds.maxY + margin };
}

/** Pole wieloboku (wzór Gaussa), w jednostkach układu do kwadratu. */
export function polygonArea(ring: Xy[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i] as Xy;
    const [x2, y2] = ring[(i + 1) % ring.length] as Xy;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export function pointInPolygon([x, y]: Xy, ring: Xy[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] as Xy;
    const [xj, yj] = ring[j] as Xy;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Zewnętrzny pierścień pierwszego wieloboku z WKT (POLYGON lub MULTIPOLYGON), z opcjonalnym prefiksem SRID=. */
export function parseWktOuterRing(wkt: string): { srid: number | null; ring: Xy[] } {
  const sridMatch = /^SRID=(\d+);/i.exec(wkt.trim());
  const body = wkt.replace(/^SRID=\d+;/i, '').trim();
  const firstRing = /\(\s*\(\s*\(?([^()]+)\)/.exec(body);
  if (!firstRing?.[1]) throw new Error('Nie rozpoznano geometrii działki (WKT)');
  const ring = firstRing[1]
    .split(',')
    .map((pair) => pair.trim().split(/\s+/).map(Number))
    .filter((coords) => coords.length >= 2 && coords.every(Number.isFinite))
    .map((coords) => [coords[0] as number, coords[1] as number] as Xy);
  if (ring.length < 3) throw new Error('Geometria działki ma za mało punktów');
  return { srid: sridMatch?.[1] ? Number(sridMatch[1]) : null, ring };
}

/** Uproszczenie linii (Douglas–Peucker) z tolerancją w metrach. */
export function simplify<T extends Xy>(points: T[], tolerance: number): number[] {
  if (points.length <= 2) return points.map((_, i) => i);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    const [ax, ay] = points[a] as Xy;
    const [bx, by] = points[b] as Xy;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let maxDist = 0;
    let index = -1;
    for (let i = a + 1; i < b; i += 1) {
      const [px, py] = points[i] as Xy;
      const dist = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (index >= 0 && maxDist > tolerance) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => {
    if (k) out.push(i);
  });
  return out;
}
