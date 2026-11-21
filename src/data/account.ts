/**
 * Konto użytkownika na potrzeby pokazu. Zakładamy, że użytkownik jest stale zalogowany.
 * Osoba, gospodarstwo i dane kontaktowe są fikcyjne.
 */
import type { AppNotification, NotificationPreferences, UserAccount } from '../types/account';
import { reportHash } from '../lib/route';

export const CURRENT_USER: UserAccount = {
  id: 'u-0001',
  firstName: 'Jan',
  lastName: 'Nowak',
  email: 'jan.nowak@example.com',
  phone: '+48 600 000 000',
  memberSince: '2025-03-14',
  farm: {
    name: 'Gospodarstwo Rolne Nowak',
    seat: 'gm. Kruszwica, woj. kujawsko-pomorskie',
    advisor: 'Doradca rolny – ośrodek doradztwa rolniczego',
  },
};


export const DEFAULT_PREFERENCES: NotificationPreferences = {
  inApp: true,
  email: true,
  sms: false,
  riskAlerts: true,
  dataGaps: true,
  seasonalTips: true,
};

export const INITIAL_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'n-005',
    kind: 'risk',
    title: 'Podwyższone ryzyko niedoboru wody – Pole przy rowie',
    body: 'Analiza na 26 czerwca 2019 r. wskazuje podwyższone ryzyko. Sprawdź zalecenia dotyczące zatrzymania wody w rowie.',
    createdAt: '2026-11-21T07:42:00+01:00',
    parcelId: '040705_5.0012.245/3',
    link: {
      href: reportHash({ parcelId: '040705_5.0012.245/3', cropId: 'pszenica_ozima', analysisDate: '2019-06-26' }),
      label: 'Otwórz raport',
    },
  },
  {
    id: 'n-004',
    kind: 'data',
    title: 'Brak aktualnych zdjęć satelitarnych – Pole kukurydziane',
    body: 'Zachmurzenie zasłoniło działkę. Ocena na 8 sierpnia 2024 r. opiera się na niepełnych danych – warto obejrzeć uprawę w terenie.',
    createdAt: '2026-11-20T16:05:00+01:00',
    parcelId: '302005_2.0015.88/2',
    link: {
      href: reportHash({ parcelId: '302005_2.0015.88/2', cropId: 'kukurydza_ziarno', analysisDate: '2024-08-08' }),
      label: 'Zobacz szczegóły',
    },
  },
  {
    id: 'n-003',
    kind: 'report',
    title: 'Raport gotowy – Stok za lasem',
    body: 'Niskie ryzyko niedoboru wody. Raport zawiera dwa zalecenia ograniczające spływ wody ze stoku.',
    createdAt: '2026-11-19T10:18:00+01:00',
    parcelId: '062010_2.0004.301',
    link: {
      href: reportHash({ parcelId: '062010_2.0004.301', cropId: 'rzepak_ozimy', analysisDate: '2021-05-20' }),
      label: 'Otwórz raport',
    },
  },
  {
    id: 'n-002',
    kind: 'tip',
    title: 'Jesień to dobry moment na plan retencji',
    body: 'Przed zimą sprawdź stan rowów i przepustów. Zastawki warto zamknąć wczesną wiosną, zanim odpłyną wody roztopowe.',
    createdAt: '2026-11-12T09:00:00+01:00',
    parcelId: null,
    link: null,
  },
  {
    id: 'n-001',
    kind: 'account',
    title: 'Uzupełnij dane gospodarstwa',
    body: 'Dodaj doradcę rolnego, aby łatwiej udostępniać mu raporty z analizy działek.',
    createdAt: '2026-11-03T12:30:00+01:00',
    parcelId: null,
    link: { href: '#/konto', label: 'Przejdź do konta' },
  },
];
