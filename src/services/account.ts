/**
 * Dane konta zalogowanego użytkownika.
 *
 * Teraz: konto, działki i powiadomienia pochodzą z src/data/account.ts, a stan ostatniej analizy działki
 * z tych samych danych, z których korzysta serwis analizy. Docelowo: API konta użytkownika.
 */
import { DEMO_SCENARIOS } from '../data/demoScenarios';
import type { AppNotification, NotificationPreferences, ParcelSummary, SavedParcel } from '../types/account';

export function summarizeParcels(saved: SavedParcel[]): ParcelSummary[] {
  return saved.map((item) => {
    const scenario = DEMO_SCENARIOS.find((candidate) => candidate.request.parcelId === item.parcelId) ?? null;
    const analysed = scenario && scenario.request.cropId === item.cropId ? scenario : null;
    return {
      saved: item,
      parcel: scenario?.result.parcel ?? null,
      lastAnalysis: analysed
        ? {
            request: analysed.request,
            level: analysed.result.currentState.level,
            headline: analysed.result.currentState.headline,
            historicalLevel: analysed.result.historicalVulnerability.level,
          }
        : null,
    };
  });
}

/** Najnowsze powiadomienia na górze. */
export function sortNotifications(items: AppNotification[]): AppNotification[] {
  return [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Powiadomienia zgodne z preferencjami użytkownika. Raporty i sprawy konta są pokazywane zawsze. */
export function visibleNotifications(items: AppNotification[], prefs: NotificationPreferences): AppNotification[] {
  return sortNotifications(items).filter((item) => {
    if (item.kind === 'risk') return prefs.riskAlerts;
    if (item.kind === 'data') return prefs.dataGaps;
    if (item.kind === 'tip') return prefs.seasonalTips;
    return true;
  });
}
