import type { AnalysisRequest, CropId, IsoDate, IsoDateTime, Parcel, RiskLevel } from './analysis';

export interface UserAccount {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  memberSince: IsoDate;
  farm: {
    name: string;
    seat: string;
    advisor: string | null;
  };
}

/** Działka zapisana przez użytkownika na liście „Moje działki”. */
export interface SavedParcel {
  parcelId: string;
  /** Nazwa nadana przez rolnika, np. „Pole przy rowie”. */
  name: string;
  cropId: CropId;
  addedOn: IsoDate;
}

/** Podsumowanie działki do list i panelu głównego – przygotowane przez serwis, nie przez widok. */
export interface ParcelSummary {
  saved: SavedParcel;
  /** Geometria i położenie, jeśli są znane. */
  parcel: Parcel | null;
  lastAnalysis: {
    request: AnalysisRequest;
    level: RiskLevel;
    headline: string;
    historicalLevel: RiskLevel;
  } | null;
}

export type NotificationKind = 'risk' | 'data' | 'report' | 'tip' | 'account';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: IsoDateTime;
  parcelId: string | null;
  /** Adres widoku w aplikacji (#/...), do którego prowadzi powiadomienie. */
  link: { href: string; label: string } | null;
}

export interface NotificationPreferences {
  inApp: boolean;
  email: boolean;
  sms: boolean;
  riskAlerts: boolean;
  dataGaps: boolean;
  seasonalTips: boolean;
}
