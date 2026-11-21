import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { HASH, type RouteName } from '../lib/route';
import type { UserAccount } from '../types/account';
import { Icon, type IconName } from './Icon';

interface NavItem {
  id: RouteName;
  label: string;
  href: string;
  icon: IconName;
}

/** Główne menu – krótkie, zrozumiałe nazwy czynności. */
const NAV: NavItem[] = [
  { id: 'analysis', label: 'Sprawdź działkę', href: HASH.analysis, icon: 'analysis' },
  { id: 'parcels', label: 'Moje działki', href: HASH.parcels, icon: 'parcels' },
  { id: 'notifications', label: 'Powiadomienia', href: HASH.notifications, icon: 'bell' },
  { id: 'help', label: 'Pomoc', href: HASH.help, icon: 'help' },
];

/** Raport należy do ścieżki „Sprawdź działkę”. */
function activeSection(route: RouteName): RouteName {
  return route === 'report' ? 'analysis' : route;
}

export function initials(user: UserAccount): string {
  return `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
}

export function AppShell({
  route,
  user,
  unreadCount,
  children,
}: {
  route: RouteName;
  user: UserAccount;
  unreadCount: number;
  children: ReactNode;
}) {
  const active = activeSection(route);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  // Po przejściu do innego widoku zamykamy menu na telefonie.
  useEffect(() => setMenuOpen(false), [route]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);


  return (
    <div className="shell">
      <a
        className="skip-link"
        href="#tresc"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('tresc')?.focus();
        }}
      >
        Przejdź do treści
      </a>

      <header className="masthead no-print">
        <div className="masthead__top">
          <div className="container masthead__inner">
            <a className="brand" href={HASH.analysis}>
              <BrandMark />
              <span className="brand__text">
                <span className="brand__name">
                  Kropla <span className="brand__accent">w Polu</span>
                </span>
                <span className="brand__tagline">Woda na Twojej działce – ocena i porady</span>
              </span>
            </a>

            <div className="masthead__tools">
              <a
                className={`tool-link${route === 'notifications' ? ' is-active' : ''}`}
                href={HASH.notifications}
                aria-label={unreadCount > 0 ? `Powiadomienia, ${unreadCount} nowe` : 'Powiadomienia'}
              >
                <span className="tool-link__icon">
                  <Icon name="bell" />
                  {unreadCount > 0 && (
                    <span className="badge" aria-hidden="true">
                      {unreadCount}
                    </span>
                  )}
                </span>
              </a>
              <a className={`tool-link tool-link--account${route === 'account' ? ' is-active' : ''}`} href={HASH.account}>
                <span className="avatar avatar--small" aria-hidden="true">
                  {initials(user)}
                </span>
                <span className="tool-link__label">
                  <span className="visually-hidden">Moje konto: </span>
                  {user.firstName} {user.lastName}
                </span>
              </a>
              <button
                ref={menuButton}
                type="button"
                className="menu-button"
                aria-expanded={menuOpen}
                aria-controls="menu-glowne"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <Icon name={menuOpen ? 'x' : 'menu'} />
                <span>Menu</span>
              </button>
            </div>
          </div>
        </div>

        <nav className={`mainnav${menuOpen ? ' is-open' : ''}`} id="menu-glowne" aria-label="Menu główne">
          <div className="container">
            <ul>
              {NAV.map((item) => (
                <li key={item.id}>
                  <a href={item.href} aria-current={item.id === active ? 'page' : undefined}>
                    <Icon name={item.icon} size={20} />
                    <span>{item.label}</span>
                    {item.id === 'notifications' && unreadCount > 0 && (
                      <span className="badge badge--inline" aria-hidden="true">
                        {unreadCount}
                      </span>
                    )}
                  </a>
                </li>
              ))}
              <li className="mainnav__account">
                <a href={HASH.account} aria-current={route === 'account' ? 'page' : undefined}>
                  <Icon name="user" size={20} />
                  <span>Moje konto</span>
                </a>
              </li>
            </ul>
          </div>
        </nav>
      </header>

      <main id="tresc" className="content" tabIndex={-1}>
        <div className="container">
          {children}
        </div>
      </main>

      <footer className="site-footer no-print">
        <div className="container">
          <div className="site-footer__grid">
            <div>
              <p className="site-footer__title">Kropla w Polu</p>
              <p>Ocena sytuacji wodnej działki rolnej i porady, jak zatrzymać wodę na polu.</p>
            </div>
            <div>
              <p className="site-footer__title">Na skróty</p>
              <ul>
                <li>
                  <a href={HASH.analysis}>Sprawdź działkę</a>
                </li>
                <li>
                  <a href={HASH.parcels}>Moje działki</a>
                </li>
                <li>
                  <a href={HASH.help}>Pomoc i najczęstsze pytania</a>
                </li>
              </ul>
            </div>
            <div>
              <p className="site-footer__title">Dane</p>
              <p>Źródło i data każdej informacji są podane w raporcie, w części „Na czym opiera się wynik”.</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Znak: kropla, w której dolnej części leży zaorane pole – woda zatrzymana na działce. */
export function BrandMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id="kropla-woda" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3d8fdc" />
          <stop offset="1" stopColor="#0a4f91" />
        </linearGradient>
        <clipPath id="kropla-ksztalt">
          <path d="M20 1C28.6 10.6 35 17.6 35 24.2a15 15 0 0 1-30 0C5 17.6 11.4 10.6 20 1z" />
        </clipPath>
      </defs>
      <g clipPath="url(#kropla-ksztalt)">
        <rect width="40" height="40" fill="url(#kropla-woda)" />
        <path d="M4 27.5Q20 22 36 27.5V40H4z" fill="#1f7a45" />
        <path d="M4 32Q20 27 36 32V40H4z" fill="#2b9356" />
        <g fill="none" stroke="#bfe6cd" strokeWidth="1.6" strokeLinecap="round">
          <path d="M20 25.6 7 40" />
          <path d="M20 25.6 15 40" />
          <path d="M20 25.6 25 40" />
          <path d="M20 25.6 33 40" />
        </g>
      </g>
      <path d="M11.5 19.5c.7-3.6 2.9-7.2 6-11" fill="none" stroke="#fff" strokeOpacity="0.75" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Nagłówek strony w obrębie aplikacji. */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  headingRef,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="page-header">
      <div className="page-header__text">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        {description && <p className="page-header__description">{description}</p>}
      </div>
      {actions && <div className="page-header__actions no-print">{actions}</div>}
    </div>
  );
}
