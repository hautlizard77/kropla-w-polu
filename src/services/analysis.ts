/**
 * Jedno wejście do analizy działki.
 *
 * Działki z trybu demonstracyjnego: wynik ze scenariuszy (src/data/demoScenarios.ts), wyraźnie oznaczony.
 * Pozostałe działki: granica z ULDK przez serwer aplikacji i rzeczywisty stan dostępnych danych – bez wymyślonej diagnozy.
 * Docelowo: pełna ocena z API silnika analizy (patrz `fetchAnalysisFromApi` i README → „Podłączenie API”).
 *
 * Komponenty widoków tylko renderują wynik – nie wyliczają wskaźników ani nie wybierają zaleceń.
 */
import { cropLabel } from '../data/crops';
import { DEMO_SCENARIOS, type DemoScenario } from '../data/demoScenarios';
import { compareIsoDates, formatDatePl } from '../lib/dates';
import type { AnalysisOutcome, AnalysisRequest, AnalysisResult, DataSource } from '../types/analysis';
import type { ParcelInfo } from '../types/terrain';
import { ApiUnavailableError, fetchAnalysis } from './terrain';

/** Błąd techniczny (np. brak połączenia) – w odróżnieniu od braku analizy dla danych wejściowych. */
export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisError';
  }
}

export interface AnalyzeOptions {
  signal?: AbortSignal;
  /** Tylko do testów stanów interfejsu: wymusza błąd techniczny (parametr adresu ?symulujBlad=1). */
  simulateError?: boolean;
}

const DEMO_DELAY_MS = 700;

export async function analyzeParcel(request: AnalysisRequest, options: AnalyzeOptions = {}): Promise<AnalysisOutcome> {
  if (options.simulateError) {
    await delay(DEMO_DELAY_MS, options.signal);
    throw new AnalysisError('Nie udało się połączyć z usługą analizy. Sprawdź połączenie z internetem i spróbuj ponownie.');
  }

  // Punkt podłączenia przyszłego API: zamień poniższe wywołania na `fetchAnalysisFromApi(request, options.signal)`.
  const isDemoParcel = DEMO_SCENARIOS.some((scenario) => scenario.request.parcelId === request.parcelId);
  if (isDemoParcel) {
    await delay(DEMO_DELAY_MS, options.signal);
    return analyzeWithDemoScenarios(request);
  }
  return analyzeObservedParcel(request);
}

/** Działka spoza trybu demo: ocena serwera z danych pogodowych, glebowych i hydrologicznych. */
async function analyzeObservedParcel(request: AnalysisRequest): Promise<AnalysisOutcome> {
  let response;
  try {
    response = await fetchAnalysis(request);
  } catch (error) {
    throw new AnalysisError(error instanceof ApiUnavailableError ? error.message : 'Nie udało się pobrać danych działki.');
  }
  if (response.status === 'error') throw new AnalysisError(response.message);
  return response;
}

/** Wynik zastępczy bez oceny – tylko granica działki i stan źródeł (używany w testach i przy braku serwera analiz). */
export function observedResult(request: AnalysisRequest, parcel: ParcelInfo, now: Date = new Date()): AnalysisResult {
  const ring = [...parcel.ringWgs84, parcel.ringWgs84[0] as [number, number]];
  const onDemand = (kind: DataSource['kind'], id: string, name: string, provider: string, url: string, details: string): DataSource => ({
    id,
    kind,
    name,
    provider,
    url,
    license: null,
    availability: 'available',
    observationDate: null,
    retrievedAt: null,
    coverage: null,
    limitations: [],
    details,
  });
  const missing = (kind: DataSource['kind'], id: string, name: string): DataSource => ({
    id,
    kind,
    name,
    provider: 'nie podłączono w tej wersji',
    url: null,
    license: null,
    availability: 'missing',
    observationDate: null,
    retrievedAt: null,
    coverage: null,
    limitations: ['Źródło nie jest jeszcze podłączone – brak danych do oceny.'],
    details: null,
  });
  return {
    request,
    isDemo: false,
    scenarioId: null,
    generatedAt: now.toISOString(),
    parcel: {
      id: parcel.id,
      locationLabel: parcel.region ? `obręb ${parcel.region}` : 'obręb nieznany',
      commune: parcel.commune ?? 'nieznana',
      county: parcel.county ?? 'nieznany',
      voivodeship: parcel.voivodeship ?? 'nieznane',
      areaHa: Math.round(parcel.areaHa * 100) / 100,
      geometry: { type: 'Polygon', coordinates: [ring] },
    },
    currentState: {
      asOf: request.analysisDate,
      level: 'insufficient_data',
      headline: 'Za mało danych do oceny stresu wodnego',
      summary:
        'Dla tej działki nie są jeszcze podłączone dane pogodowe i glebowe, dlatego nie oceniamy niedoboru wody na wybrany dzień. ' +
        'Ukształtowanie terenu, spływ i wskaźnik NDMI z Sentinel-2 sprawdzisz w sekcji „Teren i spływ”.',
      indicators: [],
    },
    historicalVulnerability: {
      level: 'insufficient_data',
      headline: 'Za mało danych',
      summary: 'Ocena podatności wymaga 10 lat danych pogodowych i danych glebowych, które nie są jeszcze podłączone.',
      period: null,
      criticalMonths: [],
      indicators: [],
    },
    recommendations: [],
    irrigation: { status: 'not_calculated', note: 'W tej wersji nie wyliczamy dawek ani terminów nawadniania.' },
    dataSources: [
      {
        ...parcel.source,
        id: 'uldk',
        kind: 'granice',
        license: 'Dane publiczne GUGiK',
        availability: 'available',
        observationDate: null,
        retrievedAt: parcel.source.retrievedAt ? parcel.source.retrievedAt.slice(0, 10) : null,
        coverage: null,
        limitations: parcel.source.notes,
        details: `Powierzchnia z geometrii: ${parcel.areaHa.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} ha.`,
      },
      onDemand('teren', 'nmt', 'Numeryczny Model Terenu', 'GUGiK – Geoportal (WCS)', 'https://www.geoportal.gov.pl', 'Pobierany na żądanie w sekcji „Teren i spływ”.'),
      onDemand('satelita', 's2', 'Sentinel-2 L2A – NDMI', 'Copernicus / Earth Search', 'https://earth-search.aws.element84.com/v1', 'Pobierany na żądanie (przełącznik NDMI w sekcji „Teren i spływ”).'),
      missing('pogoda', 'pogoda', 'Opady i klimatyczny bilans wodny'),
      missing('gleba', 'gleba', 'Gleba i jej podatność na suszę'),
      missing('hydrologia', 'hydro', 'Cieki, rowy i zbiorniki'),
    ],
    limitations: [
      'Ocena niedoboru wody wymaga danych pogodowych i glebowych, które nie są jeszcze podłączone dla dowolnej działki.',
      'Granica działki pochodzi z ULDK; teren i NDMI są pobierane z rzeczywistych usług na żądanie.',
    ],
  };
}

