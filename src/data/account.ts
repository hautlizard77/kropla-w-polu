/**
 * Konto użytkownika na potrzeby pokazu. Zakładamy, że użytkownik jest stale zalogowany.
 * Osoba, gospodarstwo i dane kontaktowe są fikcyjne.
 */
import type { NotificationPreferences, UserAccount } from '../types/account';

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
  email: false,
  sms: false,
  riskAlerts: true,
  dataGaps: true,
  seasonalTips: true,
};
