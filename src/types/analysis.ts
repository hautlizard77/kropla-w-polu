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

/** Jeden dzień prognozy z przewidywanym zapasem wody w glebie dla wybranej uprawy. */
export interface ForecastDay {
  date: IsoDate;
  /** true – dzień przed dniem dzisiejszym (dane modelowe z ostatnich dni), false – prognoza. */
  past: boolean;
  precipitationMm: number | null;
  probabilityPct: number | null;
  et0Mm: number | null;
  /** Zużycie wody przez uprawę (ETc), mm. */
  etcMm: number | null;
  tMax: number | null;
  tMin: number | null;
  /** Przewidywany zapas wody dostępnej w strefie korzeni, % pełnego zapasu. */
  reservePct: number | null;
  level: RiskLevel;
}

export interface ForecastAdvice {
  id: string;
  tone: 'good' | 'info' | 'warning';
  title: string;
  text: string;
}

export interface WaterForecast {
  status: 'ok' | 'not_applicable' | 'unavailable';
  message: string;
  issuedAt: IsoDateTime | null;
  /** Próg stresu (łatwo dostępna woda) w % zapasu – linia na wykresie. */
  stressThresholdPct: number | null;
  days: ForecastDay[];
  advice: ForecastAdvice[];
  totals: { rain3: number; rain7: number; rain10: number; etc7: number } | null;
  sourceId: string | null;
}

export interface AnalysisResult {
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
