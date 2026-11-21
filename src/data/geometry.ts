import type { PolygonGeometry } from '../types/analysis';

const METERS_PER_DEG_LAT = 111_320;

/**
 * Buduje wielobok z punktów podanych jako przesunięcia w metrach [wschód, północ]
 * względem punktu odniesienia. Służy tylko do opisu ilustracyjnych geometrii demo.
 */
export function polygonFromOffsets(
  origin: { lat: number; lng: number },
  offsetsMeters: [number, number][],
): PolygonGeometry {
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  const ring = offsetsMeters.map(([east, north]): [number, number] => [
    round6(origin.lng + east / metersPerDegLng),
    round6(origin.lat + north / METERS_PER_DEG_LAT),
  ]);
  const first = ring[0];
  if (first) ring.push([first[0], first[1]]);
  return { type: 'Polygon', coordinates: [ring] };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Granice [minLng, minLat, maxLng, maxLat] dla zbioru wieloboków. */
export function boundsOf(geometries: PolygonGeometry[]): [number, number, number, number] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const geometry of geometries) {
    for (const ring of geometry.coordinates) {
      for (const [lng, lat] of ring) {
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
      }
    }
  }
  return Number.isFinite(minLng) ? [minLng, minLat, maxLng, maxLat] : null;
}

/** Środek prostokąta ograniczającego wielobok (wystarczający do etykiet i markerów). */
export function centerOf(geometry: PolygonGeometry): { lat: number; lng: number } | null {
  const bounds = boundsOf([geometry]);
  if (!bounds) return null;
  return { lng: (bounds[0] + bounds[2]) / 2, lat: (bounds[1] + bounds[3]) / 2 };
}
