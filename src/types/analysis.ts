/**
 * Model danych analizy sytuacji wodnej działki.
 *
 * Zasady modelu:
 * - Daty kalendarzowe przechowujemy jako napisy `YYYY-MM-DD` (IsoDate), bez godzin i stref,
 *   żeby uniknąć przesunięć o jeden dzień.
 * - Brak danych modelujemy wprost (`null`, `availability: 'missing'`, poziom `insufficient_data`),
 *   nigdy przez wstawienie zera ani domyślnej oceny.
 * - Rozróżniamy: datę analizy (wybraną przez rolnika), datę obserwacji (kiedy dane opisują stan),
 *   datę pobrania (kiedy system je pobrał) i zakres danych historycznych.
 */

/** Data kalendarzowa w formacie YYYY-MM-DD. */
export type IsoDate = string;

/** Znacznik czasu ISO 8601 z przesunięciem strefy, np. 2026-11-21T12:00:00+01:00. */
export type IsoDateTime = string;

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

/** Identyfikator uprawy – lista w src/data/crops.ts. */
export type CropId =
  | 'pszenica_ozima'
  | 'pszenica_jara'
  | 'jeczmien_ozimy'
  | 'jeczmien_jary'
  | 'zyto'
  | 'pszenzyto_ozime'
  | 'owies'
  | 'kukurydza_ziarno'
  | 'gryka'
  | 'ziemniaki'
  | 'buraki_cukrowe'
  | 'rzepak_ozimy'
  | 'rzepak_jary'
  | 'slonecznik'
  | 'groch'
  | 'bobik'
  | 'lubin'
  | 'soja'
  | 'kukurydza_kiszonka'
  | 'lucerna'
  | 'koniczyna'
  | 'uzytki_zielone'
  | 'marchew'
  | 'cebula'
  | 'kapusta'
  | 'truskawki'
  | 'sad_jablon';

export type CropGroup = 'zboza' | 'okopowe' | 'oleiste' | 'straczkowe' | 'pastewne' | 'warzywa' | 'owoce';

export interface Crop {
  id: CropId;
  label: string;
  group: CropGroup;
  /** Miesiące (1–12), w których uprawa jest najbardziej wrażliwa na niedobór wody. */
  criticalMonths: number[];
}

/** Zapytanie o analizę – dokładnie to, co wskazał użytkownik. */
export interface AnalysisRequest {
  /** Identyfikator działki ewidencyjnej, np. 040702_5.0007.112 */
  parcelId: string;
  cropId: CropId;
  /** Dzień, dla którego oceniamy sytuację. Ocena nie może korzystać z późniejszych obserwacji. */
  analysisDate: IsoDate;
}

/** Wielobok w układzie WGS84: pierścienie [lng, lat] jak w GeoJSON. */
export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: [number, number][][];
}

export interface Parcel {
  id: string;
  /** Opis położenia zrozumiały dla rolnika. */
  locationLabel: string;
  commune: string;
  county: string;
  voivodeship: string;
  /** Powierzchnia ewidencyjna w ha; null, jeśli nieznana. */
  areaHa: number | null;
  geometry: PolygonGeometry;
}

export type RiskLevel = 'elevated' | 'moderate' | 'low' | 'insufficient_data';

/** Grupy danych wykorzystywane przez docelowy silnik. */
export type DataKind = 'granice' | 'teren' | 'pogoda' | 'satelita' | 'gleba' | 'hydrologia';

export type Availability = 'available' | 'partial' | 'missing';

/** Pojedynczy wskaźnik użyty jako dowód w ocenie. */
export interface Indicator {
  id: string;
  label: string;
  /** Wartość liczbowa lub kategoria (np. klasa gleby); null oznacza brak danych (nie zero). */
  value: number | string | null;
  unit: string;
  /** Wartość odniesienia, np. średnia wieloletnia; null jeśli brak. */
  reference: { label: string; value: number | string | null } | null;
  /** Data, której dotyczy wartość; null, jeśli brak obserwacji. */
  observedOn: IsoDate | null;
  /** Krótka interpretacja dla rolnika. */
  interpretation: string;
  sourceId: string;
  /** true, gdy wskaźnik jest dowodem pośrednim (np. indeks satelitarny zamiast pomiaru wilgotności gleby). */
  isIndirect: boolean;
}

