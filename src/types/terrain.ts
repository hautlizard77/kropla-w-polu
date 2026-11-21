/**
 * Wspólne typy odpowiedzi API analizy terenu i NDMI (serwer → strona).
 * Współrzędne płaskie są w układzie EPSG:2180 (PUWG 1992), w metrach: [x = wschód, y = północ].
 */
import type { IsoDate, IsoDateTime } from './analysis';

export type Xy = [number, number];

/** Skąd pochodzą dane warstwy. `demo` = syntetyczne dane trybu demonstracyjnego. */
export type DataOrigin = 'observed' | 'demo';

export interface SourceInfo {
  name: string;
  provider: string;
  url: string | null;
  origin: DataOrigin;
  /** Kiedy dane pobrano (w buforze – kiedy pobrano pierwotnie). */
  retrievedAt: IsoDateTime | null;
  /** Data stanu, który opisują dane (np. data sceny); null, jeśli nieznana. */
  observationDate: IsoDate | null;
  resolutionM: number | null;
  /** Czas pobrania z usługi w ms (null przy odczycie z bufora). */
  durationMs: number | null;
  notes: string[];
}

export interface ParcelInfo {
  id: string;
  /** Pierścień zewnętrzny granicy w EPSG:2180. */
  ring2180: Xy[];
  /** Ten sam pierścień w WGS84 [lng, lat]. */
  ringWgs84: Xy[];
  areaHa: number;
  voivodeship: string | null;
  county: string | null;
  commune: string | null;
  region: string | null;
  origin: DataOrigin;
  source: SourceInfo;
}

export type ParcelLookup =
  | { status: 'ok'; parcel: ParcelInfo }
  | { status: 'not_found'; message: string }
  | { status: 'error'; message: string };

/** Regularna siatka w EPSG:2180; wiersz 0 to północna krawędź. */
export interface GridSpec {
  width: number;
  height: number;
  cellSize: number;
  /** Lewy górny narożnik siatki (krawędź komórki, nie środek). */
  originX: number;
  originY: number;
}

export interface FlowLine {
  /** Punkty linii od góry stoku w dół (EPSG:2180). */
  points: Xy[];
  /** Akumulacja (powierzchnia zlewni w m²) w kolejnych punktach. */
  accumulationM2: number[];
}

export interface ConcentrationPoint {
  at: Xy;
  accumulationM2: number;
  kind: 'outlet' | 'max_inside';
  /** Czy do tego miejsca może dopływać woda spoza pobranego rastra. */
  truncated: boolean;
}

export interface Depression {
  id: number;
  centroid: Xy;
  areaM2: number;
  maxDepthM: number;
  volumeM3: number;
  /** Powierzchnia, z której woda spływa do zastoiska (m²). */
  contributingAreaM2: number;
  insideParcel: boolean;
}

export interface FlowArrow {
  at: Xy;
  /** Kierunek spływu: wektor jednostkowy [dx, dy] w EPSG:2180. */
  dir: Xy;
}

export type SlopeClass = 0 | 1 | 2 | 3 | 4;

export interface RetentionCandidate {
  kind: 'depression' | 'flow_concentration';
  at: Xy;
  /** Przybliżony obszar do sprawdzenia (pierścień w EPSG:2180). */
  ring: Xy[];
  title: string;
  reasons: string[];
  /** Liczby, na których opiera się wybór. */
  metrics: { label: string; value: string }[];
}

export interface TerrainResult {
  version: number;
  parcelId: string;
  origin: DataOrigin;
  parcel: ParcelInfo;
  /** Siatka analizy (po ewentualnym uśrednieniu). */
  analysisGrid: GridSpec;
  /** Siatka do wyświetlania (zmniejszona). */
  displayGrid: GridSpec;
  /** Wysokości siatki wyświetlania, wierszami; null = brak danych. */
  elevation: (number | null)[];
  elevationRange: [number, number];
  /** Nachylenie w stopniach na siatce wyświetlania. */
  slopeDeg: (number | null)[];
  /** Klasy nachylenia (0 – do 2°, 1 – 2–5°, 2 – 5–10°, 3 – 10–15°, 4 – ponad 15°). */
  slopeClass: (SlopeClass | null)[];
  /** Maska zastoisk na siatce wyświetlania (0/1). */
  depressionMask: number[];
  flowLines: FlowLine[];
  maxAccumulationM2: number;
  arrows: FlowArrow[];
  concentration: ConcentrationPoint[];
  depressions: Depression[];
  inflowBeyondRaster: {
    /** Czy obszar dopływu do działki może wychodzić poza pobrany raster. */
    affectsParcel: boolean;
    /** Odsetek komórek działki, do których może dopływać woda spoza rastra. */
    parcelCellsPct: number;
    note: string;
  };
  erosion: {
    soilDataAvailable: boolean;
    /** Opis, co pokazuje warstwa. */
    basis: string;
    parcelSlopeMeanDeg: number;
    parcelSlopeMaxDeg: number;
    /** Udział klas nachylenia w działce (%), indeks = klasa. */
    parcelClassPct: number[];
  };
  retentionCandidate: RetentionCandidate | null;
  sources: SourceInfo[];
  timings: { label: string; ms: number }[];
  cached: boolean;
  computedAt: IsoDateTime;
  method: string;
  limitations: string[];
}

export type TerrainResponse =
  | { status: 'ok'; result: TerrainResult }
  | { status: 'not_found'; message: string }
  | { status: 'error'; message: string; stage: string };

export interface NdmiScene {
  id: string;
  datetime: IsoDateTime;
  date: IsoDate;
  cloudCoverPct: number | null;
  /** Odsetek pikseli działki z ważną obserwacją po masce chmur, cieni i braków. */
  usefulCoveragePct: number;
}

export interface NdmiResult {
  version: number;
  parcelId: string;
  analysisDate: IsoDate;
  origin: DataOrigin;
  /** Wybrana scena albo null, jeśli żadna nie spełnia progu pokrycia. */
  scene: NdmiScene | null;
  /** Sceny sprawdzone (od najnowszej). */
  checkedScenes: NdmiScene[];
  resolutionM: 20;
  minCoveragePct: number;
  /** NDMI na siatce wyświetlania terenu (null = brak/maska). */
  values: (number | null)[];
  /** 1 = piksel odbiegający od reszty działki (miejsce do sprawdzenia w terenie). */
  deviationMask: number[];
  stats: {
    median: number;
    p10: number;
    p90: number;
    validPixels: number;
    parcelPixels: number;
    deviatingPixelsPct: number;
  } | null;
  message: string;
  sources: SourceInfo[];
  timings: { label: string; ms: number }[];
  cached: boolean;
  limitations: string[];
}

export type NdmiResponse =
  | { status: 'ok'; result: NdmiResult }
  | { status: 'not_found'; message: string }
  | { status: 'error'; message: string; stage: string };
