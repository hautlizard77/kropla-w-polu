import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NdmiResult, ParcelInfo, TerrainResult } from '../../src/types/terrain';
import type { SoilProfile } from '../sources/soil';
import { dateRange, type WeatherSeries } from '../sources/weather';
import { buildAssessment } from './assess';
import { curveNumber, readNdmi, runoffMm, slopeContrast } from './observations';

test('SCS-CN: przykład podręcznikowy (CN 80, P 100 mm → Q ≈ 50 mm), brak spływu poniżej Ia', () => {
  assert.ok(Math.abs(runoffMm(100, 80) - 50.4) < 0.5);
  assert.equal(runoffMm(10, 80), 0); // Ia = 12,7 mm
});

test('CN rośnie z nachyleniem i dla gleb ciężkich; łąka ma mniejszy spływ niż uprawa rzędowa', () => {
  const flat = curveNumber('ziemniaki', 'średnia', 0.5);
  const steep = curveNumber('ziemniaki', 'średnia', 8);
  assert.ok(steep > flat);
  assert.ok(curveNumber('ziemniaki', 'ciężka', 3) > curveNumber('ziemniaki', 'lekka', 3));
  assert.ok(curveNumber('uzytki_zielone', 'średnia', 3) < curveNumber('ziemniaki', 'średnia', 3));
});

const ndmiOf = (median: number, date: string, deviating = 2): NdmiResult =>
  ({
    scene: { id: 's', datetime: `${date}T10:00:00Z`, date, cloudCoverPct: 5, usefulCoveragePct: 95 },
    stats: { median, p10: median - 0.05, p90: median + 0.05, validPixels: 100, parcelPixels: 100, deviatingPixelsPct: deviating },
    values: [],
    deviationMask: [],
    message: 'NDMI z Sentinel-2',
    sources: [{ name: 'Sentinel-2 L2A', provider: 'Copernicus / Earth Search', url: null, origin: 'observed', retrievedAt: null, observationDate: date, resolutionM: 20, durationMs: null, notes: [] }],
  }) as unknown as NdmiResult;

test('NDMI interpretowany według fazy: w pełni rozwoju progi 0,2 / 0,05; w fazie początkowej bez wniosków; stare zdjęcie pomijane', () => {
  assert.equal(readNdmi(ndmiOf(0.3, '2024-06-10'), 'pszenica_ozima', '2024-06-12', null).signal, 'ok');
  assert.equal(readNdmi(ndmiOf(0.12, '2024-06-10'), 'pszenica_ozima', '2024-06-12', null).signal, 'watch');
  assert.equal(readNdmi(ndmiOf(-0.02, '2024-06-10'), 'pszenica_ozima', '2024-06-12', null).signal, 'stress');
  assert.equal(readNdmi(ndmiOf(-0.02, '2024-05-01'), 'kukurydza_ziarno', '2024-05-03', null).signal, 'na'); // wschody
  assert.equal(readNdmi(ndmiOf(-0.02, '2024-05-20'), 'pszenica_ozima', '2024-06-12', null).signal, 'na'); // 23 dni
  assert.equal(readNdmi(null, 'pszenica_ozima', '2024-06-12', 'brak').signal, 'na');
});

test('satelita × teren: górna część pola suchsza niż dolna', () => {
  const n = 20;
  const elevation: number[] = [];
  const values: number[] = [];
  for (let row = 0; row < n; row += 1) for (let col = 0; col < n; col += 1) {
    elevation.push(110 - row * 0.5); // w dół na południe
    values.push(row < 7 ? 0.08 : row > 13 ? 0.28 : 0.18);
  }
  const terrain = {
    displayGrid: { width: n, height: n, cellSize: 10, originX: 0, originY: 200 },
    elevation,
    parcel: { ring2180: [[0, 0], [200, 0], [200, 200], [0, 200]] },
  } as unknown as TerrainResult;
  const c = slopeContrast(terrain, { values } as unknown as NdmiResult);
  assert.ok(c);
  assert.equal(c.upperMedian, 0.08);
  assert.equal(c.lowerMedian, 0.28);
});

// ---------- Integracja z oceną ----------

function weatherOf(start: string, end: string, f: (date: string) => [number, number]): WeatherSeries {
  return {
    days: dateRange(start, end).map((date) => {
      const [p, e] = f(date);
      return { date, precipitationMm: p, et0Mm: e, source: 'nasa-power' as const };
    }),
    lastCompleteDate: end,
    notes: [],
    sources: [{ name: 'test', provider: 'test', url: null, origin: 'observed', retrievedAt: null, observationDate: null, resolutionM: null, durationMs: null, notes: [] }],
  };
}

const soil: SoilProfile = {
  horizons: [{ topCm: 0, bottomCm: 200, thetaFc: 0.3, thetaWp: 0.12, sandPct: 35, clayPct: 20, organicMatterPct: 2 }],
  topsoilTexture: 'glina',
  category: 'średnia',
  missing: [],
  source: { name: 'gleba', provider: 'test', url: null, origin: 'observed', retrievedAt: null, observationDate: null, resolutionM: 250, durationMs: null, notes: [] },
};

