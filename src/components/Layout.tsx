import type { MouseEvent, ReactNode } from 'react';
import { ANALYSIS_HASH } from '../lib/route';

/** Okruszki nawigacyjne – jak w serwisach publicznych: pokazują, gdzie jest użytkownik. */
export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="breadcrumbs no-print" aria-label="Jesteś tutaj">
      <ol>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={item.label}>
              {item.href && !last ? (
                <a href={item.href}>{item.label}</a>
              ) : (
                <span aria-current={last ? 'page' : undefined}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const STEPS = ['Dane działki', 'Raport'] as const;

/** Wskaźnik kroków usługi: 1. Dane działki → 2. Raport. */
export function Steps({ current }: { current: 1 | 2 }) {
  return (
    <ol className="steps no-print" aria-label="Kroki">
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

/** Ramka „Ważne” – na komunikaty, których nie można przeoczyć (np. dane demonstracyjne). */
export function ImportantNotice({ title = 'Ważne', children }: { title?: string; children: ReactNode }) {
  return (
    <div className="notice" role="note">
      <p className="notice__title">{title}</p>
      <div className="notice__body">{children}</div>
    </div>
  );
}

/** Przewija do opisu w stopce bez zmiany adresu – adres (#/raport?...) wskazuje bieżący widok. */
function scrollToAbout(event: MouseEvent<HTMLAnchorElement>) {
  const target = document.getElementById('o-prototypie');
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
}

export function SiteHeader({ current }: { current: 'analysis' | 'report' }) {
  return (
    <header className="site-header no-print">
      <div className="service-bar">
        <div className="container service-bar__inner">
          <span className="service-bar__tag">Prototyp</span>
          <span>
            Projekt konkursowy HackNation 2026 (wyzwanie KOWR). To nie jest serwis administracji publicznej.
          </span>
        </div>
      </div>
      <div className="container site-header__inner">
        <a className="brand" href={ANALYSIS_HASH}>
          <svg className="brand__mark" viewBox="0 0 40 40" aria-hidden="true">
            <rect width="40" height="40" rx="4" fill="var(--navy-800)" />
            <path d="M20 7c5.4 7.1 9 11.8 9 16.6a9 9 0 0 1-18 0C11 18.8 14.6 14.1 20 7z" fill="#fff" />
            <path d="M9 33h22" stroke="var(--green-400)" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span className="brand__text">
            <span className="brand__name">Woda na polu</span>
            <span className="brand__tagline">Asystent gospodarowania wodą na działce rolnej</span>
          </span>
        </a>
        <nav aria-label="Główna nawigacja">
          <ul className="nav-list">
            <li>
              <a href={ANALYSIS_HASH} aria-current={current === 'analysis' ? 'page' : undefined}>
                Analiza działki
              </a>
            </li>
            <li>
              <a href="#o-prototypie" onClick={scrollToAbout}>
                O prototypie
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer no-print" id="o-prototypie" tabIndex={-1}>
      <div className="container">
        <div className="site-footer__grid">
          <section aria-labelledby="stopka-o">
            <h2 id="stopka-o">O prototypie</h2>
            <p>
              „Woda na polu” pomaga ocenić, czy na działce brakuje wody, i podpowiada, jak ją zatrzymać. Powstaje na
              HackNation 2026 w odpowiedzi na wyzwanie KOWR „Zatrzymaj wodę, chroń plony”.
            </p>
          </section>
          <section aria-labelledby="stopka-dane">
            <h2 id="stopka-dane">Dane (docelowo)</h2>
            <ul>
              <li>GUGiK – granice działek i ukształtowanie terenu</li>
              <li>IMGW-PIB lub Open-Meteo – pogoda</li>
              <li>Copernicus Sentinel-2 – obserwacje satelitarne</li>
              <li>IUNG-PIB lub SoilGrids – gleby</li>
              <li>Wody Polskie – hydrologia</li>
            </ul>
          </section>
          <section aria-labelledby="stopka-wersja">
            <h2 id="stopka-wersja">Ta wersja</h2>
            <p>
              Wersja demonstracyjna. Wyniki są dostępne tylko dla trzech oznaczonych przykładów, a ich dane są
              ilustracyjne. Aplikacja nie zbiera danych osobowych.
            </p>
          </section>
        </div>
        <p className="site-footer__bottom">
          <span className="site-footer__accent" aria-hidden="true" />
          HackNation 2026 · wyzwanie Krajowego Ośrodka Wsparcia Rolnictwa
        </p>
      </div>
    </footer>
  );
}
