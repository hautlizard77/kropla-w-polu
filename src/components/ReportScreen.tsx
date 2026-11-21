import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cropLabel } from '../data/crops';
import { STAGE_LABELS, cropDay } from '../data/cropParams';
import { CropBadge, CropPanel } from './CropPanel';
import { ReportTabs, TabPanel, type TabDef, type TabId } from './ReportTabs';
import { ForecastPanel } from './ForecastPanel';
import { fetchTerrain } from '../services/terrain';
import { formatDatePl, formatDateTimePl, formatMonthsPl, formatRangePl } from '../lib/dates';
import { AVAILABILITY_LABELS, CATEGORY_LABELS, DATA_KIND_LABELS } from '../lib/labels';
import { sameRequest } from '../lib/route';
import { AnalysisError, analyzeParcel } from '../services/analysis';
import type {
  AnalysisRequest,
  AnalysisResult,
  AnalysisUnavailable,
  Assessment,
  DataSource,
  Indicator,
  Recommendation,
} from '../types/analysis';
import { Icon } from './Icon';
import { Steps } from './Layout';
import { ParcelMap, type MapParcel } from './ParcelMap';
import { RiskBadge } from './RiskBadge';
import { SchematicMap } from './SchematicMap';

/** Moduł 3D ładowany dopiero po kliknięciu – raport otwiera się bez niego. */
const TerrainPanel = lazy(() => import('./terrain/TerrainPanel'));

class LoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <p className="status status--error" role="alert">
          Nie udało się wczytać modułu „Teren i spływ”. Odśwież stronę i spróbuj ponownie – pozostała część raportu działa bez niego.
        </p>
      );
    }
    return this.props.children;
  }
}

interface Props {
  request: AnalysisRequest | null;
  cachedResult: AnalysisResult | null;
  onChangeParcel: () => void;
  simulateError: boolean;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; result: AnalysisResult }
  | { kind: 'unavailable'; unavailable: AnalysisUnavailable }
  | { kind: 'error'; message: string }
  | { kind: 'invalid' };