const parcel = {
  id: '040706_4.0001.9',
  ring2180: [[500000, 500000], [500200, 500000], [500200, 500200], [500000, 500200]],
  ringWgs84: [[18.31, 52.68], [18.313, 52.68], [18.313, 52.682], [18.31, 52.682]],
  areaHa: 4,
  voivodeship: 'kujawsko-pomorskie',
  county: null,
  commune: null,
  region: null,
  origin: 'observed',
  source: { name: 'ULDK', provider: 'GUGiK', url: null, origin: 'observed', retrievedAt: null, observationDate: null, resolutionM: null, durationMs: null, notes: [] },
} as unknown as ParcelInfo;

const terrainOf = (slopeDeg: number): TerrainResult =>
  ({
    parcel,
    displayGrid: { width: 1, height: 1, cellSize: 200, originX: 500000, originY: 500200 },
    elevation: [100],
    depressions: [],
    erosion: { soilDataAvailable: true, basis: '', parcelSlopeMeanDeg: slopeDeg, parcelSlopeMaxDeg: slopeDeg * 2, parcelClassPct: slopeDeg >= 5 ? [0, 20, 60, 20, 0] : [80, 20, 0, 0, 0] },
    retentionCandidate: {
      kind: 'depression',
      at: [500100, 500050],
      ring: [[500080, 500030], [500120, 500030], [500120, 500070], [500080, 500070]],
      title: 'Obniżenie w południowej części działki',
      reasons: ['Woda z większości działki spływa w to miejsce.'],
      metrics: [{ label: 'pojemność', value: '120 m³' }],
    },
    sources: [{ name: 'NMT', provider: 'GUGiK', url: null, origin: 'observed', retrievedAt: null, observationDate: null, resolutionM: 1, durationMs: null, notes: [] }, { name: 'NMT 1 m', provider: 'GUGiK', url: null, origin: 'observed', retrievedAt: null, observationDate: null, resolutionM: 1, durationMs: null, notes: [] }],
  }) as unknown as TerrainResult;

// Lata suche z ulewami co 10 dni (25 mm) – na stoku część wody spływa.
const stormy = (d: string): [number, number] => {
  const summer = d.slice(5, 7) >= '05' && d.slice(5, 7) <= '08';
  if (Number(d.slice(8, 10)) % 10 === 0) return [summer ? 35 : 20, 2];
  return summer ? [0, 4.5] : [1.5, 1];
};

test('teren w diagnozie: stok zwiększa spływ i ubytek wody; zalecenia ze wskazanym miejscem i uprawą w poprzek stoku', () => {
  const weather = weatherOf('2014-03-01', '2024-07-01', stormy);
  const req = { parcelId: parcel.id, cropId: 'kukurydza_ziarno' as const, analysisDate: '2024-07-01' };
  const flat = buildAssessment({ request: req, parcel, weather, soil, hydro: null, terrain: terrainOf(0.5) });
  const steep = buildAssessment({ request: req, parcel, weather, soil, hydro: null, terrain: terrainOf(8) });
  const runoff = (r: typeof flat) => Number(r.currentState.indicators.find((i) => i.id === 'splyw')?.value);
  assert.ok(runoff(steep) > runoff(flat));
  const reserve = (r: typeof flat) => Number(r.currentState.indicators.find((i) => i.id === 'zapas')?.value);
  assert.ok(reserve(steep) <= reserve(flat));
  assert.match(steep.currentState.summary, /spłynęło po powierzchni pola/);
  const place = steep.recommendations.find((r) => r.id === 'rec-miejsce');
  assert.ok(place?.suggestedArea, 'zalecenie ze wskazanym miejscem na mapie');
  assert.ok(steep.recommendations.some((r) => r.id === 'rec-stok'));
  assert.ok(!flat.recommendations.some((r) => r.id === 'rec-stok'));
  assert.equal(steep.dataSources.find((s) => s.id === 'nmt')?.availability, 'available');
});

test('satelita w diagnozie: zielone, dobrze uwodnione rośliny łagodzą ocenę z bilansu o jeden stopień i to jest napisane', () => {
  const dry = (d: string): [number, number] => (d.slice(5, 7) >= '05' && d.slice(5, 7) <= '08' ? [0.5, 5] : [3, 1]);
  const weather = weatherOf('2014-03-01', '2024-06-20', dry);
  const req = { parcelId: parcel.id, cropId: 'pszenica_ozima' as const, analysisDate: '2024-06-20' };
  const model = buildAssessment({ request: req, parcel, weather, soil, hydro: null });
  assert.equal(model.currentState.level, 'elevated');
  const withSat = buildAssessment({ request: req, parcel, weather, soil, hydro: null, ndmi: ndmiOf(0.32, '2024-06-18') });
  assert.equal(withSat.currentState.level, 'moderate');
  assert.match(withSat.currentState.summary, /nie zgadza się z bilansem/);
  assert.equal(withSat.currentState.indicators.find((i) => i.id === 'ndmi')?.isIndirect, true);
  const confirmed = buildAssessment({ request: req, parcel, weather, soil, hydro: null, ndmi: ndmiOf(-0.05, '2024-06-18') });
  assert.equal(confirmed.currentState.level, 'elevated');
  assert.match(confirmed.currentState.summary, /potwierdza/);
});
