/**
 * Dane konta zalogowanego użytkownika.
 *
 * Konto pochodzi z src/data/account.ts, działki z pamięci przeglądarki. Powiadomienia nie są zapisane na sztywno –
 * powstają z działek użytkownika i ich ostatnich ocen (buildNotifications). Docelowo: API konta użytkownika.
 */
import { DEMO_SCENARIOS } from '../data/demoScenarios';
import type { AppNotification, NotificationPreferences, ParcelSummary, SavedParcel } from '../types/account';
import type { AnalysisResult, IsoDate, Parcel } from '../types/analysis';
import { cropLabel } from '../data/crops';
import { compareIsoDates, formatDatePl } from '../lib/dates';
import { DATA_KIND_LABELS, RISK_LABELS } from '../lib/labels';
import { HASH, reportHash } from '../lib/route';
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

/** Skrót wyniku analizy zapamiętywany przy działce – z niego powstają powiadomienia. */
export function analysisSnapshot(result: AnalysisResult): NonNullable<SavedParcel['lastAnalysis']> {
  const missing = result.dataSources
    .filter((source) => source.availability === 'missing' && source.id !== 'prognoza' && source.id !== 'hydro' && source.kind !== 'teren' && source.kind !== 'satelita')
    .map((source) => DATA_KIND_LABELS[source.kind]);
  const steps = result.forecast?.status === 'ok' ? result.forecast.steps : [];
  const step = steps.find((s) => s.tone === 'warning') ?? steps[0];
  return {
    request: result.request,
    level: result.currentState.level,
    headline: result.currentState.headline,
    summary: result.currentState.summary,
    historicalLevel: result.historicalVulnerability.level,
    analysedAt: result.generatedAt,
    missingData: Array.from(new Set(missing)),
    ...(step ? { nextStep: { when: step.when, title: step.title, text: step.text, urgent: step.tone === 'warning' } } : {}),
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

/** Po tylu dniach ocena działki uznawana jest za nieaktualną. */
const STALE_DAYS = 14;

/**
 * Powiadomienia wyliczone ze stanu konta: ryzyko i pilne kroki z ostatnich ocen, braki danych, działki bez oceny
 * lub nieznalezione w ewidencji oraz porada na bieżący miesiąc. Identyfikatory zależą od treści, więc nowa ocena
 * daje nowe (nieprzeczytane) powiadomienie, a ta sama – nie.
 */
export function buildNotifications(parcels: ParcelSummary[], today: IsoDate, now: string = new Date().toISOString()): AppNotification[] {
  const out: AppNotification[] = [];
  for (const item of parcels) {
    const { saved } = item;
    const name = saved.name || saved.parcelId;
    const addedAt = `${saved.addedOn}T08:00:00+01:00`;
    const todayRequest = { parcelId: saved.parcelId, cropId: saved.cropId, analysisDate: today };
    if (item.lookup === 'not_found') {
      out.push({
        id: `uldk:${saved.parcelId}`,
        kind: 'data',
        title: `Nie znaleziono działki „${name}” w ewidencji`,
        body: `${item.lookupMessage ?? 'Usługa ULDK nie zna tego identyfikatora.'} Sprawdź identyfikator ${saved.parcelId} w wypisie z rejestru gruntów i dodaj działkę ponownie.`,
        createdAt: addedAt,
        parcelId: saved.parcelId,
        link: { href: HASH.parcels, label: 'Przejdź do działek' },
      });
      continue;
    }
    const last = item.lastAnalysis;
    if (!last) {
      if (item.lookup !== 'ok') continue;
      out.push({
        id: `nowa:${saved.parcelId}:${saved.cropId}`,
        kind: 'report',
        title: `Działka „${name}” czeka na pierwszą ocenę`,
        body: `Sprawdź, czy uprawie (${cropLabel(saved.cropId).toLocaleLowerCase('pl-PL')}) nie brakuje wody i jak zatrzymać ją na polu.`,
        createdAt: addedAt,
        parcelId: saved.parcelId,
        link: { href: reportHash(todayRequest), label: 'Sprawdź sytuację wodną' },
      });
      continue;
    }
    const when = formatDatePl(last.request.analysisDate);
    const createdAt = last.analysedAt ?? addedAt;
    const key = `${saved.parcelId}:${last.request.cropId}:${last.request.analysisDate}`;
    const link = { href: reportHash(last.request), label: 'Otwórz raport' };
    const atRisk = last.level === 'elevated' || last.level === 'moderate';
    if (last.nextStep?.urgent) {
      out.push({
        id: `krok:${key}:${last.nextStep.title}`,
        kind: 'risk',
        title: `${last.nextStep.title} – ${name}`,
        body: `${last.nextStep.when}: ${last.nextStep.text}`,
        createdAt,
        parcelId: saved.parcelId,
        link: { href: reportHash(last.request), label: 'Zobacz plan nawadniania' },
      });
    }
    if (atRisk) {
      out.push({
        id: `ryzyko:${key}:${last.level}`,
        kind: 'risk',
        title: `${RISK_LABELS[last.level]} niedoboru wody – ${name}`,
        body: `Ocena na ${when}. ${sentence(last.summary ?? last.headline)} Jak zatrzymać wodę na tej działce – zakładka „Zalecenia”.`,
        createdAt,
        parcelId: saved.parcelId,
        link,
      });
    } else if (!last.nextStep?.urgent) {
      out.push({
        id: `raport:${key}:${last.level}`,
        kind: 'report',
        title: `${last.level === 'insufficient_data' ? 'Za mało danych do oceny' : 'Niskie ryzyko niedoboru wody'} – ${name}`,
        body: `Ocena na ${when}. ${sentence(last.summary ?? last.headline)}`,
        createdAt,
        parcelId: saved.parcelId,
        link,
      });
    }
    if (last.missingData && last.missingData.length > 0) {
      out.push({
        id: `braki:${key}:${last.missingData.join(',')}`,
        kind: 'data',
        title: `Ocena działki „${name}” bez części danych`,
        body: `Zabrakło: ${last.missingData.map((m) => m.toLocaleLowerCase('pl-PL')).join(', ')}. Usługa mogła chwilowo nie odpowiadać – otwórz raport ponownie za kilka minut, wynik będzie pewniejszy.`,
        createdAt,
        parcelId: saved.parcelId,
        link,
      });
    }
    if (daysBetween(last.request.analysisDate, today) > STALE_DAYS) {
      out.push({
        id: `nieaktualna:${key}`,
        kind: 'report',
        title: `Ocena działki „${name}” jest z ${when}`,
        body: 'Od tego czasu pogoda i zapas wody w glebie się zmieniły. Policz ocenę na dziś, żeby dostać bilans wody i plan na najbliższe dni.',
        createdAt: now,
        parcelId: saved.parcelId,
        link: { href: reportHash({ ...last.request, analysisDate: today }), label: 'Oceń na dziś' },
      });
    }
  }
  if (parcels.length === 0) {
    out.push({
      id: 'start:dzialki',
      kind: 'account',
      title: 'Dodaj swoją pierwszą działkę',
      body: 'Po dodaniu działki i uprawy powiadomimy Cię tutaj o ryzyku niedoboru wody, brakach w danych i pilnych krokach.',
      createdAt: now,
      parcelId: null,
      link: { href: HASH.parcels, label: 'Przejdź do działek' },
    });
  }
  out.push(seasonalTip(today));
  return sortNotifications(out);
}

const TIPS: { months: number[]; title: string; body: string }[] = [
  { months: [1, 2], title: 'Przed roztopami przygotuj zastawki', body: 'Woda z topniejącego śniegu to największy zapas na wiosnę. Sprawdź zastawki na rowach i uzgodnij ze spółką wodną ich zamknięcie, zanim ruszą roztopy.' },
  { months: [3], title: 'Zatrzymaj wodę roztopową na polu', body: 'Zamknij zastawki na rowach i nie spiesz się z głęboką uprawą – każde odwrócenie skiby wiosną przesusza glebę.' },
  { months: [4], title: 'Ogranicz parowanie przy siewach', body: 'Uprawa uproszczona, wałowanie po siewie i pozostawienie resztek roślin na powierzchni zmniejszają utratę wody z gleby.' },
  { months: [5, 6], title: 'Okres krytyczny dla zbóż i rzepaku', body: 'Teraz niedobór wody najmocniej obniża plon. Sprawdzaj bilans wody na dziś w zakładce „Nawadnianie” i nie spuszczaj wody z rowów.' },
  { months: [7, 8], title: 'Po żniwach nie zostawiaj gołej ścierni', body: 'Szybki międzyplon albo mulcz ze słomy ogranicza parowanie i chroni glebę przed ulewą, która w lecie zwykle spływa z pola.' },
  { months: [9, 10], title: 'Jesień buduje zapas wody w glebie', body: 'Więcej próchnicy to więcej zatrzymanej wody: obornik, międzyplony i przyorana słoma działają przez kolejne sezony.' },
  { months: [11, 12], title: 'Przegląd rowów i przepustów przed zimą', body: 'Udrożnij przepusty i zaplanuj zastawki. W zakładce „Teren i spływ 3D” sprawdź, gdzie na polu zbiera się woda – tam warto ją zatrzymać.' },
];

function seasonalTip(today: IsoDate): AppNotification {
  const month = Number(today.slice(5, 7));
  const tip = TIPS.find((t) => t.months.includes(month)) ?? TIPS[0]!;
  return {
    id: `porada:${today.slice(0, 4)}:${tip.months[0]}`,
    kind: 'tip',
    title: tip.title,
    body: tip.body,
    createdAt: `${today.slice(0, 7)}-01T08:00:00+01:00`,
    parcelId: null,
    link: null,
  };
}

function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  if (compareIsoDates(from, to) >= 0) return 0;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
