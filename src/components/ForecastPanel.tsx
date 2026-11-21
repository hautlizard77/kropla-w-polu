import { cropLabel } from '../data/crops';
import { formatDateTimePl, todayInPoland } from '../lib/dates';
import { reportHash } from '../lib/route';
import type { AnalysisRequest, ForecastAdvice, ForecastDay, WaterForecast } from '../types/analysis';
import { CropBadge } from './CropPanel';
import { Icon } from './Icon';

const WEEKDAYS = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
const LEVEL_TEXT = { low: 'zapas dobry', moderate: 'umiarkowany niedobór', elevated: 'duży niedobór', insufficient_data: 'brak danych' } as const;

function dayLabel(iso: string): { weekday: string; date: string } {
  const d = new Date(`${iso}T12:00:00Z`);
  return { weekday: WEEKDAYS[d.getUTCDay()] ?? '', date: `${iso.slice(8, 10)}.${iso.slice(5, 7)}` };
}

const nf = (v: number | null, digits = 0) => (v === null ? '–' : v.toLocaleString('pl-PL', { maximumFractionDigits: digits }));

export function ForecastPanel({ forecast, request, isDemo }: { forecast: WaterForecast | undefined; request: AnalysisRequest; isDemo: boolean }) {
  const crop = cropLabel(request.cropId).toLowerCase();
  return (
    <section className="report-section forecast" aria-labelledby="sekcja-prognoza">
      <h2 id="sekcja-prognoza" tabIndex={-1}>
        Prognoza i co robić w najbliższych dniach <CropBadge cropId={request.cropId} />
      </h2>

      {!forecast || forecast.status !== 'ok' ? (
        <div className="status status--info">
          <p>
            {forecast?.message ??
              'Prognoza jest dostępna dla działek analizowanych na dzisiejszą datę (przykłady demonstracyjne dotyczą minionych lat).'}
          </p>
          {!isDemo && (!forecast || forecast.status === 'not_applicable') && (
            <a className="btn btn--small btn--secondary no-print" href={reportHash({ ...request, analysisDate: todayInPoland() })}>
              <Icon name="cloud" size={16} /> Pokaż prognozę na dziś
            </a>
          )}
        </div>
      ) : (
        <>
          <p className="muted">{forecast.message}</p>
          {forecast.totals && (
            <dl className="forecast-totals">
              <div>
                <dt>Opad – 3 dni</dt>
                <dd>{forecast.totals.rain3} mm</dd>
              </div>
              <div>
                <dt>Opad – 7 dni</dt>
                <dd>{forecast.totals.rain7} mm</dd>
              </div>
              <div>
                <dt>Opad – 10 dni</dt>
                <dd>{forecast.totals.rain10} mm</dd>
              </div>
              <div>
                <dt>Zużycie wody przez uprawę – 7 dni</dt>
                <dd>{forecast.days.some((d) => d.etcMm !== null) ? `${forecast.totals.etc7} mm` : '–'}</dd>
              </div>
            </dl>
          )}

          <h3>Co robić ({crop})</h3>
          <ul className="forecast-advice">
            {forecast.advice.map((a) => (
              <AdviceItem key={a.id} advice={a} />
            ))}
          </ul>

          <h3>Dzień po dniu</h3>
          <DayStrip days={forecast.days} threshold={forecast.stressThresholdPct} />
          <p className="muted small">
            Słupki niebieskie – prognozowany opad (mm) i jego prawdopodobieństwo. Pasek na dole – przewidywany zapas wody w strefie
            korzeni dla tej uprawy{forecast.stressThresholdPct !== null && <>; kreska – próg stresu ({forecast.stressThresholdPct}% zapasu)</>}.
            Prognoza z {forecast.issuedAt ? formatDateTimePl(forecast.issuedAt) : '–'} (Open-Meteo). Dalsze dni są mniej pewne,
            szczególnie przy burzach – sprawdzaj prognozę codziennie.
          </p>
        </>
      )}
    </section>
  );
}

function AdviceItem({ advice }: { advice: ForecastAdvice }) {
  const icon = advice.tone === 'warning' ? 'alert' : advice.tone === 'good' ? 'check' : 'info';
  return (
    <li className={`forecast-advice__item forecast-advice__item--${advice.tone}`}>
      <Icon name={icon} size={20} />
      <div>
        <p className="forecast-advice__title">{advice.title}</p>
        <p>{advice.text}</p>
      </div>
    </li>
  );
}

function DayStrip({ days, threshold }: { days: ForecastDay[]; threshold: number | null }) {
  const maxRain = Math.max(15, ...days.map((d) => d.precipitationMm ?? 0));
  return (
    <div className="forecast-strip" role="table" aria-label="Prognoza dzień po dniu">
      <div role="rowgroup" className="forecast-strip__days">
        {days.map((d) => {
          const label = dayLabel(d.date);
          const rain = d.precipitationMm ?? 0;
          return (
            <div key={d.date} role="row" className={`forecast-day${d.past ? ' forecast-day--past' : ''}`}>
              <div role="cell" className="forecast-day__date">
                <strong>{label.weekday}</strong>
                <span>{label.date}</span>
                {d.past && <span className="forecast-day__tag">minął</span>}
              </div>
              <div role="cell" className="forecast-day__rain" aria-label={`Opad ${nf(d.precipitationMm, 1)} mm`}>
                <span className="forecast-day__bar" style={{ height: `${Math.max(rain > 0 ? 4 : 0, (rain / maxRain) * 100)}%` }} />
              </div>
              <div role="cell" className="forecast-day__mm">
                {nf(d.precipitationMm, 1)} mm
                {d.probabilityPct !== null && <span className="muted"> · {d.probabilityPct}%</span>}
              </div>
              <div role="cell" className="forecast-day__temp">
                {nf(d.tMax)}° / {nf(d.tMin)}°
              </div>
              <div role="cell" className="forecast-day__reserve" aria-label={d.reservePct === null ? 'Zapas wody: brak danych' : `Zapas wody ${d.reservePct}% – ${LEVEL_TEXT[d.level]}`}>
                {d.reservePct !== null ? (
                  <>
                    <span className="forecast-day__meter">
                      <span className={`forecast-day__fill forecast-day__fill--${d.level}`} style={{ width: `${d.reservePct}%` }} />
                      {threshold !== null && <span className="forecast-day__threshold" style={{ left: `${threshold}%` }} />}
                    </span>
                    <span className="forecast-day__pct">{d.reservePct}%</span>
                  </>
                ) : (
                  <span className="muted">–</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
