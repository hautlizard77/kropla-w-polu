const STEPS = ['Dane działki', 'Raport'] as const;

/** Wskaźnik kroków analizy: 1. Dane działki → 2. Raport. */
export function Steps({ current }: { current: 1 | 2 }) {
  return (
    <ol className="steps no-print" aria-label="Kroki analizy">
      {STEPS.map((label, index) => {
        const number = index + 1;
        const state = number < current ? 'done' : number === current ? 'current' : 'todo';
        return (
          <li key={label} className={`steps__item steps__item--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="steps__number" aria-hidden="true">
              {state === 'done' ? '✓' : number}
            </span>
            <span>
              <span className="visually-hidden">Krok {number} z {STEPS.length}: </span>
              {label}
              {state === 'done' && <span className="visually-hidden"> (ukończony)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
