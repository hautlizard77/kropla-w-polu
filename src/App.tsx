import { useCallback, useEffect, useState } from 'react';
import { AnalysisScreen } from './components/AnalysisScreen';
import { Breadcrumbs, SiteFooter, SiteHeader } from './components/Layout';
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
      // Kotwice w obrębie strony (np. #o-prototypie) nie zmieniają widoku.
      if (!window.location.hash.startsWith('#/') && window.location.hash !== '') return;
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
      <SiteHeader current={route.name} />

      <main id="tresc" className="main" tabIndex={-1}>
        <div className="container">
          <Breadcrumbs
            items={
              route.name === 'analysis'
                ? [{ label: 'Woda na polu', href: ANALYSIS_HASH }, { label: 'Analiza działki' }]
                : [
                    { label: 'Woda na polu', href: ANALYSIS_HASH },
                    { label: 'Analiza działki', href: ANALYSIS_HASH },
                    { label: 'Raport' },
                  ]
            }
          />
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
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function toFormValues(request: AnalysisRequest): FormValues {
  return { parcelId: request.parcelId, cropId: request.cropId, analysisDate: request.analysisDate };
}
