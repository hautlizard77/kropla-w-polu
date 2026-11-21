import { useCallback, useEffect, useState } from 'react';
import { AnalysisScreen } from './components/AnalysisScreen';
import { ReportScreen } from './components/ReportScreen';
import { todayInPoland } from './lib/dates';
import { ANALYSIS_HASH, parseHash, reportHash, type Route } from './lib/route';
import type { FormValues } from './lib/validation';
import type { AnalysisRequest, AnalysisResult } from './types/analysis';

const EMPTY_FORM: FormValues = { parcelId: '', cropId: '', analysisDate: todayInPoland() };

/** Parametr ?symulujBlad=1 w adresie pozwala sprawdzić stan błędu technicznego. */
const SIMULATE_ERROR = new URLSearchParams(window.location.search).has('symulujBlad');

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [formValues, setFormValues] = useState<FormValues>(() => {
    const initial = parseHash(window.location.hash);
    return initial.name === 'report' && initial.request ? toFormValues(initial.request) : EMPTY_FORM;
  });
  // Wynik policzony na ekranie analizy – raport nie musi go pobierać drugi raz.
  const [lastResult, setLastResult] = useState<AnalysisResult | null>(null);

  useEffect(() => {
    const onHashChange = () => {
      const next = parseHash(window.location.hash);
      setRoute(next);
      if (next.name === 'report' && next.request) setFormValues(toFormValues(next.request));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const openReport = useCallback((result: AnalysisResult) => {
    setLastResult(result);
    setFormValues(toFormValues(result.request));
    window.location.hash = reportHash(result.request);
  }, []);

  const goToAnalysis = useCallback(() => {
    window.location.hash = ANALYSIS_HASH;
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#tresc">
        Przejdź do treści
      </a>
      <header className="site-header no-print">
        <div className="container site-header__inner">
          <a className="brand" href={ANALYSIS_HASH} aria-label="Woda na polu – strona główna">
            <svg className="brand__icon" viewBox="0 0 32 32" aria-hidden="true">
              <path d="M16 4c4.5 6 7.5 10 7.5 14a7.5 7.5 0 0 1-15 0C8.5 14 11.5 10 16 4z" fill="currentColor" />
              <path d="M5 28h22" stroke="var(--green-700)" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <span>Woda na polu</span>
          </a>
          <nav aria-label="Główna nawigacja">
            <ul className="nav-list">
              <li>
                <a href={ANALYSIS_HASH} aria-current={route.name === 'analysis' ? 'page' : undefined}>
                  Analiza działki
                </a>
              </li>
              {route.name === 'report' && (
                <li>
                  <a href={window.location.hash} aria-current="page">
                    Raport
                  </a>
                </li>
              )}
            </ul>
          </nav>
        </div>
      </header>

      <main id="tresc" className="container main" tabIndex={-1}>
        {route.name === 'analysis' ? (
          <AnalysisScreen
            values={formValues}
            onValuesChange={setFormValues}
            onResult={openReport}
            simulateError={SIMULATE_ERROR}
          />
        ) : (
          <ReportScreen
            request={route.request}
            cachedResult={lastResult}
            onChangeParcel={goToAnalysis}
            simulateError={SIMULATE_ERROR}
          />
        )}
      </main>

      <footer className="site-footer no-print">
        <div className="container">
          Prototyp na HackNation 2026 · wyzwanie KOWR „Zatrzymaj wodę, chroń plony”. Wersja demonstracyjna – wyniki
          dostępne tylko dla oznaczonych przykładów.
        </div>
      </footer>
    </div>
  );
}

function toFormValues(request: AnalysisRequest): FormValues {
  return { parcelId: request.parcelId, cropId: request.cropId, analysisDate: request.analysisDate };
}
