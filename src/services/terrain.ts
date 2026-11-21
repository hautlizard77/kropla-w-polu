/**
 * Klient API terenu i NDMI. Wyniki zapamiętujemy w pamięci strony – ponowne otwarcie widoku nie pobiera ich drugi raz.
 */
import type { NdmiResponse, ParcelLookup, TerrainResponse } from '../types/terrain';

const memory = new Map<string, Promise<unknown>>();

export class ApiUnavailableError extends Error {}

async function getJson<T>(path: string, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const response = await fetch(path, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('application/json')) {
      throw new ApiUnavailableError(
        'Serwer danych aplikacji nie odpowiada. Uruchom aplikację poleceniem „npm run dev” albo „npm start” (patrz README).',
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiUnavailableError) throw error;
    if (signal?.aborted) throw error;
    if (controller.signal.aborted) throw new ApiUnavailableError('Przekroczono czas oczekiwania na serwer danych.');
    throw new ApiUnavailableError('Nie udało się połączyć z serwerem danych aplikacji.');
  } finally {
    window.clearTimeout(timer);
  }
}

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  let promise = memory.get(key) as Promise<T> | undefined;
  if (!promise) {
    promise = load();
    memory.set(key, promise);
    // Błędów nie zapamiętujemy – kolejna próba pobierze dane ponownie.
    promise.catch(() => memory.delete(key));
  }
  return promise;
}

export function fetchParcel(parcelId: string): Promise<ParcelLookup> {
  return cached(`parcel:${parcelId}`, () => getJson<ParcelLookup>(`/api/parcel?id=${encodeURIComponent(parcelId)}`, 30000));
}

export function fetchTerrain(parcelId: string): Promise<TerrainResponse> {
  return cached(`terrain:${parcelId}`, () =>
    getJson<TerrainResponse>(`/api/terrain?id=${encodeURIComponent(parcelId)}`, 180000),
  );
}

export function fetchNdmi(parcelId: string, date: string): Promise<NdmiResponse> {
  return cached(`ndmi:${parcelId}:${date}`, () =>
    getJson<NdmiResponse>(`/api/ndmi?id=${encodeURIComponent(parcelId)}&date=${date}`, 180000),
  );
}
