import type { ReactNode, Ref } from 'react';
import { HASH, type RouteName } from '../lib/route';
import type { UserAccount } from '../types/account';
import { Icon, type IconName } from './Icon';

interface NavItem {
  id: RouteName;
  label: string;
  shortLabel: string;
  href: string;
  icon: IconName;
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Panel główny', shortLabel: 'Panel', href: HASH.dashboard, icon: 'home' },
  { id: 'parcels', label: 'Moje działki', shortLabel: 'Działki', href: HASH.parcels, icon: 'parcels' },
  { id: 'analysis', label: 'Nowa analiza', shortLabel: 'Analiza', href: HASH.analysis, icon: 'analysis' },
  { id: 'notifications', label: 'Powiadomienia', shortLabel: 'Powiadom.', href: HASH.notifications, icon: 'bell' },
  { id: 'account', label: 'Konto', shortLabel: 'Konto', href: HASH.account, icon: 'user' },
];

/** Raport należy do ścieżki analizy – w menu podświetlamy „Nowa analiza”. */
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
  const current = NAV.find((item) => item.id === active);

  return (
    <div className="shell">
      <a className="skip-link" href="#tresc">
        Przejdź do treści
      </a>

      <aside className="sidebar no-print" aria-label="Menu aplikacji">
        <a className="sidebar__brand" href={HASH.dashboard}>
          <BrandMark />
          <span>
            <span className="sidebar__name">Woda na polu</span>
            <span className="sidebar__tagline">Gospodarowanie wodą na działce</span>
          </span>
        </a>
        <nav aria-label="Główna nawigacja">
          <ul className="sidebar__nav">
            {NAV.map((item) => (
              <li key={item.id}>
                <a href={item.href} aria-current={item.id === active ? 'page' : undefined}>
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {item.id === 'notifications' && unreadCount > 0 && (
                    <span className="count-badge" aria-label={`${unreadCount} nieprzeczytane`}>
                      {unreadCount}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <a className="sidebar__user" href={HASH.account}>
          <span className="avatar" aria-hidden="true">
            {initials(user)}
          </span>
          <span>
            <span className="sidebar__user-name">
              {user.firstName} {user.lastName}
            </span>
            <span className="sidebar__user-farm">{user.farm.name}</span>
          </span>
        </a>
      </aside>

      <div className="shell__main">
        <header className="topbar no-print">
          <a className="topbar__brand" href={HASH.dashboard} aria-label="Woda na polu – panel główny">
            <BrandMark />
          </a>
          <p className="topbar__section">
            {current && <Icon name={current.icon} size={18} />}
            <span>{current?.label ?? 'Woda na polu'}</span>
          </p>
          <div className="topbar__actions">
            <a
              className="icon-button"
              href={HASH.notifications}
              aria-label={unreadCount > 0 ? `Powiadomienia, ${unreadCount} nieprzeczytane` : 'Powiadomienia'}
            >
              <Icon name="bell" />
              {unreadCount > 0 && (
                <span className="icon-button__dot" aria-hidden="true">
                  {unreadCount}
                </span>
              )}
            </a>
            <a className="topbar__user" href={HASH.account} aria-label={`Konto: ${user.firstName} ${user.lastName}`}>
              <span className="avatar avatar--small" aria-hidden="true">
                {initials(user)}
              </span>
              <span className="topbar__user-name">{user.firstName}</span>
            </a>
          </div>
        </header>

        <main id="tresc" className="content" tabIndex={-1}>
          {children}
        </main>

        <footer className="app-footer no-print">
          <span>Woda na polu</span>
          <span aria-hidden="true">·</span>
          <span>Źródła i daty danych są podane w każdym raporcie</span>
        </footer>
      </div>

      <nav className="tabbar no-print" aria-label="Nawigacja dolna">
        <ul>
          {NAV.map((item) => (
            <li key={item.id}>
              <a href={item.href} aria-current={item.id === active ? 'page' : undefined}>
                <span className="tabbar__icon">
                  <Icon name={item.icon} size={22} />
                  {item.id === 'notifications' && unreadCount > 0 && <span className="tabbar__dot" aria-hidden="true" />}
                </span>
                <span>{item.shortLabel}</span>
                {item.id === 'notifications' && unreadCount > 0 && (
                  <span className="visually-hidden">, {unreadCount} nieprzeczytane</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="8" fill="var(--navy-800)" />
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
