import { getCrop, cropLabel, isCropId } from '../data/crops';
import { CROP_PARAMS, STAGE_LABELS, cropDay, cropPhases, dayOfYear, droughtSensitivity, waterDemand, type Stage } from '../data/cropParams';
import { formatDatePl, formatMonthsPl } from '../lib/dates';
import { reportHash } from '../lib/route';
import type { AnalysisRequest } from '../types/analysis';
import { CropPicker } from './CropPicker';
import { Icon } from './Icon';

const STAGE_SHORT: Record<Exclude<Stage, 'poza_sezonem'>, string> = {
  poczatkowa: 'Początek',
  rozwoju: 'Rozwój',
  srodkowa: 'Pełny rozwój',
  koncowa: 'Dojrzewanie',
};

const MONTH_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
/** Oś czasu: od marca do listopada – tu mieszczą się sezony wszystkich upraw z listy. */
const AXIS_FROM_MONTH = 3;
const AXIS_TO_MONTH = 11;

/** Oznaczenie wyniku, który zmienia się po zmianie uprawy. */
export function CropBadge({ cropId }: { cropId: AnalysisRequest['cropId'] }) {
  return (
    <span className="crop-badge" title={`Ten wynik liczony jest dla uprawy: ${cropLabel(cropId)}. Inna uprawa da inny wynik.`}>
      <Icon name="leaf" size={14} /> Zależy od uprawy
    </span>
  );
}

export function changeCrop(request: AnalysisRequest, cropId: string) {
  if (isCropId(cropId) && cropId !== request.cropId) window.location.hash = reportHash({ ...request, cropId });
}

