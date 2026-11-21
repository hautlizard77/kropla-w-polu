import { useState } from 'react';
import { formatRelativeDateTimePl } from '../lib/dates';
import { HASH } from '../lib/route';
import type { AppNotification, NotificationKind } from '../types/account';
import { PageHeader } from './AppShell';
import { Icon, type IconName } from './Icon';

const KIND: Record<NotificationKind, { icon: IconName; label: string }> = {
  risk: { icon: 'alert', label: 'Ryzyko' },
  data: { icon: 'cloud', label: 'Dane' },
  report: { icon: 'file', label: 'Raport' },
  tip: { icon: 'leaf', label: 'Porada' },
  account: { icon: 'user', label: 'Konto' },
};

export function NotificationIcon({ kind }: { kind: NotificationKind }) {
  return (
    <span className={`kind-icon kind-icon--${kind}`} aria-hidden="true">
      <Icon name={KIND[kind].icon} size={18} />
    </span>
  );
}

interface Props {
  notifications: AppNotification[];
  readIds: string[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}

export function NotificationsScreen({ notifications, readIds, onMarkRead, onMarkAllRead }: Props) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const unreadCount = notifications.filter((item) => !readIds.includes(item.id)).length;
  const shown = filter === 'unread' ? notifications.filter((item) => !readIds.includes(item.id)) : notifications;

  return (
    <div className="notifications">
      <PageHeader
        title="Powiadomienia"
        description="Powstają z Twoich działek i ich ostatnich ocen: ryzyko niedoboru wody, pilne kroki, braki w danych i porada na ten miesiąc."
        actions={
          <>
            <a className="btn btn--secondary" href={HASH.account}>
              <Icon name="settings" size={18} /> Ustawienia
            </a>
            <button type="button" className="btn btn--primary" onClick={onMarkAllRead} disabled={unreadCount === 0}>
              <Icon name="check" size={18} /> Oznacz wszystkie jako przeczytane
            </button>
          </>
        }
      />

      <div className="segmented" role="group" aria-label="Filtr powiadomień">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          Wszystkie <span className="segmented__count">{notifications.length}</span>
        </button>
        <button type="button" aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>
          Nieprzeczytane <span className="segmented__count">{unreadCount}</span>
        </button>
      </div>

      <section className="panel panel--flush" aria-label="Lista powiadomień">
        {shown.length === 0 ? (
          <div className="empty-state">
            <Icon name="check" size={28} />
            <p>{filter === 'unread' ? 'Wszystkie powiadomienia są przeczytane.' : 'Nie masz powiadomień.'}</p>
          </div>
        ) : (
          <ul className="notification-list">
            {shown.map((item) => {
              const isUnread = !readIds.includes(item.id);
              return (
                <li key={item.id} className={`notification${isUnread ? ' is-unread' : ''}`}>
                  <NotificationIcon kind={item.kind} />
                  <div className="notification__body">
                    <p className="notification__meta">
                      <span className="notification__kind">{KIND[item.kind].label}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={item.createdAt}>{formatRelativeDateTimePl(item.createdAt)}</time>
                      {isUnread && <span className="unread-pill">Nowe</span>}
                    </p>
                    <h2 className="notification__title">{item.title}</h2>
                    <p className="notification__text">{item.body}</p>
                    <div className="notification__actions">
                      {item.link && (
                        <a className="btn btn--small btn--secondary" href={item.link.href} onClick={() => onMarkRead(item.id)}>
                          {item.link.label}
                        </a>
                      )}
                      {isUnread && (
                        <button type="button" className="btn btn--small btn--ghost" onClick={() => onMarkRead(item.id)}>
                          Oznacz jako przeczytane
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
