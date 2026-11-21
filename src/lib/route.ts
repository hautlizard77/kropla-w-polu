import { isCropId } from '../data/crops';
import type { AnalysisRequest } from '../types/analysis';

/**
 * Prosta nawigacja oparta na fragmencie adresu (#), bez dodatkowej biblioteki.
 * Każdy widok ma własny adres, więc działa „Wstecz”, odświeżenie strony i udostępnienie linku.
 */
export type Route =
  | { name: 'dashboard' }
  | { name: 'parcels' }
  | { name: 'analysis' }
  | { name: 'report'; request: AnalysisRequest | null }
  | { name: 'notifications' }
  | { name: 'account' }
  | { name: 'help' };

export type RouteName = Route['name'];

export const HASH = {
  dashboard: '#/',
  parcels: '#/dzialki',
  analysis: '#/analiza',
  notifications: '#/powiadomienia',
  account: '#/konto',
  help: '#/pomoc',
} as const;

/** Zgodność wsteczna – dawny adres ekranu analizy. */
export const ANALYSIS_HASH = HASH.analysis;

export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  switch (path) {
    case '/dzialki':
      return { name: 'parcels' };
    case '/analiza':
      return { name: 'analysis' };
    case '/powiadomienia':
      return { name: 'notifications' };
    case '/konto':
      return { name: 'account' };
    case '/pomoc':
      return { name: 'help' };
    case '/raport': {
      const params = new URLSearchParams(query);
      const parcelId = params.get('dzialka') ?? '';
      const cropId = params.get('uprawa') ?? '';
      const analysisDate = params.get('data') ?? '';
      if (parcelId && isCropId(cropId) && analysisDate) {
        return { name: 'report', request: { parcelId, cropId, analysisDate } };
      }
      return { name: 'report', request: null };
    }
    default:
      return { name: 'dashboard' };
  }
}

export function reportHash(request: AnalysisRequest): string {
  const params = new URLSearchParams({
    dzialka: request.parcelId,
    uprawa: request.cropId,
    data: request.analysisDate,
  });
  return `#/raport?${params.toString()}`;
}

export function sameRequest(a: AnalysisRequest, b: AnalysisRequest): boolean {
  return a.parcelId === b.parcelId && a.cropId === b.cropId && a.analysisDate === b.analysisDate;
}
