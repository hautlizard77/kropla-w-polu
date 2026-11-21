/**
 * Jedno wejście do analizy działki.
 *
 * Teraz: czyta scenariusze demonstracyjne (src/data/demoScenarios.ts).
 * Docelowo: wywoła API silnika analizy (patrz `fetchAnalysisFromApi` i README → „Podłączenie API”).
 *
 * Komponenty widoków tylko renderują wynik – nie wyliczają wskaźników ani nie wybierają zaleceń.
 */
import { cropLabel } from '../data/crops';
import { DEMO_SCENARIOS, type DemoScenario } from '../data/demoScenarios';
import { compareIsoDates, formatDatePl } from '../lib/dates';
import type { AnalysisOutcome, AnalysisRequest, AnalysisResult } from '../types/analysis';

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
  await delay(DEMO_DELAY_MS, options.signal);

  if (options.simulateError) {
    throw new AnalysisError('Nie udało się połączyć z usługą analizy. Sprawdź połączenie z internetem i spróbuj ponownie.');
  }

  // Punkt podłączenia przyszłego API: zamień poniższe wywołanie na `fetchAnalysisFromApi(request, options.signal)`.
  return analyzeWithDemoScenarios(request);
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
