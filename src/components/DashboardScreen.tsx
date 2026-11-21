import { cropLabel } from '../data/crops';
import { formatDatePl, formatLongDatePl, formatRelativeDateTimePl, todayInPoland } from '../lib/dates';
import { HASH, reportHash } from '../lib/route';
import type { AppNotification, ParcelSummary, UserAccount } from '../types/account';
import type { RiskLevel } from '../types/analysis';
import { PageHeader } from './AppShell';
import { Icon, type IconName } from './Icon';
import { NotificationIcon } from './NotificationsScreen';
import { RiskBadge } from './RiskBadge';

interface Props {
  user: UserAccount;
  parcels: ParcelSummary[];
  notifications: AppNotification[];
  readIds: string[];
  onMarkRead: (id: string) => void;
}

/** Jedno zdanie prostym językiem do listy działek. */
const PLAIN: Record<RiskLevel, string> = {
  elevated: 'Na polu brakuje wody – sprawdź, co możesz zrobić.',
  moderate: 'Wody może zabraknąć – warto obserwować uprawę.',
  low: 'Wody nie brakuje.',
  insufficient_data: 'Za mało danych, żeby ocenić stan na ten dzień.',
};

export function DashboardScreen({ user, parcels, notifications, readIds, onMarkRead }: Props) {
  const today = todayInPoland();
  const unread = notifications.filter((item) => !readIds.includes(item.id));
  const urgent = parcels.filter((item) => item.lastAnalysis?.level === 'elevated');

  const tasks: { href: string; icon: IconName; title: string; text: string; primary?: boolean }[] = [
    {
      href: HASH.analysis,
      icon: 'analysis',
      title: 'Sprawdź sytuację wodną działki',
      text: 'Wpisz numer działki albo wskaż ją na mapie. Dostaniesz raport z oceną i poradami.',
      primary: true,
    },
    {
      href: HASH.parcels,
      icon: 'parcels',
      title: 'Moje działki',
      text: `${parcels.length} ${parcels.length === 1 ? 'działka' : parcels.length < 5 ? 'działki' : 'działek'} – oceny, raporty, dodawanie nowych.`,
    },
    {
      href: HASH.notifications,
      icon: 'bell',
      title: 'Powiadomienia',
      text: unread.length > 0 ? `Masz ${unread.length} ${unread.length === 1 ? 'nowe powiadomienie' : 'nowe powiadomienia'}.` : 'Nie masz nowych powiadomień.',
    },
    {
      href: HASH.help,
      icon: 'help',
      title: 'Pomoc',
      text: 'Gdzie znaleźć numer działki, co oznaczają oceny i kolory, skąd są dane.',
    },
  ];

  return (
    <div className="start">
      <PageHeader eyebrow={formatLongDatePl(today)} title={`Dzień dobry, ${user.firstName}`} description="Co chcesz dziś zrobić?" />

      {urgent.length > 0 && (
        <div className="notice notice--warning" role="note">
          <p className="notice__title">
            <Icon name="alert" size={18} /> Wymaga uwagi
          </p>
          <div className="notice__body">
            {urgent.map((item) => (
              <p key={item.saved.parcelId}>
                <strong>{item.saved.name}</strong> – podwyższone ryzyko niedoboru wody.{' '}
                {item.lastAnalysis && <a href={reportHash(item.lastAnalysis.request)}>Zobacz raport i porady</a>}
              </p>
            ))}
          </div>
        </div>
      )}

      <ul className="task-tiles">
        {tasks.map((task) => (
          <li key={task.href}>
            <a className={`task-tile${task.primary ? ' task-tile--primary' : ''}`} href={task.href}>
              <span className="task-tile__icon" aria-hidden="true">
                <Icon name={task.icon} size={26} />
              </span>
              <span className="task-tile__text">
                <span className="task-tile__title">{task.title}</span>
                <span className="task-tile__desc">{task.text}</span>
              </span>
              <Icon name="chevron-right" className="task-tile__arrow" />
            </a>
          </li>
        ))}
      </ul>

      <section className="start-section" aria-labelledby="tytul-dzialki">
        <div className="section-head">
          <h2 id="tytul-dzialki">Twoje działki</h2>
          <a href={HASH.parcels}>Wszystkie działki</a>
        </div>
        <ul className="parcel-list">
          {parcels.map((item) => (
            <li key={item.saved.parcelId} className="parcel-list__item">
              <div className="parcel-list__main">
                <h3>{item.saved.name}</h3>
                <p className="parcel-list__meta">
                  {cropLabel(item.saved.cropId)} · działka <span className="mono">{item.saved.parcelId}</span>
                </p>
              </div>
              <div className="parcel-list__status">
                {item.lastAnalysis ? (
                  <>
                    <RiskBadge level={item.lastAnalysis.level} />
                    <p>
                      {PLAIN[item.lastAnalysis.level]}{' '}
                      <span className="muted">(ocena na {formatDatePl(item.lastAnalysis.request.analysisDate)})</span>
                    </p>
                  </>
                ) : (
                  <p className="muted">Nie sprawdzono jeszcze tej działki.</p>
                )}
              </div>
              <div className="parcel-list__action">
                {item.lastAnalysis ? (
                  <a className="btn btn--secondary" href={reportHash(item.lastAnalysis.request)}>
                    Zobacz raport
                  </a>
                ) : (
                  <a className="btn btn--secondary" href={HASH.analysis}>
                    Sprawdź działkę
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="start-section" aria-labelledby="tytul-powiadomienia">
        <div className="section-head">
          <h2 id="tytul-powiadomienia">Najnowsze powiadomienia</h2>
          <a href={HASH.notifications}>Wszystkie powiadomienia</a>
        </div>
        {notifications.length === 0 ? (
          <p className="muted">Nie masz powiadomień.</p>
        ) : (
          <ul className="feed">
            {notifications.slice(0, 3).map((item) => {
              const isUnread = !readIds.includes(item.id);
              return (
                <li key={item.id} className={`feed__item${isUnread ? ' is-unread' : ''}`}>
                  <NotificationIcon kind={item.kind} />
                  <div className="feed__body">
                    <p className="feed__title">
                      {isUnread && <span className="unread-pill">Nowe</span>} {item.title}
                    </p>
                    <p className="feed__time">{formatRelativeDateTimePl(item.createdAt)}</p>
                  </div>
                  {item.link && (
                    <a className="btn btn--small btn--ghost" href={item.link.href} onClick={() => onMarkRead(item.id)}>
                      {item.link.label}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
