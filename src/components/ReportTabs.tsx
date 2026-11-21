import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { RiskLevel } from '../types/analysis';
import { Icon, type IconName } from './Icon';

export type TabId = 'podsumowanie' | 'uprawa' | 'sytuacja' | 'prognoza' | 'zalecenia' | 'teren' | 'zrodla';

export interface TabDef {
  id: TabId;
  label: string;
  icon: IconName;
  /** Poziom ryzyka – kolorowa kropka przy nazwie zakładki. */
  level?: RiskLevel;
}

const LEVEL_TEXT: Record<RiskLevel, string> = {
  low: 'niskie ryzyko',
  moderate: 'umiarkowane ryzyko',
  elevated: 'podwyższone ryzyko',
  insufficient_data: 'za mało danych',
};

/** Zakładki raportu (wzorzec ARIA „tabs”: strzałki zmieniają zakładkę, Home/End – pierwsza/ostatnia). */
export function ReportTabs({ tabs, active, onSelect }: { tabs: TabDef[]; active: TabId; onSelect: (id: TabId) => void }) {
  const refs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === active);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const id = tabs[next]!.id;
    onSelect(id);
    refs.current[id]?.focus();
  };

  return (
    <div className="report-tabs no-print" id="zakladki-raportu">
      <div className="report-tabs__list" role="tablist" aria-label="Informacje o działce" onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el;
            }}
            type="button"
            role="tab"
            id={`zakladka-${tab.id}`}
            aria-selected={tab.id === active}
            aria-controls={`panel-${tab.id}`}
            tabIndex={tab.id === active ? 0 : -1}
            className="report-tabs__tab"
            onClick={() => onSelect(tab.id)}
          >
            <Icon name={tab.icon} size={18} />
            <span>{tab.label}</span>
            {tab.level && (
              <span className={`report-tabs__dot report-tabs__dot--${tab.level}`} title={LEVEL_TEXT[tab.level]}>
                <span className="visually-hidden">({LEVEL_TEXT[tab.level]})</span>
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Panel zakładki. Ukryty panel zostaje w dokumencie, więc na wydruku widać wszystkie zakładki po kolei. */
export function TabPanel({ id, active, children }: { id: TabId; active: TabId; children: ReactNode }) {
  return (
    <div className="report-tabpanel" role="tabpanel" id={`panel-${id}`} aria-labelledby={`zakladka-${id}`} hidden={id !== active} tabIndex={-1}>
      {children}
    </div>
  );
}
