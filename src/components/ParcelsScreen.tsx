import { useId, useRef, useState, type FormEvent } from 'react';
import { cropLabel, isCropId } from '../data/crops';
import { CropPicker } from './CropPicker';
import { formatDatePl, todayInPoland } from '../lib/dates';
import { reportHash } from '../lib/route';
import { PARCEL_ID_FORMAT_ERROR, isValidParcelId, normalizeParcelId } from '../lib/validation';
import type { ParcelSummary, SavedParcel } from '../types/account';
import { PageHeader } from './AppShell';
import { Icon } from './Icon';
import { RiskBadge } from './RiskBadge';
import { SchematicMap } from './SchematicMap';
import { LoadingProgress } from './LoadingProgress';

interface Props {
  parcels: ParcelSummary[];
  /** Działki z konta (nie można ich usunąć w tej zakładce). */
  lockedIds: string[];
  onAdd: (parcel: SavedParcel) => void;
  onRemove: (parcelId: string) => void;
  onAnalyze: (parcel: SavedParcel) => void;
}

type AddErrors = Partial<Record<'name' | 'parcelId' | 'cropId', string>>;

export function ParcelsScreen({ parcels, lockedIds, onAdd, onRemove, onAnalyze }: Props) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', parcelId: '', cropId: '' });
  const [errors, setErrors] = useState<AddErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const ids = { name: useId(), parcelId: useId(), cropId: useId() };

  const totalArea = parcels.reduce((sum, item) => sum + (item.parcel?.areaHa ?? 0), 0);

  function openForm() {
    setAdding(true);
    setMessage(null);
    window.setTimeout(() => nameRef.current?.focus(), 0);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const parcelId = normalizeParcelId(draft.parcelId);
    const next: AddErrors = {};
    if (!draft.name.trim()) next.name = 'Podaj nazwę działki, np. „Pole za stodołą”.';
    if (!parcelId) next.parcelId = 'Podaj identyfikator działki ewidencyjnej.';
    else if (!isValidParcelId(parcelId)) next.parcelId = PARCEL_ID_FORMAT_ERROR;
    else if (parcels.some((item) => item.saved.parcelId === parcelId)) next.parcelId = 'Ta działka jest już na Twojej liście.';
    if (!isCropId(draft.cropId)) next.cropId = 'Wybierz uprawę.';
    setErrors(next);
    if (Object.keys(next).length > 0 || !isCropId(draft.cropId)) return;
    onAdd({ parcelId, name: draft.name.trim(), cropId: draft.cropId, addedOn: todayInPoland() });
    setMessage(`Dodano działkę „${draft.name.trim()}”.`);
    setDraft({ name: '', parcelId: '', cropId: '' });
    setAdding(false);
  }

  return (
    <div className="parcels">
      <PageHeader
        title="Moje działki"
        description={`${parcels.length} ${parcelWord(parcels.length)}${
          totalArea > 0 ? ` · ${totalArea.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} ha o znanej powierzchni` : ''
        }`}
        actions={
          !adding && (
            <button type="button" className="btn btn--primary" onClick={openForm}>
              <Icon name="plus" size={18} /> Dodaj działkę
            </button>
          )
        }
      />

      <div role="status" aria-live="polite">
        {message && <p className="status status--success">{message}</p>}
      </div>

      {adding && (
        <section className="panel add-parcel" aria-labelledby="tytul-dodaj">
          <div className="panel__header">
            <h2 id="tytul-dodaj">Dodaj działkę</h2>
            <button type="button" className="icon-button" onClick={() => setAdding(false)} aria-label="Zamknij formularz">
              <Icon name="x" />
            </button>
          </div>
          <form onSubmit={submit} noValidate className="add-parcel__form">
            <div className={`field${errors.name ? ' field--invalid' : ''}`}>
              <label htmlFor={ids.name}>Nazwa</label>
              <p className="field__hint" id={`${ids.name}-pomoc`}>Twoja nazwa, która pomoże rozpoznać pole.</p>
              {errors.name && <p className="field__error" id={`${ids.name}-blad`}>{errors.name}</p>}
              <input
                ref={nameRef}
                id={ids.name}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={`${errors.name ? `${ids.name}-blad ` : ''}${ids.name}-pomoc`}
                autoComplete="off"
              />
            </div>
            <div className={`field${errors.parcelId ? ' field--invalid' : ''}`}>
              <label htmlFor={ids.parcelId}>Identyfikator działki ewidencyjnej</label>
              <p className="field__hint" id={`${ids.parcelId}-pomoc`}>Np. 040705_5.0012.245/3</p>
              {errors.parcelId && <p className="field__error" id={`${ids.parcelId}-blad`}>{errors.parcelId}</p>}
              <input
                id={ids.parcelId}
                value={draft.parcelId}
                onChange={(event) => setDraft({ ...draft, parcelId: event.target.value })}
                aria-invalid={errors.parcelId ? true : undefined}
                aria-describedby={`${errors.parcelId ? `${ids.parcelId}-blad ` : ''}${ids.parcelId}-pomoc`}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className={`field${errors.cropId ? ' field--invalid' : ''}`}>
              <label htmlFor={ids.cropId}>Uprawa</label>
              <p className="field__hint" id={`${ids.cropId}-pomoc`}>Uprawa w bieżącym sezonie.</p>
              {errors.cropId && <p className="field__error" id={`${ids.cropId}-blad`}>{errors.cropId}</p>}
              <CropPicker
                id={ids.cropId}
                value={draft.cropId}
                onChange={(cropId) => setDraft({ ...draft, cropId })}
                ariaInvalid={Boolean(errors.cropId)}
                ariaDescribedBy={`${errors.cropId ? `${ids.cropId}-blad ` : ''}${ids.cropId}-pomoc`}
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn--primary">
                Zapisz działkę
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => setAdding(false)}>
                Anuluj
              </button>
            </div>
          </form>
        </section>
      )}

      {parcels.length === 0 ? (
        <div className="panel empty-state">
          <Icon name="parcels" size={28} />
          <p>Nie masz jeszcze zapisanych działek.</p>
        </div>
      ) : (
        <ul className="parcel-grid">
          {parcels.map((item) => (
            <li key={item.saved.parcelId} className="parcel-card">
              <div className="parcel-card__visual">
                {item.parcel ? (
                  <SchematicMap
                    parcel={item.parcel}
                    title={`Kształt działki ${item.saved.name}`}
                    showCaption={false}
                  />
                ) : (
                  <div className="parcel-card__placeholder">
                    {item.lookup === 'pending' ? (
                      <LoadingProgress compact expectedMs={4000} steps={[{ from: 0, label: 'Granica z ewidencji' }]} label="Pobieranie granicy działki" />
                    ) : (
                      <>
                        <Icon name="pin" size={28} />
                        <span>{item.lookupMessage ?? 'Nie znaleziono tej działki w ewidencji (ULDK) – sprawdź identyfikator.'}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="parcel-card__body">
                <div className="parcel-card__head">
                  <h2>{item.saved.name}</h2>
                  {item.lastAnalysis ? (
                    <RiskBadge level={item.lastAnalysis.level} />
                  ) : (
                    <span className="tag">Brak analizy</span>
                  )}
                </div>
                <dl className="meta-list">
                  <div>
                    <dt>Identyfikator</dt>
                    <dd className="mono">{item.saved.parcelId}</dd>
                  </div>
                  <div>
                    <dt>Położenie</dt>
                    <dd>{item.parcel ? `${item.parcel.locationLabel}, gm. ${item.parcel.commune}, woj. ${item.parcel.voivodeship}` : item.lookup === 'pending' ? 'pobieram…' : 'nieznane'}</dd>
                  </div>
                  <div>
                    <dt>Powierzchnia</dt>
                    <dd>{item.parcel?.areaHa != null ? `${item.parcel.areaHa.toLocaleString('pl-PL')} ha` : item.lookup === 'pending' ? 'pobieram…' : 'nieznana'}</dd>
                  </div>
                  <div>
                    <dt>Uprawa</dt>
                    <dd>{cropLabel(item.saved.cropId)}</dd>
                  </div>
                  <div>
                    <dt>Ostatnia analiza</dt>
                    <dd>{item.lastAnalysis ? formatDatePl(item.lastAnalysis.request.analysisDate) : 'brak'}</dd>
                  </div>
                </dl>
                <div className="parcel-card__actions">
                  {item.lastAnalysis && (
                    <a className="btn btn--small btn--primary" href={reportHash(item.lastAnalysis.request)}>
                      Otwórz raport
                    </a>
                  )}
                  <button type="button" className="btn btn--small btn--secondary" onClick={() => onAnalyze(item.saved)}>
                    Nowa analiza
                  </button>
                  {!lockedIds.includes(item.saved.parcelId) && (
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      onClick={() => onRemove(item.saved.parcelId)}
                      aria-label={`Usuń działkę ${item.saved.name} z listy`}
                    >
                      Usuń
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Odmiana: 1 działka, 2–4 działki (ale 12–14 działek), 0 i 5+ działek. */
function parcelWord(n: number): string {
  if (n === 1) return 'działka';
  const last = n % 10;
  const lastTwo = n % 100;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'działki' : 'działek';
}
