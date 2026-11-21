import { cropLabel } from '../data/crops';
import { formatDateTimePl, todayInPoland } from '../lib/dates';
import { reportHash } from '../lib/route';
import type { AnalysisRequest, ForecastBalance, ForecastStep, IrrigationPlan, WaterForecast } from '../types/analysis';
import { CropBadge } from './CropPanel';
import { Icon } from './Icon';
import { RiskBadge } from './RiskBadge';

const WEEKDAYS = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
const shortDate = (iso: string) => `${WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const n = (v: number) => v.toLocaleString('pl-PL');

export function ForecastPanel({ forecast, request, isDemo }: { forecast: WaterForecast | undefined; request: AnalysisRequest; isDemo: boolean }) {
  const crop = cropLabel(request.cropId).toLowerCase();
  return (
    <section className="report-section forecast" aria-labelledby="sekcja-prognoza">
      <h2 id="sekcja-prognoza" tabIndex={-1}>
        Bilans wody na najbliższy tydzień i plan działań
      </h2>
      <p className="forecast__lead">
        Ile wody potrzebuje uprawa ({crop}), ile spadnie i ile zostanie w glebie – a z tego, co zrobić i kiedy.{' '}
        <CropBadge cropId={request.cropId} />
      </p>

      {!forecast || forecast.status !== 'ok' ? (
        <div className="status status--info">
          <p>
            {forecast?.message ??
              'Bilans na najbliższe dni liczymy dla działek analizowanych na dzisiejszą datę (przykłady demonstracyjne dotyczą minionych lat).'}
          </p>
          {!isDemo && (!forecast || forecast.status === 'not_applicable') && (
            <a className="btn btn--small btn--secondary no-print" href={reportHash({ ...request, analysisDate: todayInPoland() })}>
              <Icon name="calendar" size={16} /> Policz bilans na dziś
            </a>
          )}
        </div>
      ) : (
        <>
          {forecast.balance && <BalanceSheet balance={forecast.balance} plan={forecast.irrigationPlan} />}

          <h3>Co zrobić i kiedy</h3>
          <ol className="forecast-steps">
            {forecast.steps.map((step) => (
              <StepItem key={step.id} step={step} />
            ))}
          </ol>

          {forecast.irrigationPlan && forecast.irrigationPlan.events.length > 0 && <IrrigationTable plan={forecast.irrigationPlan} />}

          <p className="muted small">
            {forecast.message} Prognoza opadu i parowania: Open-Meteo, {forecast.issuedAt ? formatDateTimePl(forecast.issuedAt) : '–'}. Bilans
            liczony modelem FAO-56 od stanu gleby na dzień analizy. Prognoza opadów na dalsze dni jest niepewna (zwłaszcza burze) –
            plan zmienia się razem z nią, więc sprawdzaj go przed każdym zabiegiem.
          </p>
        </>
      )}
    </section>
  );
}

function BalanceSheet({ balance: b, plan }: { balance: ForecastBalance; plan: IrrigationPlan | null }) {
  const period = `${shortDate(b.from)} – ${shortDate(b.to)}`;
  return (
    <div className="balance">
      <p className="balance__title" id="rachunek-wody">
        Rachunek wody w strefie korzeni, {period} ({b.horizonDays} dni)
      </p>
      <table className="balance__table" aria-labelledby="rachunek-wody">
        <tbody>
          <tr>
            <th scope="row">Zapas wody w glebie teraz</th>
            <td className="balance__sign" />
            <td className="balance__value">{b.startReserveMm} mm</td>
            <td className="balance__note">
              {b.startReservePct}% pełnego zapasu ({b.fullReserveMm} mm)
            </td>
          </tr>
          <tr>
            <th scope="row">Prognozowany opad</th>
            <td className="balance__sign">+</td>
            <td className="balance__value">{b.rainUsedMm} mm</td>
            <td className="balance__note">
              z {b.rainMm} mm deszczu{b.rainLostMm > 0 ? ` – ${b.rainLostMm} mm gleba nie zmieści (przesiąknie głębiej lub spłynie)` : ' – całość zostanie w glebie'}
            </td>
          </tr>
          <tr>
            <th scope="row">Potrzeba wody uprawy</th>
            <td className="balance__sign">−</td>
            <td className="balance__value">{b.needMm} mm</td>
            <td className="balance__note">parowanie z gleby i roślin przy obecnej fazie uprawy</td>
          </tr>
          <tr className="balance__total">
            <th scope="row">Zapas za {b.horizonDays} dni (bez nawadniania)</th>
            <td className="balance__sign">=</td>
            <td className="balance__value">{b.endReserveMm} mm</td>
            <td className="balance__note">
              {b.endReservePct}% pełnego zapasu <RiskBadge level={b.endLevel} />
            </td>
          </tr>
        </tbody>
      </table>

      <dl className="balance__facts">
        <div>
          <dt>Próg stresu</dt>
          <dd>{b.stressThresholdPct}% zapasu</dd>
        </div>
        <div>
          <dt>Dni z niedoborem (bez nawadniania)</dt>
          <dd>
            {b.stressDays} z {b.horizonDays}
          </dd>
        </div>
        <div>
          <dt>Woda do dodania, żeby uniknąć stresu</dt>
          <dd>
            {plan && plan.totalMm > 0 ? (
              <>
                {plan.totalMm} mm · {n(plan.totalM3PerHa)} m³/ha
                {plan.totalM3Parcel !== null && <span className="muted small"> · {n(plan.totalM3Parcel)} m³ na działkę</span>}
              </>
            ) : (
              'nie trzeba'
            )}
          </dd>
        </div>
      </dl>
      <p className="muted small">
        Wynik nie zawsze jest prostą sumą – gdy w glebie brakuje wody, rośliny ograniczają parowanie, a nadmiar deszczu nie zostaje w strefie korzeni.
      </p>
    </div>
  );
}

function StepItem({ step }: { step: ForecastStep }) {
  const icon = step.tone === 'warning' ? 'alert' : step.tone === 'good' ? 'check' : 'info';
  return (
    <li className={`forecast-step forecast-step--${step.tone}`}>
      <span className="forecast-step__when">{step.when}</span>
      <div className="forecast-step__body">
        <p className="forecast-step__title">
          <Icon name={icon} size={18} /> {step.title}
        </p>
        <p>{step.text}</p>
      </div>
    </li>
  );
}

function IrrigationTable({ plan }: { plan: IrrigationPlan }) {
  return (
    <div className="table-wrap irrigation-plan">
      <table className="sources-table">
        <caption>{plan.typicallyIrrigated ? 'Plan nawadniania' : 'Plan nawadniania (jeśli masz deszczownię)'}</caption>
        <thead>
          <tr>
            <th scope="col">Dzień</th>
            <th scope="col">Dawka</th>
            <th scope="col">Woda na hektar</th>
            <th scope="col">Woda na działkę</th>
          </tr>
        </thead>
        <tbody>
          {plan.events.map((e) => (
            <tr key={e.date}>
              <td>{shortDate(e.date)}</td>
              <td>{e.doseMm} mm</td>
              <td>{n(e.m3PerHa)} m³</td>
              <td>{e.m3Parcel !== null ? `${n(e.m3Parcel)} m³` : '–'}</td>
            </tr>
          ))}
          <tr className="irrigation-plan__total">
            <th scope="row">Razem</th>
            <td>{plan.totalMm} mm</td>
            <td>{n(plan.totalM3PerHa)} m³</td>
            <td>{plan.totalM3Parcel !== null ? `${n(plan.totalM3Parcel)} m³` : '–'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
