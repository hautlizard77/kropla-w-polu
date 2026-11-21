import { compareIsoDates } from '../lib/dates';
import type { IsoDate } from '../types/analysis';

/**
 * Odtworzenie stanu na dzień analizy: zostawiamy tylko obserwacje z tego dnia lub wcześniejsze.
 * Zwracamy też datę ostatniej dostępnej obserwacji – przy niepełnym „dziś” raport ją pokazuje.
 */
export function observationsUpTo<T extends { date: IsoDate }>(
  observations: T[],
  analysisDate: IsoDate,
): { kept: T[]; excludedAfterCount: number; lastObservationDate: IsoDate | null } {
  const kept = observations
    .filter((observation) => compareIsoDates(observation.date, analysisDate) <= 0)
    .sort((a, b) => compareIsoDates(a.date, b.date));
  const last = kept[kept.length - 1];
  return {
    kept,
    excludedAfterCount: observations.length - kept.length,
    lastObservationDate: last ? last.date : null,
  };
}
