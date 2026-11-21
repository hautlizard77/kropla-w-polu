/**
 * Tryb demonstracyjny: syntetyczny teren i NDMI dla trzech działek z przykładów.
 * Dane są ilustracyjne i zawsze oznaczone jako `demo` – nie pochodzą z NMT ani z Sentinel-2.
 * Służą do pokazu i testów bez dostępu do usług zewnętrznych.
 */
import type { GridSpec, NdmiResult, ParcelInfo, SourceInfo, Xy } from '../../src/types/terrain';
import { boundsOf, expand, pointInPolygon } from '../geo/geometry';
import type { DemRaster } from '../sources/nmt';
import { MIN_COVERAGE_PCT, NDMI_VERSION, ndmiLimitations } from '../sources/sentinel';

type DemoKind = 'kujawy' | 'lubelskie' | 'wielkopolska';

function kindOf(parcelId: string): DemoKind {
  if (parcelId.startsWith('0407')) return 'kujawy';
  if (parcelId.startsWith('0620')) return 'lubelskie';
  return 'wielkopolska';
}

/** Deterministyczny szum (bez Math.random) – ten sam teren przy każdym uruchomieniu. */
function noise(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function demoSource(name: string, resolutionM: number | null): SourceInfo {
  return {
    name,
    provider: 'Kropla w Polu – tryb demonstracyjny',
    url: null,
    origin: 'demo',
    retrievedAt: null,
    observationDate: null,
    resolutionM,
    durationMs: null,
    notes: ['Dane syntetyczne do pokazu – nie pochodzą z pomiarów.'],
  };
}

export function demoDem(parcel: ParcelInfo): DemRaster {
  const kind = kindOf(parcel.id);
  const b = expand(boundsOf(parcel.ring2180), 150);
  const cellSize = 1;
  const originX = Math.floor(b.minX);
  const originY = Math.ceil(b.maxY);
  const width = Math.ceil(b.maxX - originX);
  const height = Math.ceil(originY - b.minY);
  const pb = boundsOf(parcel.ring2180);
  const midX = (pb.minX + pb.maxX) / 2;
  const values = new Float64Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const x = originX + col + 0.5;
      const y = originY - row - 0.5;
      const rx = x - midX;
      const ry = y - pb.minY;
      let z: number;
      if (kind === 'kujawy') {
        // Stok ok. 1,5% na południe, rów wzdłuż południowej granicy, łagodna niecka w dolnej części działki.
        z = 92 + ry * 0.015 + Math.sin(rx / 60) * 0.35;
        const ditch = Math.abs(y - (pb.minY + 6));
        if (ditch < 3) z -= 0.9 * (1 - ditch / 3);
        const d = Math.hypot(rx + 90, ry - 45);
        if (d < 22) z -= 0.45 * (1 - d / 22) ** 1.5;
      } else if (kind === 'lubelskie') {
        // Stok ok. 4% na północ z wyraźnym żlebem w osi działki.
        z = 230 - ry * 0.04 + Math.abs(rx) * 0.012 - Math.exp(-((rx / 14) ** 2)) * 0.6;
      } else {
        // Prawie płaski teren (0,3% na wschód) z płytkim obniżeniem.
        z = 101 - rx * 0.003 + Math.sin(ry / 45) * 0.15;
        const d = Math.hypot(rx - 120, ry - 110);
        if (d < 30) z -= 0.3 * (1 - d / 30);
      }
      values[row * width + col] = z + (noise(col, row) - 0.5) * 0.04;
    }
  }
  return {
    values,
    grid: { width, height, cellSize, originX, originY },
    source: {
      ...demoSource('Teren syntetyczny (tryb demonstracyjny)', cellSize),
      notes: ['Syntetyczny model terenu 1 m do pokazu – nie pochodzi z NMT Geoportalu.'],
    },
  };
}

