import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccountScreen } from './components/AccountScreen';
import { AnalysisScreen } from './components/AnalysisScreen';
import { AppShell } from './components/AppShell';
import { HelpScreen } from './components/HelpScreen';
import { NotificationsScreen } from './components/NotificationsScreen';
import { ParcelsScreen } from './components/ParcelsScreen';
import { ReportScreen } from './components/ReportScreen';
import { CURRENT_USER, DEFAULT_PREFERENCES, INITIAL_NOTIFICATIONS } from './data/account';
import { todayInPoland } from './lib/dates';
import { HASH, parseHash, reportHash, type Route } from './lib/route';
import { loadJson, saveJson } from './lib/storage';
import type { FormValues } from './lib/validation';
import { summarizeParcels, visibleNotifications } from './services/account';
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

  const parcels = useMemo(() => summarizeParcels(addedParcels), [addedParcels]);
  const notifications = useMemo(() => visibleNotifications(INITIAL_NOTIFICATIONS, preferences), [preferences]);
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