/** Znajduje scenariusz demo dokładnie pasujący do zapytania. Inne zestawy danych nie dostają analizy. */
export function analyzeWithDemoScenarios(request: AnalysisRequest, now: Date = new Date()): AnalysisOutcome {
  const sameParcel = DEMO_SCENARIOS.filter((scenario) => scenario.request.parcelId === request.parcelId);
  if (sameParcel.length === 0) {
    return {
      status: 'unavailable',
      unavailable: {
        reason: 'unknown_parcel',
        message:
          'Dla tej działki nie mamy jeszcze danych do analizy. Sprawdź identyfikator albo wybierz działkę z mapy.',
        hint: null,
      },
    };
  }

  const exact = sameParcel.find(
    (scenario) =>
      scenario.request.cropId === request.cropId && scenario.request.analysisDate === request.analysisDate,
  );
  if (exact) {
    return { status: 'ok', result: toResult(exact, now) };
  }

  // Ta sama działka, ale inna data lub uprawa – podpowiadamy, dla jakich danych przykład działa.
  const scenario = sameParcel[0] as DemoScenario;
  if (scenario.request.analysisDate !== request.analysisDate) {
    return {
      status: 'unavailable',
      unavailable: {
        reason: 'date_mismatch',
        message: `Dla tej działki dane obejmują dzień ${formatDatePl(scenario.request.analysisDate)}. Dla innej daty nie mamy jeszcze danych.`,
        hint: { field: 'analysisDate', value: scenario.request.analysisDate, label: formatDatePl(scenario.request.analysisDate) },
      },
    };
  }
  return {
    status: 'unavailable',
    unavailable: {
      reason: 'crop_mismatch',
      message: `Dla tej działki dane dotyczą uprawy „${cropLabel(scenario.request.cropId)}”. Dla innej uprawy nie mamy jeszcze danych.`,
      hint: { field: 'cropId', value: scenario.request.cropId, label: cropLabel(scenario.request.cropId) },
    },
  };
}

function toResult(scenario: DemoScenario, now: Date): AnalysisResult {
  const result: AnalysisResult = { ...scenario.result, generatedAt: now.toISOString() };
  assertNoFutureObservations(result);
  return result;
}

/**
 * Reguła analizy historycznej: stan na wybrany dzień nie może korzystać z późniejszych obserwacji.
 * Sprawdzamy to także dla danych demo, żeby błąd w danych był widoczny od razu.
 */
export function assertNoFutureObservations(result: AnalysisResult): void {
  const { analysisDate } = result.request;
  const dates: (string | null)[] = [
    ...result.dataSources.map((source) => source.observationDate),
    ...result.dataSources.map((source) => source.coverage?.to ?? null),
    ...result.currentState.indicators.map((indicator) => indicator.observedOn),
    ...result.historicalVulnerability.indicators.map((indicator) => indicator.observedOn),
    result.historicalVulnerability.period?.to ?? null,
  ];
  const future = dates.find((date) => date !== null && compareIsoDates(date, analysisDate) > 0);
  if (future) {
    throw new AnalysisError(`Wynik zawiera obserwację z ${future}, późniejszą niż data analizy ${analysisDate}.`);
  }
}

/**
 * Szkic przyszłego wywołania API (nieużywany w tej iteracji).
 * Oczekiwany kontrakt: POST {VITE_ANALYSIS_API_URL}/analysis z AnalysisRequest → AnalysisOutcome.
 */
export async function fetchAnalysisFromApi(request: AnalysisRequest, signal?: AbortSignal): Promise<AnalysisOutcome> {
  const baseUrl = import.meta.env.VITE_ANALYSIS_API_URL as string | undefined;
  if (!baseUrl) throw new AnalysisError('Nie skonfigurowano adresu usługi analizy (VITE_ANALYSIS_API_URL).');
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    throw new AnalysisError('Nie udało się połączyć z usługą analizy. Spróbuj ponownie za chwilę.');
  }
  if (!response.ok) throw new AnalysisError(`Usługa analizy zwróciła błąd (${response.status}).`);
  return (await response.json()) as AnalysisOutcome;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Przerwano', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('Przerwano', 'AbortError'));
      },
      { once: true },
    );
  });
}
