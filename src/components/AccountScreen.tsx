import { useEffect, useState, type FormEvent } from 'react';
import { formatDatePl } from '../lib/dates';
import type { NotificationPreferences, UserAccount } from '../types/account';
import { PageHeader, initials } from './AppShell';
import { Icon } from './Icon';

interface Props {
  user: UserAccount;
  parcelCount: number;
  preferences: NotificationPreferences;
  onSavePreferences: (preferences: NotificationPreferences) => void;
}

const CHANNELS: { key: keyof NotificationPreferences; label: string; hint: string }[] = [
  { key: 'inApp', label: 'W aplikacji', hint: 'Lista powiadomień i licznik przy dzwonku. E-mail i SMS będą dostępne po podłączeniu konta do serwera.' },
];

const TOPICS: { key: keyof NotificationPreferences; label: string; hint: string }[] = [
  { key: 'riskAlerts', label: 'Ryzyko i pilne kroki', hint: 'Podwyższone lub umiarkowane ryzyko w ocenie działki oraz pilne kroki z zakładki „Nawadnianie”.' },
  { key: 'dataGaps', label: 'Braki w danych', hint: 'Ocena bez części danych (np. gleby) albo działka nieznaleziona w ewidencji.' },
  { key: 'seasonalTips', label: 'Porada na ten miesiąc', hint: 'Co w danym okresie zrobić, żeby zatrzymać wodę na polu.' },
];

export function AccountScreen({ user, parcelCount, preferences, onSavePreferences }: Props) {
  const [draft, setDraft] = useState<NotificationPreferences>(preferences);
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraft(preferences), [preferences]);

  const changed = (Object.keys(draft) as (keyof NotificationPreferences)[]).some((key) => draft[key] !== preferences[key]);

  function toggle(key: keyof NotificationPreferences) {
    setDraft({ ...draft, [key]: !draft[key] });
    setSaved(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSavePreferences(draft);
    setSaved(true);
  }

  return (
    <div className="account">
      <PageHeader title="Konto" description="Dane użytkownika, gospodarstwa i ustawienia powiadomień." />

      <section className="profile-card" aria-label="Profil">
        <span className="avatar avatar--large" aria-hidden="true">
          {initials(user)}
        </span>
        <div>
          <p className="profile-card__name">
            {user.firstName} {user.lastName}
          </p>
          <p className="profile-card__meta">
            {user.farm.name} · konto od {formatDatePl(user.memberSince)}
          </p>
        </div>
        <ul className="profile-card__stats">
          <li>
            <span className="profile-card__value">{parcelCount}</span>
            <span>{parcelCount === 1 ? 'działka' : parcelCount % 10 >= 2 && parcelCount % 10 <= 4 && (parcelCount % 100 < 12 || parcelCount % 100 > 14) ? 'działki' : 'działek'}</span>
          </li>
          <li>
            <span className="profile-card__value">
              <Icon name="check" size={18} />
            </span>
            <span>zalogowano</span>
          </li>
        </ul>
      </section>

      <div className="account__grid">
        <section className="panel" aria-labelledby="tytul-dane">
          <div className="panel__header">
            <h2 id="tytul-dane">Dane użytkownika</h2>
          </div>
          <dl className="meta-list meta-list--wide">
            <div>
              <dt>Imię i nazwisko</dt>
              <dd>
                {user.firstName} {user.lastName}
              </dd>
            </div>
            <div>
              <dt>E-mail</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Telefon</dt>
              <dd>{user.phone}</dd>
            </div>
          </dl>
        </section>

        <section className="panel" aria-labelledby="tytul-gospodarstwo">
          <div className="panel__header">
            <h2 id="tytul-gospodarstwo">Gospodarstwo</h2>
          </div>
          <dl className="meta-list meta-list--wide">
            <div>
              <dt>Nazwa</dt>
              <dd>{user.farm.name}</dd>
            </div>
            <div>
              <dt>Siedziba</dt>
              <dd>{user.farm.seat}</dd>
            </div>
            <div>
              <dt>Doradca</dt>
              <dd>{user.farm.advisor ?? 'nie wskazano'}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="panel" aria-labelledby="tytul-ustawienia">
        <div className="panel__header">
          <h2 id="tytul-ustawienia">Ustawienia powiadomień</h2>
        </div>
        <form onSubmit={submit}>
          <div className="settings-grid">
            <fieldset className="settings-group">
              <legend>Kanały</legend>
              {CHANNELS.map((item) => (
                <Toggle key={item.key} id={`kanal-${item.key}`} checked={draft[item.key]} onChange={() => toggle(item.key)} label={item.label} hint={item.hint} />
              ))}
            </fieldset>
            <fieldset className="settings-group">
              <legend>Tematy</legend>
              {TOPICS.map((item) => (
                <Toggle key={item.key} id={`temat-${item.key}`} checked={draft[item.key]} onChange={() => toggle(item.key)} label={item.label} hint={item.hint} />
              ))}
            </fieldset>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={!changed}>
              Zapisz ustawienia
            </button>
            <p className="form-actions__status" role="status" aria-live="polite">
              {saved && !changed && (
                <>
                  <Icon name="check" size={18} /> Zapisano ustawienia.
                </>
              )}
            </p>
          </div>
        </form>
      </section>
    </div>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="toggle">
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={onChange} aria-describedby={`${id}-opis`} />
      <label htmlFor={id}>
        <span className="toggle__track" aria-hidden="true">
          <span className="toggle__thumb" />
        </span>
        <span className="toggle__text">
          <span className="toggle__label">{label}</span>
          <span className="toggle__hint" id={`${id}-opis`}>
            {hint}
          </span>
        </span>
      </label>
    </div>
  );
}