export function demoNdmi(parcel: ParcelInfo, analysisDate: string, displayGrid: GridSpec): Omit<NdmiResult, 'cached'> {
  const kind = kindOf(parcel.id);
  const sceneDate = kind === 'kujawy' ? '2019-06-24' : kind === 'lubelskie' ? '2021-05-16' : '2024-08-06';
  const pb = boundsOf(parcel.ring2180);
  const values: (number | null)[] = [];
  const parcelValues: number[] = [];
  const cellCenters: Xy[] = [];
  for (let row = 0; row < displayGrid.height; row += 1) {
    for (let col = 0; col < displayGrid.width; col += 1) {
      const p: Xy = [displayGrid.originX + (col + 0.5) * displayGrid.cellSize, displayGrid.originY - (row + 0.5) * displayGrid.cellSize];
      cellCenters.push(p);
      // Piksele 20 m: wartości stałe w kwadratach 20 × 20 m.
      const gx = Math.floor(p[0] / 20);
      const gy = Math.floor(p[1] / 20);
      const ry = (p[1] - pb.minY) / Math.max(1, pb.maxY - pb.minY);
      let v: number;
      if (kind === 'kujawy') v = 0.02 + ry * -0.05 + (1 - ry) * 0.12 + (noise(gx, gy) - 0.5) * 0.05;
      else if (kind === 'lubelskie') v = 0.3 + (noise(gx, gy) - 0.5) * 0.04;
      else v = 0.25 + (noise(gx, gy) - 0.5) * 0.05;
      values.push(Math.round(v * 1000) / 1000);
      if (pointInPolygon(p, parcel.ring2180)) parcelValues.push(v);
    }
  }
  const base = {
    version: NDMI_VERSION,
    parcelId: parcel.id,
    analysisDate,
    origin: 'demo' as const,
    resolutionM: 20 as const,
    minCoveragePct: MIN_COVERAGE_PCT,
    sources: [{ ...demoSource('NDMI syntetyczne (tryb demonstracyjny)', 20), observationDate: sceneDate }],
    timings: [],
    limitations: ndmiLimitations(),
  };

  if (kind === 'wielkopolska') {
    // Przypadek zachmurzenia: żadna scena nie ma wystarczającego pokrycia działki.
    return {
      ...base,
      scene: null,
      checkedScenes: [
        { id: 'DEMO_S2_20240806', datetime: '2024-08-06T10:00:00Z', date: '2024-08-06', cloudCoverPct: 78, usefulCoveragePct: 22 },
        { id: 'DEMO_S2_20240801', datetime: '2024-08-01T10:00:00Z', date: '2024-08-01', cloudCoverPct: 91, usefulCoveragePct: 0 },
        { id: 'DEMO_S2_20240727', datetime: '2024-07-27T10:00:00Z', date: '2024-07-27', cloudCoverPct: 64, usefulCoveragePct: 35 },
      ],
      values: [],
      deviationMask: [],
      stats: null,
      message: `Brak obserwacji z wystarczającym pokryciem działki. Najlepsza sprawdzona scena (2024-07-27) ma 35% działki bez chmur, cieni i braków danych (wymagane ${MIN_COVERAGE_PCT}%).`,
    };
  }

  const sorted = [...parcelValues].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const deviationMask = cellCenters.map((p, i) => {
    const v = values[i];
    return v !== null && v !== undefined && pointInPolygon(p, parcel.ring2180) && Math.abs(v - median) > 0.06 ? 1 : 0;
  });
  const deviating = deviationMask.reduce<number>((sum, m) => sum + m, 0);
  const inside = cellCenters.filter((p) => pointInPolygon(p, parcel.ring2180)).length;
  const pct = inside > 0 ? Math.round((1000 * deviating) / inside) / 10 : 0;
  return {
    ...base,
    scene: { id: `DEMO_S2_${sceneDate.replaceAll('-', '')}`, datetime: `${sceneDate}T10:00:00Z`, date: sceneDate, cloudCoverPct: 12, usefulCoveragePct: 96 },
    checkedScenes: [{ id: `DEMO_S2_${sceneDate.replaceAll('-', '')}`, datetime: `${sceneDate}T10:00:00Z`, date: sceneDate, cloudCoverPct: 12, usefulCoveragePct: 96 }],
    values,
    deviationMask,
    stats: {
      median: Math.round(median * 1000) / 1000,
      p10: Math.round((sorted[Math.floor(sorted.length * 0.1)] ?? 0) * 1000) / 1000,
      p90: Math.round((sorted[Math.floor(sorted.length * 0.9)] ?? 0) * 1000) / 1000,
      validPixels: sorted.length,
      parcelPixels: sorted.length,
      deviatingPixelsPct: pct,
    },
    message: `Scena z ${sceneDate}: 96% działki z ważną obserwacją. ${
      deviating > 0 ? `${pct}% powierzchni wyraźnie odbiega od reszty działki – to miejsca do sprawdzenia w terenie.` : 'Brak wyraźnych odchyleń NDMI.'
    }`,
  };
}
