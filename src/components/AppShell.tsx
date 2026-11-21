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

const TITLES: Record<RouteName, string> = {
  analysis: 'Sprawdź działkę',
  report: 'Raport',
  parcels: 'Moje działki',
  notifications: 'Powiadomienia',
  account: 'Moje konto',
  help: 'Pomoc',
};

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

  const crumbs: { label: string; href?: string }[] =
    route === 'analysis'
      ? []
      : route === 'report'
        ? [{ label: 'Sprawdź działkę', href: HASH.analysis }, { label: 'Raport' }]
        : [{ label: 'Sprawdź działkę', href: HASH.analysis }, { label: TITLES[route] }];

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
                <span className="brand__name">Kropla w Polu</span>
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
          {crumbs.length > 0 && (
            <nav className="breadcrumbs no-print" aria-label="Jesteś tutaj">
              <ol>
                {crumbs.map((crumb, index) => (
                  <li key={crumb.label}>
                    {crumb.href ? (
                      <a href={crumb.href}>{crumb.label}</a>
                    ) : (
                      <span aria-current={index === crumbs.length - 1 ? 'page' : undefined}>{crumb.label}</span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          )}
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

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="6" fill="var(--blue-700)" />
      <path d="M20 7c5.4 7.1 9 11.8 9 16.6a9 9 0 0 1-18 0C11 18.8 14.6 14.1 20 7z" fill="#fff" />
      <path d="M9 33h22" stroke="var(--green-400)" strokeWidth="3" strokeLinecap="round" />
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
