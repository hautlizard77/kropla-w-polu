import { useMemo, useState } from 'react';
import { cropLabel } from '../data/crops';
import { formatDatePl, formatLongDatePl, formatRelativeDateTimePl, todayInPoland } from '../lib/dates';
import { HASH, reportHash } from '../lib/route';
import type { AppNotification, ParcelSummary, UserAccount } from '../types/account';
import { PageHeader } from './AppShell';
import { Icon } from './Icon';
import { NotificationIcon } from './NotificationsScreen';
import { ParcelMap, type MapParcel } from './ParcelMap';
import { RiskBadge } from './RiskBadge';

interface Props {
  user: UserAccount;
  parcels: ParcelSummary[];
  notifications: AppNotification[];
  readIds: string[];
  onMarkRead: (id: string) => void;
}

export function DashboardScreen({ user, parcels, notifications, readIds, onMarkRead }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const today = todayInPoland();

  const mapParcels = useMemo<MapParcel[]>(
    () =>
      parcels.flatMap((item) =>
        item.parcel ? [{ id: item.saved.parcelId, label: `${item.saved.name} (${item.saved.parcelId})`, chipLabel: item.saved.name, geometry: item.parcel.geometry }] : [],
      ),
    [parcels],
  );

  const totalArea = parcels.reduce((sum, item) => sum + (item.parcel?.areaHa ?? 0), 0);
  const areaKnown = parcels.some((item) => item.parcel?.areaHa != null);
  const needAttention = parcels.filter(
    (item) => item.lastAnalysis && (item.lastAnalysis.level === 'elevated' || item.lastAnalysis.level === 'insufficient_data'),
  );
  const unread = notifications.filter((item) => !readIds.includes(item.id));
  const latest = parcels
    .flatMap((item) => (item.lastAnalysis ? [item] : []))
    .sort((a, b) => ((a.lastAnalysis?.request.analysisDate ?? '') < (b.lastAnalysis?.request.analysisDate ?? '') ? 1 : -1))[0];
  const selected = parcels.find((item) => item.saved.parcelId === selectedId) ?? null;

  return (
    <div className="dashboard">
      <PageHeader
        eyebrow={formatLongDatePl(today)}
        title={`Dzień dobry, ${user.firstName}`}
        description={`${user.farm.name} · ${user.farm.seat}`}
        actions={
          <>
            <a className="btn btn--secondary" href={HASH.parcels}>
              <Icon name="parcels" size={18} /> Moje działki
            </a>
            <a className="btn btn--primary" href={HASH.analysis}>
              <Icon name="plus" size={18} /> Nowa analiza
            </a>
          </>
        }
      />

      <ul className="stats" aria-label="Podsumowanie">
        <li className="stat">
          <span className="stat__icon">
            <Icon name="parcels" />
          </span>
          <span className="stat__label">Działki</span>
          <span className="stat__value">{parcels.length}</span>
          <span className="stat__note">
            {areaKnown ? `łącznie ${totalArea.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} ha` : 'powierzchnia nieznana'}
          </span>
        </li>
        <li className={`stat${needAttention.length > 0 ? ' stat--alert' : ''}`}>
          <span className="stat__icon">
            <Icon name="alert" />
          </span>
          <span className="stat__label">Wymagają uwagi</span>
          <span className="stat__value">{needAttention.length}</span>
          <span className="stat__note">podwyższone ryzyko lub niepełne dane</span>
        </li>
        <li className="stat">
          <span className="stat__icon">
            <Icon name="bell" />
          </span>
          <span className="stat__label">Nowe powiadomienia</span>
          <span className="stat__value">{unread.length}</span>
          <span className="stat__note">
            <a href={HASH.notifications}>Zobacz wszystkie</a>
          </span>
        </li>
        <li className="stat">
          <span className="stat__icon">
            <Icon name="calendar" />
          </span>
          <span className="stat__label">Ostatnia analiza</span>
          <span className="stat__value stat__value--text">
            {latest?.lastAnalysis ? formatDatePl(latest.lastAnalysis.request.analysisDate) : 'brak'}
          </span>
          <span className="stat__note">{latest ? latest.saved.name : 'Wykonaj pierwszą analizę'}</span>
        </li>
      </ul>

      <div className="dashboard__grid">
        <section className="panel" aria-labelledby="tytul-stan">
          <div className="panel__header">
            <h2 id="tytul-stan">Stan działek</h2>
            <a className="link-arrow" href={HASH.parcels}>
              Wszystkie działki <Icon name="arrow-right" size={16} />
            </a>
          </div>
          <ul className="parcel-rows">
            {parcels.map((item) => (
              <li key={item.saved.parcelId} className={item.saved.parcelId === selectedId ? 'is-selected' : undefined}>
                <div className="parcel-rows__main">
                  <p className="parcel-rows__name">{item.saved.name}</p>
                  <p className="parcel-rows__meta">
                    <span className="mono">{item.saved.parcelId}</span> · {cropLabel(item.saved.cropId)}
                  </p>
                </div>
                <div className="parcel-rows__status">
                  {item.lastAnalysis ? (
                    <>
                      <RiskBadge level={item.lastAnalysis.level} />
                      <span className="parcel-rows__date">na {formatDatePl(item.lastAnalysis.request.analysisDate)}</span>
                    </>
                  ) : (
                    <span className="muted small">Brak analizy</span>
                  )}
                </div>
                {item.lastAnalysis ? (
                  <a
                    className="icon-link"
                    href={reportHash(item.lastAnalysis.request)}
                    aria-label={`Raport: ${item.saved.name}`}
                  >
                    <Icon name="chevron-right" />
                  </a>
                ) : (
                  <span className="icon-link icon-link--placeholder" aria-hidden="true" />
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel" aria-labelledby="tytul-mapa">
          <div className="panel__header">
            <h2 id="tytul-mapa">Działki na mapie</h2>
          </div>
          <ParcelMap
            parcels={mapParcels}
            selectedId={selectedId}
            onSelect={setSelectedId}
            ariaLabel="Mapa działek gospodarstwa"
            pickerLabel="Wybierz działkę:"
          />
          {selected && (
            <div className="map-selection" role="status">
              <div>
                <p className="map-selection__name">{selected.saved.name}</p>
                <p className="muted small">
                  {selected.parcel?.locationLabel ?? 'Położenie nieznane'}
                  {selected.parcel?.areaHa != null && ` · ${selected.parcel.areaHa.toLocaleString('pl-PL')} ha`}
                </p>
              </div>
              {selected.lastAnalysis && (
                <a className="btn btn--small btn--secondary" href={reportHash(selected.lastAnalysis.request)}>
                  Otwórz raport
                </a>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="panel" aria-labelledby="tytul-powiadomienia">
        <div className="panel__header">
          <h2 id="tytul-powiadomienia">Ostatnie powiadomienia</h2>
          <a className="link-arrow" href={HASH.notifications}>
            Wszystkie powiadomienia <Icon name="arrow-right" size={16} />
          </a>
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
                      {isUnread && <span className="visually-hidden">Nowe: </span>}
                      {item.title}
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
