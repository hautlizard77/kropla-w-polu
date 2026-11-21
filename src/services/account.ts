/**
 * Dane konta zalogowanego użytkownika.
 *
 * Teraz: konto, działki i powiadomienia pochodzą z src/data/account.ts, a stan ostatniej analizy działki
 * z tych samych danych, z których korzysta serwis analizy. Docelowo: API konta użytkownika.
 */
import { DEMO_SCENARIOS } from '../data/demoScenarios';
import type { AppNotification, NotificationPreferences, ParcelSummary, SavedParcel } from '../types/account';
import type { AnalysisResult, Parcel } from '../types/analysis';
import type { ParcelInfo } from '../types/terrain';

/** Dane działki z ULDK w postaci używanej przez listy i mapy. */
export function parcelFromLookup(info: ParcelInfo): Parcel {
  const ring = info.ringWgs84;
  const closed = ring.length > 0 && (ring[0]![0] !== ring[ring.length - 1]![0] || ring[0]![1] !== ring[ring.length - 1]![1]) ? [...ring, ring[0]!] : ring;
  return {
    id: info.id,
    locationLabel: info.region ? `obręb ${info.region}` : 'obręb nieznany',
    commune: info.commune ?? 'nieznana',
    county: info.county ?? 'nieznany',
    voivodeship: info.voivodeship ?? 'nieznane',
    areaHa: Math.round(info.areaHa * 100) / 100,
    geometry: { type: 'Polygon', coordinates: [closed.map(([x, y]) => [x, y] as [number, number])] },
  };
}

/** Skrót wyniku analizy zapamiętywany przy działce. */
export function analysisSnapshot(result: AnalysisResult): NonNullable<SavedParcel['lastAnalysis']> {
  return {
    request: result.request,
    level: result.currentState.level,
    headline: result.currentState.headline,
    historicalLevel: result.historicalVulnerability.level,
  };
}

export function summarizeParcels(saved: SavedParcel[]): ParcelSummary[] {
  return saved.map((item) => {
    const scenario = DEMO_SCENARIOS.find((candidate) => candidate.request.parcelId === item.parcelId) ?? null;
    const analysed = scenario && scenario.request.cropId === item.cropId ? scenario : null;
    const parcel = scenario?.result.parcel ?? item.details ?? null;
    return {
      saved: item,
      parcel,
      lookup: parcel ? 'ok' : item.lookup?.status === 'not_found' ? 'not_found' : 'pending',
      lookupMessage: item.lookup?.message ?? null,
      lastAnalysis: item.lastAnalysis ?? (analysed
        ? {
            request: analysed.request,
            level: analysed.result.currentState.level,
            headline: analysed.result.currentState.headline,
            historicalLevel: analysed.result.historicalVulnerability.level,
          }
        : null),
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
