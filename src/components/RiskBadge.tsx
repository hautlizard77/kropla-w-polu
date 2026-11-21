import { RISK_LABELS, RISK_SYMBOLS } from '../lib/labels';
import type { RiskLevel } from '../types/analysis';

/** Stan ryzyka: tekst + symbol + kolor. Kolor nigdy nie jest jedynym nośnikiem informacji. */
export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <p className={`risk-badge risk-badge--${level}`}>
      <span className="risk-badge__symbol" aria-hidden="true">
        {RISK_SYMBOLS[level]}
      </span>
      <span>{RISK_LABELS[level]}</span>
    </p>
  );
}