export function ReportScreen({ request, cachedResult, onChangeParcel, simulateError }: Props) {
  const initial: State = !request
    ? { kind: 'invalid' }
    : cachedResult && sameRequest(cachedResult.request, request)
      ? { kind: 'ok', result: cachedResult }
      : { kind: 'loading' };
  const [state, setState] = useState<State>(initial);
  const [attempt, setAttempt] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!request) {
      setState({ kind: 'invalid' });
      return;
    }
    if (cachedResult && sameRequest(cachedResult.request, request)) {
      setState({ kind: 'ok', result: cachedResult });
      return;
    }
    const controller = new AbortController();
    setState({ kind: 'loading' });
    analyzeParcel(request, { signal: controller.signal, simulateError })
      .then((outcome) =>
        setState(outcome.status === 'ok' ? { kind: 'ok', result: outcome.result } : { kind: 'unavailable', unavailable: outcome.unavailable }),
      )
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({
          kind: 'error',
          message: error instanceof AnalysisError ? error.message : 'Wystąpił nieoczekiwany błąd.',
        });
      });
    return () => controller.abort();
    // Zapytanie porównujemy po wartościach, nie po referencji obiektu.
  }, [request?.parcelId, request?.cropId, request?.analysisDate, attempt, simulateError]);

  // Po wejściu na raport przenosimy fokus na nagłówek – czytnik ekranu ogłasza nowy widok.
  useEffect(() => {
    headingRef.current?.focus();
  }, [state.kind]);

  // Na wydruku rozwijamy wszystkie szczegóły, a potem przywracamy stan.
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      opened = Array.from(document.querySelectorAll<HTMLDetailsElement>('.report details:not([open])'));
      opened.forEach((element) => (element.open = true));
    };
    const after = () => {
      opened.forEach((element) => (element.open = false));
      opened = [];
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  if (state.kind !== 'ok') {
    return (
      <div className="report report--empty">
        <Steps current={2} />
        <h1 ref={headingRef} tabIndex={-1}>
          {state.kind === 'loading' ? 'Przygotowuję raport…' : 'Raport sytuacji wodnej'}
        </h1>
        {request && <RequestSummary request={request} />}
        <div role={state.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
          {state.kind === 'loading' && <p className="status status--loading">Analizuję dane dla działki…</p>}
          {state.kind === 'invalid' && (
            <p className="status status--info">Adres raportu jest niepełny. Wybierz działkę, uprawę i datę analizy.</p>
          )}
          {state.kind === 'unavailable' && <p className="status status--info">{state.unavailable.message}</p>}
          {state.kind === 'error' && (
            <p className="status status--error">
              <strong>Nie udało się wykonać analizy.</strong> {state.message}
            </p>
          )}
        </div>
        <div className="report-actions">
          <button type="button" className="btn btn--primary" onClick={onChangeParcel}>
            Zmień działkę
          </button>
          {state.kind === 'error' && (
            <button type="button" className="btn btn--secondary" onClick={() => setAttempt((n) => n + 1)}>
              Spróbuj ponownie
            </button>
          )}
        </div>
      </div>
    );
  }

  return <Report result={state.result} headingRef={headingRef} />;
}

function RequestSummary({ request }: { request: AnalysisRequest }) {
  return (
    <dl className="request-summary">
      <div>
        <dt>Działka</dt>
        <dd className="mono">{request.parcelId}</dd>
      </div>
      <div>
        <dt>Uprawa</dt>
        <dd>{cropLabel(request.cropId)}</dd>
      </div>
      <div>
        <dt>Data analizy</dt>
        <dd>{formatDatePl(request.analysisDate)}</dd>
      </div>
    </dl>
  );
}

function Report({
  result,
  headingRef,
}: {
  result: AnalysisResult;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const sourcesById = useMemo(() => new Map(result.dataSources.map((source) => [source.id, source])), [result]);
  const highlights = useMemo(
    () => result.recommendations.flatMap((rec) => (rec.suggestedArea ? [rec.suggestedArea] : [])),
    [result],
  );
  const mapParcels = useMemo<MapParcel[]>(
    () => [{ id: result.parcel.id, label: `Działka ${result.parcel.id}`, geometry: result.parcel.geometry }],
    [result],
  );
  const { parcel, request, currentState, historicalVulnerability } = result;
  const retention = result.recommendations.filter((rec) => rec.category === 'retencja');
  const agro = result.recommendations.filter((rec) => rec.category === 'agrotechnika');
  const cropToday = cropDay(request.cropId, request.analysisDate);
  const cropStageText = cropToday.inSeason ? STAGE_LABELS[cropToday.stage] : 'poza sezonem uprawy';
  const [tab, setTab] = useState<TabId>('podsumowanie');
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(() => new Set<TabId>(['podsumowanie']));
  const openTab = (id: TabId) => {
    setTab(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set([...prev, id])));
    const bar = document.getElementById('zakladki-raportu');
    if (bar && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Teren pobieramy od razu po otwarciu raportu – zakładka „Teren i spływ 3D” pokazuje go bez czekania.
  useEffect(() => {
    void import('./terrain/TerrainPanel');
    fetchTerrain(result.parcel.id).catch(() => undefined);
  }, [result.parcel.id]);

  const recCount = result.recommendations.length;
  const MAIN_STEPS = ['nawadnianie', 'zapas-wystarczy', 'deszcz-wystarczy', 'poza-sezonem', 'opady'];
  const mainStep =
    result.forecast?.status === 'ok'
      ? (result.forecast.steps.find((s) => MAIN_STEPS.includes(s.id)) ?? result.forecast.steps[0] ?? null)
      : null;
  const tabs: TabDef[] = [
    { id: 'podsumowanie', label: 'Podsumowanie', icon: 'home' },
    { id: 'uprawa', label: 'Uprawa', icon: 'leaf' },
    { id: 'sytuacja', label: 'Sytuacja wodna', icon: 'drop', level: currentState.level },
    { id: 'prognoza', label: 'Bilans i plan', icon: 'calendar' },
    { id: 'zalecenia', label: recCount > 0 ? `Co robić (${recCount})` : 'Co robić', icon: 'check' },
    { id: 'teren', label: 'Teren i spływ 3D', icon: 'parcels' },
    { id: 'zrodla', label: 'Źródła danych', icon: 'file' },
  ];

  return (
    <article className="report" aria-labelledby="tytul-raportu">
      <header className="report-header">
        <Steps current={2} />
        <p className="print-only print-brand">Kropla w Polu · raport sytuacji wodnej działki</p>
        <p className="eyebrow">Raport sytuacji wodnej</p>
        <h1 id="tytul-raportu" ref={headingRef} tabIndex={-1}>
          Działka {parcel.id}
        </h1>
        {result.isDemo && (
          <p className="data-note">
            <Icon name="info" size={18} />
            <span>
              <strong>Dane przykładowe.</strong> Wartości i granice działki w tym raporcie są ilustracyjne.
            </span>
          </p>
        )}
        <RequestSummary request={request} />
        <p className="muted report-header__meta">
          {parcel.locationLabel} · gm. {parcel.commune}, pow. {parcel.county}, woj. {parcel.voivodeship}
          {parcel.areaHa !== null && <> · {parcel.areaHa.toLocaleString('pl-PL')} ha</>} · wygenerowano{' '}
          {formatDateTimePl(result.generatedAt)}
        </p>
      </header>

      <ReportTabs tabs={tabs} active={tab} onSelect={openTab} />

      <TabPanel id="podsumowanie" active={tab}>
        <section className="report-summary" aria-labelledby="w-skrocie">
          <h2 id="w-skrocie">W skrócie</h2>
          <dl>
            <div>
              <dt>Uprawa</dt>
              <dd>
                <strong>{cropLabel(request.cropId)}</strong> – {cropStageText}.{' '}
                <button type="button" className="link-button no-print" onClick={() => openTab('uprawa')}>
                  Szczegóły i zmiana uprawy
                </button>
              </dd>
            </div>
            <div>
              <dt>Czy na polu brakuje wody?</dt>
              <dd>
                <RiskBadge level={currentState.level} />
                <span className="report-summary__headline">{currentState.headline}</span>{' '}
                <button type="button" className="link-button no-print" onClick={() => openTab('sytuacja')}>
                  Szczegóły
                </button>
              </dd>
            </div>
            {mainStep && (
              <div>
                <dt>Najbliższy tydzień</dt>
                <dd>
                  <strong>{mainStep.when}:</strong> {mainStep.title}.{' '}
                  <button type="button" className="link-button no-print" onClick={() => openTab('prognoza')}>
                    Bilans wody i plan
                  </button>
                </dd>
              </div>
            )}
            <div>
              <dt>Co na to wskazuje?</dt>
              <dd>{currentState.summary}</dd>
            </div>
            <div>
              <dt>Co możesz zrobić?</dt>
              <dd>
                {result.recommendations.length > 0 ? (
                  <ul>
                    {result.recommendations.map((rec) => (
                      <li key={rec.id}>{rec.title}</li>
                    ))}
                  </ul>
                ) : (
                  'Na razie brak zaleceń. Sprawdź, jak spływa woda na działce – w zakładce „Teren i spływ 3D”.'
                )}
                <button type="button" className="link-button no-print" onClick={() => openTab('zalecenia')}>
                  Zobacz zalecenia i nawadnianie
                </button>
              </dd>
            </div>
          </dl>
        </section>
      </TabPanel>

      <TabPanel id="uprawa" active={tab}>
        <CropPanel
          request={request}
          current={currentState}
          historical={historicalVulnerability}
          isDemo={result.isDemo}
          onNavigate={openTab}
        />
      </TabPanel>

      <TabPanel id="sytuacja" active={tab}>
        <section className="report-section" aria-labelledby="sekcja-sytuacja">
          <h2 id="sekcja-sytuacja" tabIndex={-1}>
            Sytuacja wodna
          </h2>
          <div className="assessment-grid">
            <AssessmentCard
              title={`Na dzień ${formatDatePl(currentState.asOf)}`}
              assessment={currentState}
              sourcesById={sourcesById}
              primary
              badge={<CropBadge cropId={request.cropId} />}
            />
            <AssessmentCard
              title="Podatność działki na suszę (historycznie)"
              subtitle={
                historicalVulnerability.period
                  ? `Dane z okresu ${formatRangePl(historicalVulnerability.period)}`
                  : 'Brak zakresu danych historycznych'
              }
              assessment={historicalVulnerability}
              sourcesById={sourcesById}
              badge={<CropBadge cropId={request.cropId} />}
              extra={
                historicalVulnerability.criticalMonths.length > 0 && (
                  <p>
                    <strong>Najczęstsze niedobory wody:</strong> {formatMonthsPl(historicalVulnerability.criticalMonths)}.
                  </p>
                )
              }
            />
          </div>
        </section>
      </TabPanel>

      <TabPanel id="prognoza" active={tab}>
        <ForecastPanel forecast={result.forecast} request={request} isDemo={result.isDemo} />
      </TabPanel>

      <TabPanel id="zalecenia" active={tab}>
        <section className="report-section" aria-labelledby="sekcja-dzialania">
          <h2 id="sekcja-dzialania" tabIndex={-1}>
            Co możesz zrobić
          </h2>
          {currentState.level === 'insufficient_data' && (
            <p className="status status--info">
              Ocena na wybrany dzień nie jest możliwa, dlatego zalecenia opierają się na historycznej podatności działki
              i dostępnych danych pogodowych.
            </p>
          )}
          {result.recommendations.length === 0 ? (
            <div className="status status--info">
              <p>
                Brak zaleceń – bez danych pogodowych i glebowych nie da się ich rzetelnie uzasadnić. Ukształtowanie terenu, spływ
                i obszar do sprawdzenia pod kątem retencji pokazuje zakładka „Teren i spływ 3D”.
              </p>
            </div>
          ) : (
            <div className="recommendations-layout">
              <div className="recommendations">
                <RecommendationGroup title={CATEGORY_LABELS.retencja} items={retention} sourcesById={sourcesById} />
                <RecommendationGroup title={CATEGORY_LABELS.agrotechnika} items={agro} sourcesById={sourcesById} />
              </div>
              <div className="recommendations-map">
                <h3>Działka na mapie</h3>
                <div className="no-print">
                  {/* Mapa Leaflet źle liczy rozmiar w ukrytym kontenerze – tworzymy ją przy pierwszym otwarciu zakładki. */}
                  {visited.has('zalecenia') && (
                    <ParcelMap
                      parcels={mapParcels}
                      selectedId={parcel.id}
                      highlights={highlights}
                      ariaLabel={`Mapa działki ${parcel.id} z sugerowanymi obszarami działań`}
                    />
                  )}
                  {highlights.length > 0 && (
                    <p className="legend-row">
                      <span className="legend legend--parcel">Granica działki</span>
                      <span className="legend legend--area">Sugerowany obszar działania</span>
                    </p>
                  )}
                </div>
                <SchematicMap
                  className="print-only"
                  parcel={parcel}
                  highlights={highlights}
                  title={`Szkic działki ${parcel.id} z sugerowanymi obszarami`}
                />
              </div>
            </div>
          )}

          <div className="irrigation">
            <h3>
              Nawadnianie <CropBadge cropId={request.cropId} />
            </h3>
            {!result.irrigation || result.irrigation.status === 'not_calculated' ? (
              <p className="muted">
                {result.irrigation?.note ?? 'Brak oceny nawadniania.'} Decyzję o nawadnianiu warto omówić z doradcą.
              </p>
            ) : (
              <p>{result.irrigation.summary}</p>
            )}
          </div>
        </section>
      </TabPanel>

      <TabPanel id="teren" active={tab}>
        {/* Dane terenu pobierają się w tle od otwarcia raportu; widok 3D tworzymy przy pierwszym wejściu w zakładkę. */}
        {visited.has('teren') ? (
          <LoadBoundary>
            <Suspense
              fallback={
                <p className="status status--loading" role="status">
                  Wczytuję moduł „Teren i spływ”…
                </p>
              }
            >
              <TerrainPanel parcelId={parcel.id} analysisDate={request.analysisDate} />
            </Suspense>
          </LoadBoundary>
        ) : (
          <p className="print-only muted">Analiza terenu i spływu jest dostępna w wersji internetowej raportu.</p>
        )}
      </TabPanel>

      <TabPanel id="zrodla" active={tab}>
        <section className="report-section" aria-labelledby="sekcja-dane">
          <h2 id="sekcja-dane" tabIndex={-1}>
            Na czym opiera się wynik
          </h2>
          <div className="table-wrap">
            <table className="sources-table">
              <caption className="visually-hidden">Źródła danych użyte w analizie</caption>
              <thead>
                <tr>
                  <th scope="col">Rodzaj danych</th>
                  <th scope="col">Źródło</th>
                  <th scope="col">Stan danych</th>
                  <th scope="col">Data obserwacji</th>
                  <th scope="col">Zakres danych</th>
                  <th scope="col">Data pobrania</th>
                </tr>
              </thead>
              <tbody>
                {result.dataSources.map((source) => (
                  <tr key={source.id}>
                    <th scope="row">{DATA_KIND_LABELS[source.kind]}</th>
                    <td>
                      {source.name}
                      <br />
                      <span className="muted">{source.provider}</span>
                    </td>
                    <td>
                      <span className={`availability availability--${source.availability}`}>
                        {AVAILABILITY_LABELS[source.availability]}
                      </span>
                    </td>
                    <td>{source.observationDate ? formatDatePl(source.observationDate) : '—'}</td>
                    <td>{source.coverage ? formatRangePl(source.coverage) : '—'}</td>
                    <td>{source.retrievedAt ? formatDatePl(source.retrievedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="source-details">
            {result.dataSources.map((source) => (
              <SourceDetails key={source.id} source={source} />
            ))}
          </div>

          <h3>Ograniczenia analizy</h3>
          <ul className="limitations">
            {result.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
          <p className="muted small">
            Data analizy to dzień, dla którego oceniamy sytuację. Data obserwacji to dzień, którego dotyczą dane – nigdy
            nie jest późniejsza niż data analizy. Data pobrania to moment, w którym system pobrał dane.
          </p>
        </section>
      </TabPanel>

      <div className="report-actions report-actions--end no-print">
        <button type="button" className="btn btn--primary" onClick={() => window.print()}>
          <Icon name="printer" size={18} /> Drukuj lub zapisz PDF
        </button>
      </div>
    </article>
  );
}

function AssessmentCard({
  title,
  subtitle,
  assessment,
  sourcesById,
  primary = false,
  extra,
  badge,
}: {
  title: string;
  subtitle?: string;
  assessment: Assessment;
  sourcesById: Map<string, DataSource>;
  primary?: boolean;
  extra?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className={`assessment assessment--${assessment.level}${primary ? ' assessment--primary' : ''}`}>
      <h3>
        {title} {badge}
      </h3>
      {subtitle && <p className="muted small">{subtitle}</p>}
      <RiskBadge level={assessment.level} />
      <p className="assessment__headline">{assessment.headline}</p>
      <p>{assessment.summary}</p>
      {extra}
      {assessment.indicators.length > 0 && (
        <details className="indicators">
          <summary>Wskaźniki ({assessment.indicators.length})</summary>
          <ul>
            {assessment.indicators.map((indicator) => (
              <IndicatorItem key={indicator.id} indicator={indicator} source={sourcesById.get(indicator.sourceId)} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function IndicatorItem({ indicator, source }: { indicator: Indicator; source: DataSource | undefined }) {
  return (
    <li className="indicator">
      <div className="indicator__head">
        <span>{indicator.label}</span>
        <strong className={indicator.value === null ? 'indicator__missing' : undefined}>
          {formatValue(indicator.value, indicator.unit)}
        </strong>
      </div>
      {indicator.reference && (
        <p className="small muted">
          Odniesienie ({indicator.reference.label}): {formatValue(indicator.reference.value, indicator.unit)}
        </p>
      )}
      <p className="small">{indicator.interpretation}</p>
      <p className="small muted">
        {indicator.observedOn ? `Obserwacja z ${formatDatePl(indicator.observedOn)}` : 'Bez daty obserwacji'}
        {source && ` · ${source.name}`}
        {indicator.isIndirect && (
          <>
            {' '}
            · <span className="tag">dowód pośredni</span>
          </>
        )}
      </p>
    </li>
  );
}

function formatValue(value: number | string | null, unit: string): string {
  if (value === null) return 'brak danych';
  if (typeof value === 'string') return value;
  const number = value.toLocaleString('pl-PL', { maximumFractionDigits: 2 });
  return unit ? `${number} ${unit}` : number;
}

function RecommendationGroup({
  title,
  items,
  sourcesById,
}: {
  title: string;
  items: Recommendation[];
  sourcesById: Map<string, DataSource>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="recommendation-group">
      <h3>{title}</h3>
      <ol className="recommendation-list">
        {items.map((rec) => (
          <li key={rec.id} className="recommendation">
            <h4>{rec.title}</h4>
            <p>
              <strong>Działanie:</strong> {rec.action}
            </p>
            <p>
              <strong>Dlaczego:</strong> {rec.rationale}
            </p>
            {rec.evidenceSourceIds.length > 0 && (
              <p className="small muted">
                Na podstawie:{' '}
                {rec.evidenceSourceIds
                  .map((id) => sourcesById.get(id))
                  .filter((source): source is DataSource => Boolean(source))
                  .map((source) => DATA_KIND_LABELS[source.kind].toLowerCase())
                  .join(', ')}
              </p>
            )}
            {rec.fieldChecks.length > 0 && (
              <div className="field-checks">
                <p>
                  <strong>Sprawdź w terenie:</strong>
                </p>
                <ul>
                  {rec.fieldChecks.map((check) => (
                    <li key={check}>{check}</li>
                  ))}
                </ul>
              </div>
            )}
            {rec.suggestedArea && (
              <p className="small">
                <span className="legend legend--area">Na mapie: {rec.suggestedArea.label}</span>
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function SourceDetails({ source }: { source: DataSource }) {
  return (
    <details className="source">
      <summary>
        {DATA_KIND_LABELS[source.kind]}: {source.name}{' '}
        <span className="muted">({AVAILABILITY_LABELS[source.availability].toLowerCase()})</span>
      </summary>
      <dl className="source__meta">
        <div>
          <dt>Dostawca</dt>
          <dd>
            {source.provider}
            {source.url && (
              <>
                {' '}
                – <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Licencja / warunki</dt>
          <dd>{source.license ?? 'brak informacji'}</dd>
        </div>
        <div>
          <dt>Data obserwacji</dt>
          <dd>{formatDatePl(source.observationDate)}</dd>
        </div>
        <div>
          <dt>Zakres danych</dt>
          <dd>{formatRangePl(source.coverage)}</dd>
        </div>
        <div>
          <dt>Data pobrania</dt>
          <dd>{formatDatePl(source.retrievedAt)}</dd>
        </div>
        {source.details && (
          <div>
            <dt>Szczegóły</dt>
            <dd>{source.details}</dd>
          </div>
        )}
      </dl>
      {source.limitations.length > 0 && (
        <>
          <p>
            <strong>Ograniczenia:</strong>
          </p>
          <ul>
            {source.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