export function CropPanel({
  request,
  historical,
  isDemo = false,
  onNavigate,
}: {
  isDemo?: boolean;
  onNavigate: (tab: 'sytuacja' | 'zalecenia' | 'prognoza') => void;
  request: AnalysisRequest;
  historical: { criticalMonths: number[] };
}) {
  const crop = getCrop(request.cropId);
  const params = CROP_PARAMS[request.cropId];
  const day = cropDay(request.cropId, request.analysisDate);
  const year = Number(request.analysisDate.slice(0, 4));
  const axisStart = dayOfYear(`${String(AXIS_FROM_MONTH).padStart(2, '0')}-01`, year);
  const axisEnd = dayOfYear(`${String(AXIS_TO_MONTH + 1).padStart(2, '0')}-01`, year);
  const pct = (doy: number) => `${Math.min(100, Math.max(0, ((doy - axisStart) / (axisEnd - axisStart)) * 100))}%`;
  const today = dayOfYear(request.analysisDate.slice(5), year);
  const todayOnAxis = today >= axisStart && today < axisEnd;
  const phases = cropPhases(request.cropId, year);
  const sensitive = droughtSensitivity(params.p);
  const months = Array.from({ length: AXIS_TO_MONTH - AXIS_FROM_MONTH + 1 }, (_, i) => AXIS_FROM_MONTH + i);

  return (
    <section className="report-section crop-panel" aria-labelledby="twoja-uprawa">
      <div className="crop-panel__head">
        <h2 id="twoja-uprawa" tabIndex={-1}>
          <Icon name="leaf" size={22} /> Twoja uprawa: {crop?.label ?? request.cropId}
        </h2>
        <div className="crop-panel__switch no-print">
          <label htmlFor="inna-uprawa">Sprawdź dla innej uprawy</label>
          <CropPicker id="inna-uprawa" value={request.cropId} onChange={(cropId) => changeCrop(request, cropId)} placeholder="Wpisz nazwę uprawy" />
        </div>
      </div>
      {isDemo && (
        <p className="crop-panel__demo no-print">
          To przykład demonstracyjny przygotowany dla jednej uprawy. Porównanie upraw działa dla każdej prawdziwej działki.
        </p>
      )}

      <p className="crop-panel__lead">
        Na dzień {formatDatePl(request.analysisDate)}:{' '}
        {day.inSeason ? (
          <>
            <strong>{STAGE_LABELS[day.stage]}</strong>.
          </>
        ) : (
          <>
            <strong>poza sezonem</strong> – w modelu pole jest wtedy bez okrywy (ściernisko lub przed siewem).
          </>
        )}
      </p>

      <dl className="crop-facts">
        <div>
          <dt>Zapotrzebowanie na wodę</dt>
          <dd>
            <strong>{waterDemand(day.kc)}</strong>
            <span className="muted small"> · współczynnik Kc {day.kc.toLocaleString('pl-PL', { maximumFractionDigits: 2 })}</span>
          </dd>
        </div>
        <div>
          <dt>Korzenie sięgają</dt>
          <dd>
            <strong>{day.zr.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} m</strong>
            <span className="muted small"> · maks. {params.zrMax.toLocaleString('pl-PL')} m</span>
          </dd>
        </div>
        <div>
          <dt>Wrażliwość na suszę</dt>
          <dd>
            <strong>{sensitive}</strong>
            <span className="muted small">
              {' '}
              · stres po zużyciu {Math.round(params.p * 100)}% wody dostępnej
            </span>
          </dd>
        </div>
        <div>
          <dt>Okres największej wrażliwości</dt>
          <dd>
            <strong>{formatMonthsPl(crop?.criticalMonths ?? [])}</strong>
          </dd>
        </div>
      </dl>

      <figure className="crop-timeline">
        <figcaption className="visually-hidden">
          Kalendarz uprawy {crop?.label}: siew lub ruszenie wegetacji {formatDatePl(`${year}-${params.start}`)}, zbiór{' '}
          {formatDatePl(`${year}-${params.harvest}`)}.
        </figcaption>
        <div className="crop-timeline__track" aria-hidden="true">
          {phases.map((phase) => (
            <span
              key={phase.stage}
              className={`crop-timeline__phase crop-timeline__phase--${phase.stage}${day.stage === phase.stage ? ' is-current' : ''}`}
              style={{ left: pct(phase.from), width: `calc(${pct(phase.to)} - ${pct(phase.from)})` }}
              title={`${STAGE_SHORT[phase.stage]}`}
            >
              <span className="crop-timeline__label">{STAGE_SHORT[phase.stage]}</span>
            </span>
          ))}
          {historical.criticalMonths.map((m) => {
            const from = dayOfYear(`${String(m).padStart(2, '0')}-01`, year);
            const to = m === 12 ? axisEnd : dayOfYear(`${String(m + 1).padStart(2, '0')}-01`, year);
            return <span key={m} className="crop-timeline__risk" style={{ left: pct(from), width: `calc(${pct(to)} - ${pct(from)})` }} />;
          })}
          {todayOnAxis && (
            <span className="crop-timeline__today" style={{ left: pct(today) }}>
              <span>{formatDatePl(request.analysisDate)}</span>
            </span>
          )}
        </div>
        <div className="crop-timeline__months" aria-hidden="true">
          {months.map((m) => (
            <span key={m}>{MONTH_SHORT[m - 1]}</span>
          ))}
        </div>
        <p className="legend-row small">
          <span className="legend legend--phase">Fazy uprawy (typowy kalendarz)</span>
          {historical.criticalMonths.length > 0 && <span className="legend legend--risk">Miesiące z niedoborem wody w historii działki</span>}
          {todayOnAxis && <span className="legend legend--today">Data analizy</span>}
        </p>
      </figure>

      <p className="crop-results muted small">
        Od uprawy zależą:{' '}
        <button type="button" className="link-button" onClick={() => onNavigate('sytuacja')}>
          ocena sytuacji wodnej
        </button>
        ,{' '}
        <button type="button" className="link-button" onClick={() => onNavigate('zalecenia')}>
          zalecenia
        </button>{' '}
        i{' '}
        <button type="button" className="link-button" onClick={() => onNavigate('prognoza')}>
          nawadnianie
        </button>
        . Teren, gleba, opady i cieki są takie same dla każdej uprawy. Parametry uprawy: {params.note}
      </p>
    </section>
  );
}
