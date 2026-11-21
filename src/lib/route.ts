import { isCropId } from '../data/crops';
import type { AnalysisRequest } from '../types/analysis';

/**
 * Prosta nawigacja oparta na fragmencie adresu (#), bez dodatkowej biblioteki.
 * Raport ma własny adres z parametrami, więc działa przycisk „Wstecz”, odświeżenie strony i udostępnienie linku.
 */
export type Route = { name: 'analysis' } | { name: 'report'; request: AnalysisRequest | null };

export function parseHash(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  if (path === '/raport') {
    const params = new URLSearchParams(query);
    const parcelId = params.get('dzialka') ?? '';
    const cropId = params.get('uprawa') ?? '';
    const analysisDate = params.get('data') ?? '';
    if (parcelId && isCropId(cropId) && analysisDate) {
      return { name: 'report', request: { parcelId, cropId, analysisDate } };
    }
    return { name: 'report', request: null };
  }
  return { name: 'analysis' };
}

export function reportHash(request: AnalysisRequest): string {
  const params = new URLSearchParams({
    dzialka: request.parcelId,
    uprawa: request.cropId,
    data: request.analysisDate,
  });
  return `#/raport?${params.toString()}`;
}

export const ANALYSIS_HASH = '#/';

export function sameRequest(a: AnalysisRequest, b: AnalysisRequest): boolean {
  return a.parcelId === b.parcelId && a.cropId === b.cropId && a.analysisDate === b.analysisDate;
}
