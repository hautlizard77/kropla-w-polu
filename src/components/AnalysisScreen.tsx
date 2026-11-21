import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CROPS, cropLabel } from '../data/crops';
import { DEMO_PARCELS, DEMO_SCENARIOS, type DemoScenario } from '../data/demoScenarios';
import { earliestAnalysisDate, formatDatePl, todayInPoland } from '../lib/dates';
import { normalizeParcelId, validateForm, type FieldErrors, type FormValues } from '../lib/validation';
import { AnalysisError, analyzeParcel } from '../services/analysis';
import type { AnalysisRequest, AnalysisResult, AnalysisUnavailable } from '../types/analysis';
import { ImportantNotice, Steps } from './Layout';
import { ParcelMap, type MapParcel } from './ParcelMap';

interface Props {
  values: FormValues;
  onValuesChange: (values: FormValues) => void;
  onResult: (result: AnalysisResult) => void;
  simulateError: boolean;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'unavailable'; unavailable: AnalysisUnavailable }
  | { kind: 'error'; message: string };

const MAP_PARCELS: MapParcel[] = DEMO_PARCELS.map(({ parcel, scenario }) => ({
  id: parcel.id,
  label: `${parcel.id} – ${scenario.title}`,
  geometry: parcel.geometry,
}));

export function AnalysisScreen({ values, onValuesChange, onResult, simulateError }: Props) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const fieldRefs = {
    parcelId: useRef<HTMLInputElement>(null),
    cropId: useRef<HTMLSelectElement>(null),
    analysisDate: useRef<HTMLInputElement>(null),
  };
  const ids = { parcelId: useId(), cropId: useId(), analysisDate: useId() };
  const today = todayInPoland();
  const earliest = earliestAnalysisDate(today);

  useEffect(() => () => abortRef.current?.abort(), []);

  const normalizedParcelId = normalizeParcelId(values.parcelId);
  const selectedDemo = DEMO_PARCELS.find(({ parcel }) => parcel.id === normalizedParcelId)?.scenario ?? null;

  function update(field: keyof FormValues, value: string) {
    onValuesChange({ ...values, [field]: value });
    if (errors[field]) setErrors({ ...errors, [field]: undefined });
    if (status.kind === 'unavailable' || status.kind === 'error') setStatus({ kind: 'idle' });
  }

  async function run(request: AnalysisRequest) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ kind: 'loading' });
    try {
      const outcome = await analyzeParcel(request, { signal: controller.signal, simulateError });
      if (outcome.status === 'ok') {
        setStatus({ kind: 'idle' });
        onResult(outcome.result);
      } else {
        setStatus({ kind: 'unavailable', unavailable: outcome.unavailable });
        const field = outcome.unavailable.hint?.field ?? 'parcelId';
        fieldRefs[field].current?.focus();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message =
        error instanceof AnalysisError ? error.message : 'Wystąpił nieoczekiwany błąd. Spróbuj ponownie za chwilę.';
      setStatus({ kind: 'error', message });
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const validation = validateForm(values, today);
    if (validation.errors) {
      setErrors(validation.errors);
      setStatus({ kind: 'idle' });
      const first = (['parcelId', 'cropId', 'analysisDate'] as const).find((field) => validation.errors[field]);
      if (first) fieldRefs[first].current?.focus();
      return;
    }
    setErrors({});
    void run(validation.request);
  }

  function tryExample(scenario: DemoScenario) {
    setErrors({});
    onValuesChange({ ...scenario.request });
    void run(scenario.request);
  }

  function applyScenarioInputs(scenario: DemoScenario) {
    setErrors({});
    setStatus({ kind: 'idle' });
    onValuesChange({ ...scenario.request });
  }

  function selectOnMap(parcelId: string) {
    update('parcelId', parcelId);
  }

  const unavailable = status.kind === 'unavailable' ? status.unavailable : null;
  const fieldMessage = (field: keyof FormValues): string | undefined => {
    if (errors[field]) return errors[field];
    if (!unavailable) return undefined;
    if (unavailable.hint?.field === field) return unavailable.message;
    if (!unavailable.hint && field === 'parcelId') return unavailable.message;
    return undefined;
  };
  const isLoading = status.kind === 'loading';
  const firstExample = DEMO_SCENARIOS[0] as DemoScenario;

  return (
    <div className="analysis">
      <section className="intro" aria-labelledby="tytul-analizy">
        <Steps current={1} />
        <h1 id="tytul-analizy" tabIndex={-1}>
          Sprawdź, czy Twojemu polu brakuje wody
        </h1>
        <p className="lead">
          Wskaż działkę, wybierz uprawę i dzień. Dowiesz się, czy na polu występuje niedobór wody, co go powoduje
          i jak możesz zatrzymać wodę na swojej ziemi.
        </p>
        <ul className="intro__facts">
          <li>Bez logowania i zakładania konta</li>
          <li>Raport do wydruku lub zapisu w PDF</li>
          <li>Wynik do omówienia z doradcą rolnym</li>
        </ul>
      </section>

      <div className="analysis__grid">
        <section className="card form-card" aria-labelledby="tytul-formularza">
          <h2 id="tytul-formularza">Dane do analizy</h2>
          <form onSubmit={handleSubmit} noValidate aria-busy={isLoading}>
            <Field
              id={ids.parcelId}
              label="Identyfikator działki ewidencyjnej"
              hint="Znajdziesz go w wypisie z ewidencji gruntów lub na Geoportalu. Możesz też kliknąć działkę na mapie."
              message={fieldMessage('parcelId')}
            >
              <input
                ref={fieldRefs.parcelId}
                id={ids.parcelId}
                name="parcelId"
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="np. 040705_5.0012.245/3"
                value={values.parcelId}
                onChange={(event) => update('parcelId', event.target.value)}
                aria-invalid={fieldMessage('parcelId') ? true : undefined}
                aria-describedby={describedBy(ids.parcelId, fieldMessage('parcelId'))}
              />
            </Field>

            {selectedDemo && !(selectedDemo.request.cropId === values.cropId && selectedDemo.request.analysisDate === values.analysisDate) && (
              <div className="inline-hint" role="note">
                <p>
                  To działka z przykładu demonstracyjnego. Analiza jest dostępna dla uprawy{' '}
                  <strong>{cropLabel(selectedDemo.request.cropId)}</strong> i dnia{' '}
                  <strong>{formatDatePl(selectedDemo.request.analysisDate)}</strong>.
                </p>
                <button type="button" className="btn btn--small btn--secondary" onClick={() => applyScenarioInputs(selectedDemo)}>
                  Ustaw dane przykładu
                </button>
              </div>
            )}

            <Field id={ids.cropId} label="Uprawa" hint="Uprawa, która jest teraz na polu lub była w wybranym dniu." message={fieldMessage('cropId')}>
              <select
                ref={fieldRefs.cropId}
                id={ids.cropId}
                name="cropId"
                value={values.cropId}
                onChange={(event) => update('cropId', event.target.value)}
                aria-invalid={fieldMessage('cropId') ? true : undefined}
                aria-describedby={describedBy(ids.cropId, fieldMessage('cropId'))}
              >
                <option value="">Wybierz uprawę</option>
                {CROPS.map((crop) => (
                  <option key={crop.id} value={crop.id}>
                    {crop.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              id={ids.analysisDate}
              label="Data analizy"
              hint={`Dzień, dla którego oceniamy sytuację – od ${formatDatePl(earliest)} do dziś.`}
              message={fieldMessage('analysisDate')}
            >
              <input
                ref={fieldRefs.analysisDate}
                id={ids.analysisDate}
                name="analysisDate"
                type="date"
                min={earliest}
                max={today}
                value={values.analysisDate}
                onChange={(event) => update('analysisDate', event.target.value)}
                aria-invalid={fieldMessage('analysisDate') ? true : undefined}
                aria-describedby={describedBy(ids.analysisDate, fieldMessage('analysisDate'))}
              />
            </Field>

            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={isLoading}>
                {isLoading ? 'Sprawdzam…' : 'Sprawdź sytuację wodną'}
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => tryExample(firstExample)} disabled={isLoading}>
                Wypróbuj przykład
              </button>
            </div>

            <div className="form-status" role="status" aria-live="polite">
              {isLoading && <p className="status status--loading">Analizuję dane dla działki…</p>}
              {unavailable && (
                <p className="status status--info">
                  Nie ma analizy dla tego zestawu danych. Dane formularza zostały zachowane – możesz je poprawić albo
                  otworzyć jeden z przykładów poniżej.
                </p>
              )}
            </div>
            {status.kind === 'error' && (
              <div className="status status--error" role="alert">
                <p>
                  <strong>Nie udało się wykonać analizy.</strong> {status.message}
                </p>
                <button type="submit" className="btn btn--small btn--secondary">
                  Spróbuj ponownie
                </button>
              </div>
            )}
          </form>
        </section>

        <section className="card map-card" aria-labelledby="tytul-mapy">
          <h2 id="tytul-mapy">Mapa</h2>
          <p className="muted">Kliknij jedną z przykładowych działek, aby wpisać jej identyfikator do formularza.</p>
          <ParcelMap
            parcels={MAP_PARCELS}
            selectedId={selectedDemo ? normalizedParcelId : null}
            onSelect={selectOnMap}
            ariaLabel="Mapa z przykładowymi działkami"
          />
        </section>
      </div>

      <section className="examples" aria-labelledby="tytul-przykladow">
        <h2 id="tytul-przykladow">Przykłady</h2>
        <ImportantNotice title="Dane demonstracyjne">
          <p>
            W tej wersji analiza działa tylko dla trzech przykładów. Dane, granice działek i zalecenia są ilustracyjne.
          </p>
        </ImportantNotice>
        <ul className="example-list">
          {DEMO_SCENARIOS.map((scenario) => (
            <li key={scenario.id} className="example">
              <h3>{scenario.title}</h3>
              <p>{scenario.summary}</p>
              <dl className="example__meta">
                <div>
                  <dt>Działka</dt>
                  <dd className="mono">{scenario.request.parcelId}</dd>
                </div>
                <div>
                  <dt>Uprawa</dt>
                  <dd>{cropLabel(scenario.request.cropId)}</dd>
                </div>
                <div>
                  <dt>Data</dt>
                  <dd>{formatDatePl(scenario.request.analysisDate)}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="btn btn--small btn--secondary"
                onClick={() => tryExample(scenario)}
                disabled={isLoading}
                aria-label={`Otwórz raport: ${scenario.title}`}
              >
                Otwórz raport
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function describedBy(id: string, message: string | undefined): string {
  return message ? `${id}-blad ${id}-pomoc` : `${id}-pomoc`;
}

function Field({
  id,
  label,
  hint,
  message,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  message: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={`field${message ? ' field--invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {message && (
        <p id={`${id}-blad`} className="field__error">
          <span aria-hidden="true">! </span>
          {message}
        </p>
      )}
      <p id={`${id}-pomoc`} className="field__hint">
        {hint}
      </p>
    </div>
  );
}