export interface Assessment {
  level: RiskLevel;
  headline: string;
  summary: string;
  indicators: Indicator[];
}

export interface CurrentAssessment extends Assessment {
  /** Data, której dotyczy ocena (równa dacie analizy). */
  asOf: IsoDate;
}

export interface HistoricalAssessment extends Assessment {
  /** Okres, z którego pochodzą dane historyczne (do daty analizy włącznie). */
  period: DateRange | null;
  /** Miesiące najczęstszych niedoborów wody (1–12). */
  criticalMonths: number[];
}

export type RecommendationCategory = 'retencja' | 'agrotechnika';

export interface Recommendation {
  id: string;
  category: RecommendationCategory;
  title: string;
  /** Co zrobić. */
  action: string;
  /** Dlaczego – uzasadnienie oparte na danych. */
  rationale: string;
  /** Identyfikatory źródeł danych, na których opiera się uzasadnienie. */
  evidenceSourceIds: string[];
  /** Co sprawdzić w terenie przed wykonaniem. */
  fieldChecks: string[];
  /** Konkretna czynność do wykonania w terenie (pierwszy krok). */
  fieldTask?: string;
  /** Liczby, na których opiera się zalecenie (np. pojemność obniżenia, ilość spływu). */
  evidenceNumbers?: { label: string; value: string }[];
  /** Sugerowany obszar działania na mapie (opcjonalny). */
  suggestedArea: { label: string; geometry: PolygonGeometry } | null;
}

/**
 * Nawadnianie – opcjonalny element raportu. W tej iteracji nie wyliczamy dawek ani terminów,
 * więc model przewiduje stan „nie obliczono”.
 */
export type IrrigationAdvice =
  | { status: 'not_calculated'; note: string }
  | {
      status: 'calculated';
      justified: boolean;
      summary: string;
      /** Proponowany termin; null, jeśli nie dotyczy. */
      window: DateRange | null;
      /** Dawka w mm; null, jeśli nie dotyczy. */
      doseMm: number | null;
    };

export interface DataSource {
  id: string;
  kind: DataKind;
  /** Nazwa zbioru lub produktu, np. „Sentinel-2 L2A – NDMI”. */
  name: string;
  provider: string;
  url: string | null;
  license: string | null;
  availability: Availability;
  /** Data stanu, który opisują dane; null, jeśli brak obserwacji. Nie może być późniejsza niż data analizy. */
  observationDate: IsoDate | null;
  /** Kiedy dane zostały pobrane lub przetworzone; null, jeśli nie pobrano. */
  retrievedAt: IsoDate | null;
  /** Zakres dostępnych danych historycznych; null, jeśli brak. */
  coverage: DateRange | null;
  limitations: string[];
  details: string | null;
}

/** Rachunek wody w strefie korzeni na najbliższe dni (z prognozy opadu i parowania). Wartości w mm. */
export interface ForecastBalance {
  horizonDays: number;
  from: IsoDate;
  to: IsoDate;
  /** Woda dostępna dla roślin w strefie korzeni na początku okresu. */
  startReserveMm: number;
  startReservePct: number;
  /** Pełny zapas (TAW) i poziom, poniżej którego roślina ogranicza wzrost (% pełnego zapasu). */
  fullReserveMm: number;
  stressThresholdPct: number;
  /** Ile wody zużyłaby uprawa bez niedoboru (ETc = Kc · ET0). */
  needMm: number;
  rainMm: number;
  /** Część opadu, która zostanie w strefie korzeni. */
  rainUsedMm: number;
  /** Część opadu ponad pojemność gleby – przesiąknie głębiej lub spłynie. */
  rainLostMm: number;
  endReserveMm: number;
  endReservePct: number;
  endLevel: RiskLevel;
  /** Dni w okresie z zapasem poniżej progu stresu (bez nawadniania). */
  stressDays: number;
}

export interface IrrigationEvent {
  date: IsoDate;
  doseMm: number;
  m3PerHa: number;
  m3Parcel: number | null;
}

