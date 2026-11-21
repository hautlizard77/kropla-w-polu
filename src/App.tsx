import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccountScreen } from './components/AccountScreen';
import { AnalysisScreen } from './components/AnalysisScreen';
import { AppShell } from './components/AppShell';
import { HelpScreen } from './components/HelpScreen';
import { NotificationsScreen } from './components/NotificationsScreen';
import { ParcelsScreen } from './components/ParcelsScreen';
import { ReportScreen } from './components/ReportScreen';
import { CURRENT_USER, DEFAULT_PREFERENCES } from './data/account';
import { todayInPoland } from './lib/dates';
import { HASH, parseHash, reportHash, type Route } from './lib/route';
import { loadJson, saveJson } from './lib/storage';
import type { FormValues } from './lib/validation';
import { analysisSnapshot, buildNotifications, parcelFromLookup, summarizeParcels, visibleNotifications } from './services/account';
import { fetchParcel } from './services/terrain';
import type { NotificationPreferences, SavedParcel } from './types/account';
import type { AnalysisRequest, AnalysisResult } from './types/analysis';

const EMPTY_FORM: FormValues = { parcelId: '', cropId: '', analysisDate: todayInPoland() };

/** Parametr ?symulujBlad=1 w adresie pozwala sprawdzić stan błędu technicznego. */
const SIMULATE_ERROR = new URLSearchParams(window.location.search).has('symulujBlad');

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [formValues, setFormValues] = useState<FormValues>(() => {
    const initial = parseHash(window.location.hash);
    return initial.name === 'report' && initial.request ? toFormValues(initial.request) : EMPTY_FORM;
  });
  // Wynik policzony na ekranie analizy – raport nie musi go pobierać drugi raz.
  const [lastResult, setLastResult] = useState<AnalysisResult | null>(null);

  // Stan konta zapisywany w przeglądarce.
  const [addedParcels, setAddedParcels] = useState<SavedParcel[]>(() => loadJson('dodane-dzialki', []));
  const [readIds, setReadIds] = useState<string[]>(() => loadJson('przeczytane', []));
  const [preferences, setPreferences] = useState<NotificationPreferences>(() => ({
    ...DEFAULT_PREFERENCES,
    ...loadJson<Partial<NotificationPreferences>>('preferencje', {}),
  }));

  useEffect(() => saveJson('dodane-dzialki', addedParcels), [addedParcels]);
  useEffect(() => saveJson('przeczytane', readIds), [readIds]);
  useEffect(() => saveJson('preferencje', preferences), [preferences]);

  // Działki bez granicy: pobieramy ją z ULDK (przez serwer aplikacji) i zapamiętujemy przy działce.
  useEffect(() => {
    const missing = addedParcels.filter((item) => !item.details && !item.lookup);
    if (missing.length === 0) return;
    let cancelled = false;
    for (const item of missing) {
      fetchParcel(item.parcelId)
        .then((lookup) => {
          if (cancelled) return;
          if (lookup.status === 'ok') {
            const details = parcelFromLookup(lookup.parcel);
            setAddedParcels((items) => items.map((p) => (p.parcelId === item.parcelId ? { ...p, details } : p)));
          } else if (lookup.status === 'not_found') {
            setAddedParcels((items) =>
              items.map((p) => (p.parcelId === item.parcelId ? { ...p, lookup: { status: 'not_found', message: lookup.message } } : p)),
            );
          }
          // Błąd usługi – spróbujemy przy następnym otwarciu aplikacji.
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [addedParcels]);

  /** Otwarty raport zapisujemy jako „ostatnią analizę” działki, jeśli jest na liście. */
  const rememberAnalysis = useCallback((result: AnalysisResult) => {
    if (result.isDemo) return;
    setAddedParcels((items) =>
      items.some((p) => p.parcelId === result.request.parcelId)
        ? items.map((p) => (p.parcelId === result.request.parcelId ? { ...p, lastAnalysis: analysisSnapshot(result) } : p))
        : items,
    );
  }, []);

  const parcels = useMemo(() => summarizeParcels(addedParcels), [addedParcels]);
  const notifications = useMemo(() => visibleNotifications(buildNotifications(parcels, todayInPoland()), preferences), [parcels, preferences]);
  const unreadCount = preferences.inApp ? notifications.filter((item) => !readIds.includes(item.id)).length : 0;

  useEffect(() => {
    const onHashChange = () => {
      const next = parseHash(window.location.hash);
      setRoute(next);
      if (next.name === 'report' && next.request) setFormValues(toFormValues(next.request));
      window.scrollTo(0, 0);
      document.getElementById('tresc')?.focus({ preventScroll: true });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const openReport = useCallback((result: AnalysisResult) => {
    setLastResult(result);
    setFormValues(toFormValues(result.request));
    window.location.hash = reportHash(result.request);
  }, []);

  const goToAnalysis = useCallback(() => {
    window.location.hash = HASH.analysis;
  }, []);

  const markRead = useCallback((id: string) => {
    setReadIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
  }, []);

  const markAllRead = useCallback(() => {
    setReadIds((ids) => Array.from(new Set([...ids, ...notifications.map((item) => item.id)])));
  }, [notifications]);

  const analyzeSaved = useCallback((parcel: SavedParcel) => {
    setFormValues({ parcelId: parcel.parcelId, cropId: parcel.cropId, analysisDate: todayInPoland() });
    window.location.hash = HASH.analysis;
  }, []);

  let screen: ReactNode;
  switch (route.name) {
    case 'parcels':
      screen = (
        <ParcelsScreen
          parcels={parcels}
          lockedIds={[]}
          onAdd={(parcel) => setAddedParcels((items) => [...items, parcel])}
          onRemove={(parcelId) => setAddedParcels((items) => items.filter((item) => item.parcelId !== parcelId))}
          onAnalyze={analyzeSaved}
        />
      );
      break;
    case 'analysis':
      screen = (
        <AnalysisScreen
          values={formValues}
          onValuesChange={setFormValues}
          onResult={openReport}
          simulateError={SIMULATE_ERROR}
          savedParcels={parcels}
        />
      );
      break;
    case 'report':
      screen = (
        <ReportScreen
          request={route.request}
          cachedResult={lastResult}
          onChangeParcel={goToAnalysis}
          onLoaded={rememberAnalysis}
          simulateError={SIMULATE_ERROR}
        />
      );
      break;
    case 'notifications':
      screen = (
        <NotificationsScreen
          notifications={notifications}
          readIds={readIds}
          onMarkRead={markRead}
          onMarkAllRead={markAllRead}
        />
      );
      break;
    case 'help':
      screen = <HelpScreen />;
      break;
    case 'account':
      screen = (
        <AccountScreen
          user={CURRENT_USER}
          parcelCount={parcels.length}
          preferences={preferences}
          onSavePreferences={setPreferences}
        />
      );
      break;
  }

  return (
    <AppShell route={route.name} user={CURRENT_USER} unreadCount={unreadCount}>
      {screen}
    </AppShell>
  );
}

function toFormValues(request: AnalysisRequest): FormValues {
  return { parcelId: request.parcelId, cropId: request.cropId, analysisDate: request.analysisDate };
}
