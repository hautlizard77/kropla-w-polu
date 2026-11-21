import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cropLabel } from '../data/crops';
import { formatDatePl, formatDateTimePl, formatMonthsPl, formatRangePl } from '../lib/dates';
import { DATA_STATUS_LABELS, CATEGORY_LABELS, DATA_KIND_LABELS } from '../lib/labels';
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
import { ParcelMap, type MapParcel } from './ParcelMap';
import { RiskBadge } from './RiskBadge';
import { SchematicMap } from './SchematicMap';

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

  return <Report result={state.result} headingRef={headingRef} onChangeParcel={onChangeParcel} />;
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
  onChangeParcel,
}: {
  result: AnalysisResult;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onChangeParcel: () => void;
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

  return (
    <article className="report" aria-labelledby="tytul-raportu">
      <header className="report-header">
        {result.isDemo && (
          <p className="demo-banner">
            <strong>Dane demonstracyjne.</strong> Wartości, granice działki i zalecenia są ilustracyjne – nie opisują
            rzeczywistej działki.
          </p>
        )}
        <h1 id="tytul-raportu" ref={headingRef} tabIndex={-1}>
          Raport sytuacji wodnej działki
        </h1>
        <RequestSummary request={request} />
        <p className="muted report-header__meta">
          {parcel.locationLabel} · gm. {parcel.commune}, pow. {parcel.county}, woj. {parcel.voivodeship}
          {parcel.areaHa !== null && <> · {parcel.areaHa.toLocaleString('pl-PL')} ha</>} · wygenerowano{' '}
          {formatDateTimePl(result.generatedAt)}
        </p>
        <div className="report-actions no-print">
          <button type="button" className="btn btn--secondary" onClick={onChangeParcel}>
            Zmień działkę
          </button>
          <button type="button" className="btn btn--primary" onClick={() => window.print()}>
            Drukuj lub zapisz PDF
          </button>
        </div>
      </header>

      {/* 1. Sytuacja wodna */}
      <section className="report-section" aria-labelledby="sekcja-sytuacja">
        <h2 id="sekcja-sytuacja">
          <span className="section-number">1</span> Sytuacja wodna
        </h2>
        <div className="assessment-grid">
          <AssessmentCard
            title={`Na dzień ${formatDatePl(currentState.asOf)}`}
            assessment={currentState}
            sourcesById={sourcesById}
            primary
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

      {/* 2. Co możesz zrobić */}
      <section className="report-section" aria-labelledby="sekcja-dzialania">
        <h2 id="sekcja-dzialania">
          <span className="section-number">2</span> Co możesz zrobić
        </h2>
        {currentState.level === 'insufficient_data' && (
          <p className="status status--info">
            Ocena na wybrany dzień nie jest możliwa, dlatego zalecenia opierają się na historycznej podatności działki
            i dostępnych danych pogodowych.
          </p>
        )}
        {result.recommendations.length === 0 ? (
          <p>Brak zaleceń – dane nie pozwalają ich rzetelnie uzasadnić.</p>
        ) : (
          <div className="recommendations-layout">
            <div className="recommendations">
              <RecommendationGroup title={CATEGORY_LABELS.retencja} items={retention} sourcesById={sourcesById} />
              <RecommendationGroup title={CATEGORY_LABELS.agrotechnika} items={agro} sourcesById={sourcesById} />
            </div>
            <div className="recommendations-map">
              <h3>Działka na mapie</h3>
              <div className="no-print">
                <ParcelMap
                  parcels={mapParcels}
                  selectedId={parcel.id}
                  highlights={highlights}
                  ariaLabel={`Mapa działki ${parcel.id} z sugerowanymi obszarami działań`}
                />
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
          <h3>Nawadnianie</h3>
          {!result.irrigation || result.irrigation.status === 'not_calculated' ? (
            <p className="muted">
              {result.irrigation?.note ?? 'Brak oceny nawadniania.'} Decyzję o nawadnianiu warto omówić z doradcą.
            </p>
          ) : (
            <p>{result.irrigation.summary}</p>
          )}
        </div>
      </section>

      {/* 3. Na czym opiera się wynik */}
      <section className="report-section" aria-labelledby="sekcja-dane">
        <h2 id="sekcja-dane">
          <span className="section-number">3</span> Na czym opiera się wynik
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
                    <span className={`availability availability--${source.status}`}>
                      {DATA_STATUS_LABELS[source.status]}
                    </span>
                  </td>
                  <td>{source.observationDate ? formatDatePl(source.observationDate) : '—'}</td>
                  <td>{source.coverage ? formatRangePl(source.coverage) : '—'}</td>
                  <td>{source.retrievedAt ? formatDatePl(source.retrievedAt) : 'nie pobrano'}</td>
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
}: {
  title: string;
  subtitle?: string;
  assessment: Assessment;
  sourcesById: Map<string, DataSource>;
  primary?: boolean;
  extra?: ReactNode;
}) {
  return (
    <div className={`assessment assessment--${assessment.level}${primary ? ' assessment--primary' : ''}`}>
      <h3>{title}</h3>
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
              <div className="evidence">
                <p>
                  <strong>Dowody:</strong>
                </p>
                <ul>
                  {rec.evidenceSourceIds
                    .map((id) => sourcesById.get(id))
                    .filter((source): source is DataSource => Boolean(source))
                    .map((source) => (
                      <li key={source.id} className="small">
                        {DATA_KIND_LABELS[source.kind]}: {source.name} –{' '}
                        {source.observationDate ? `obserwacja z ${formatDatePl(source.observationDate)}` : 'bez daty obserwacji'}
                        {' · '}
                        {DATA_STATUS_LABELS[source.status].toLowerCase()}
                        {source.limitations[0] && <span className="muted"> · ograniczenie: {source.limitations[0]}</span>}
                      </li>
                    ))}
                </ul>
              </div>
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
        <span className="muted">({DATA_STATUS_LABELS[source.status].toLowerCase()})</span>
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