export interface IrrigationPlan {
  events: IrrigationEvent[];
  totalMm: number;
  totalM3PerHa: number;
  totalM3Parcel: number | null;
  /** Czy uprawę zwykle się nawadnia (warzywa, okopowe, owoce). */
  typicallyIrrigated: boolean;
  horizonDays: number;
}

export interface ForecastStep {
  id: string;
  /** Kiedy: „Teraz”, „pt. 14.06”, „Od pt. 14.06”… */
  when: string;
  tone: 'good' | 'info' | 'warning';
  title: string;
  text: string;
}

export interface WaterForecast {
  status: 'ok' | 'not_applicable' | 'unavailable';
  message: string;
  issuedAt: IsoDateTime | null;
  balance: ForecastBalance | null;
  irrigationPlan: IrrigationPlan | null;
  steps: ForecastStep[];
  sourceId: string | null;
}

/** Wynik Sentinel-2 dla głównej zakładki – osobny sygnał obok bilansu wody; nie zmienia klasy ryzyka. */
export interface SatelliteSummary {
  /** ok – obserwacja porównywalna z oczekiwaniem dla uprawy i fazy; no_comparison – jest zdjęcie, ale brak podstaw do porównania; unavailable – brak użytecznego zdjęcia. */
  status: 'ok' | 'no_comparison' | 'unavailable';
  /** Konkretny powód braku porównania: stara scena, za małe pokrycie, faza uprawy, brak sceny, usługa niedostępna. */
  reason: 'unavailable' | 'no_scene' | 'low_coverage' | 'stale' | 'phase' | null;
  sceneDate: IsoDate | null;
  /** Odsetek działki widoczny na zdjęciu (po masce chmur i cieni). */
  coveragePct: number | null;
  ndmiMedian: number | null;
  cropName: string;
  stageLabel: string;
  /** Progi dla fazy: dobre uwodnienie od / wyraźny niedobór poniżej. */
  expected: { okFrom: number; stressBelow: number } | null;
  verdict: 'ok' | 'watch' | 'stress' | null;
  /** Co widać na zdjęciu – albo konkretny powód, dla którego nie da się porównać. */
  photoText: string;
  /** Wynik bilansu wody prostym językiem (klasa ryzyka pochodzi wyłącznie z bilansu). */
  balanceLevel: RiskLevel | null;
  balanceText: string | null;
  /** Zgodność obserwacji z bilansem: zgodne, różnica o jeden stopień, rozbieżne (różnica o dwa stopnie). */
  comparison: 'agree' | 'partial' | 'diverge' | null;
  comparisonText: string | null;
  /** Co sprawdzić na polu przy rozbieżności. */
  fieldCheck: string | null;
  sourceId: string;
}

export interface AnalysisResult {
  /** Sentinel-2 (NDMI) – tylko w ocenie działek spoza demo. */
  satellite?: SatelliteSummary;
  /** Prognoza na najbliższe dni – tylko dla analizy na dziś (lub ostatnie dni) i działek z danymi. */
  forecast?: WaterForecast;
  request: AnalysisRequest;
  /** true dla scenariuszy demonstracyjnych – raport musi to wyraźnie pokazać. */
  isDemo: boolean;
  scenarioId: string | null;
  parcel: Parcel;
  generatedAt: IsoDateTime;
  currentState: CurrentAssessment;
  historicalVulnerability: HistoricalAssessment;
  /** Rekomendacje wynikają z oceny – nie generujemy ich bez rozpoznania warunków działki. */
  recommendations: Recommendation[];
  irrigation: IrrigationAdvice | null;
  dataSources: DataSource[];
  /** Ogólne ograniczenia i niepewności analizy. */
  limitations: string[];
}

/** Powód, dla którego nie ma analizy dla podanego zestawu danych. */
export type UnavailableReason = 'unknown_parcel' | 'date_mismatch' | 'crop_mismatch';

export interface AnalysisUnavailable {
  reason: UnavailableReason;
  message: string;
  /** Wartość, dla której analiza byłaby dostępna (np. data przykładu); pomaga rolnikowi. */
  hint: { field: keyof AnalysisRequest; value: string; label: string } | null;
}

export type AnalysisOutcome =
  | { status: 'ok'; result: AnalysisResult }
  | { status: 'unavailable'; unavailable: AnalysisUnavailable };
