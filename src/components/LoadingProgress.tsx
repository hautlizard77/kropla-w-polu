import { useEffect, useState } from 'react';

export interface ProgressStep {
  /** Od ilu procent pokazujemy ten etap. */
  from: number;
  label: string;
}

interface Props {
  /** Typowy czas operacji – w tym czasie pasek dochodzi do 90%. */
  expectedMs: number;
  steps: ProgressStep[];
  /** Opis dla czytników ekranu, np. „Analiza działki”. */
  label: string;
  compact?: boolean;
}

/**
 * Pasek postępu dla operacji, której serwer nie raportuje krok po kroku: postęp jest szacowany z czasu
 * (szybko na początku, potem coraz wolniej; 100% nie pokazuje się przed końcem).
 */
export function LoadingProgress({ expectedMs, steps, label, compact = false }: Props) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => setElapsed(performance.now() - started), 120);
    return () => window.clearInterval(timer);
  }, []);
  const percent = estimatePercent(elapsed, expectedMs);
  const step = [...steps].reverse().find((s) => percent >= s.from) ?? steps[0];
  return (
    <div className={`progress${compact ? ' progress--compact' : ''}`}>
      <div className="progress__head">
        <span className="progress__spinner" aria-hidden="true" />
        <span className="progress__step">{step?.label}</span>
        <span className="progress__value" aria-hidden="true">
          {percent}%
        </span>
      </div>
      <div className="progress__track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}% – ${step?.label ?? ''}`}>
        <div className="progress__bar" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Do 90% w typowym czasie (szybko na początku), potem powoli w stronę 99%, gdy usługa odpowiada wolniej. */
export function estimatePercent(elapsedMs: number, expectedMs: number): number {
  const t = Math.max(0, elapsedMs);
  const T = Math.max(1, expectedMs);
  const p = t <= T ? (90 * (1 - Math.exp((-2.4 * t) / T))) / (1 - Math.exp(-2.4)) : 90 + 9 * (1 - Math.exp(-(t - T) / 30000));
  return Math.max(1, Math.min(99, Math.floor(p)));
}

export const ANALYSIS_STEPS: ProgressStep[] = [
  { from: 0, label: 'Granica działki z ewidencji' },
  { from: 12, label: 'Pogoda z 10 lat' },
  { from: 32, label: 'Gleba i cieki w pobliżu' },
  { from: 50, label: 'Model terenu' },
  { from: 68, label: 'Zdjęcie satelitarne' },
  { from: 85, label: 'Bilans wody i zalecenia' },
];

export const TERRAIN_STEPS: ProgressStep[] = [
  { from: 0, label: 'Model terenu z GUGiK' },
  { from: 45, label: 'Spływ i zagłębienia' },
  { from: 80, label: 'Widok 3D' },
];
