/**
 * Bufor wyników: w pamięci procesu oraz na dysku (katalog .cache/ w repozytorium, pomijany przez git).
 * Klucz zawiera wersję algorytmu, więc zmiana obliczeń nie zwraca starych wyników.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const memory = new Map<string, unknown>();
/** Pliki odczytane z dysku (do odtwarzania walidacji na zapisanych danych – validation/run.ts). */
export const cacheReads = new Set<string>();
const MAX_MEMORY_ENTRIES = 200;

export const CACHE_DIR = process.env.KROPLA_CACHE_DIR ?? join(process.cwd(), '.cache');

function fileFor(namespace: string, key: string): string {
  const hash = createHash('sha1').update(key).digest('hex');
  return join(CACHE_DIR, namespace, `${hash}.json`);
}

export async function cacheGet<T>(namespace: string, key: string): Promise<T | null> {
  const memoryKey = `${namespace}:${key}`;
  if (memory.has(memoryKey)) return memory.get(memoryKey) as T;
  try {
    const file = fileFor(namespace, key);
    const value = JSON.parse(await readFile(file, 'utf8')) as T;
    cacheReads.add(file);
    remember(memoryKey, value);
    return value;
  } catch {
    return null;
  }
}

export async function cacheSet(namespace: string, key: string, value: unknown): Promise<void> {
  remember(`${namespace}:${key}`, value);
  try {
    const file = fileFor(namespace, key);
    await mkdir(join(CACHE_DIR, namespace), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  } catch {
    // Brak zapisu na dysk nie blokuje odpowiedzi – zostaje bufor w pamięci.
  }
}

function remember(key: string, value: unknown): void {
  if (memory.size >= MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(key, value);
}

/** Jedno trwające obliczenie na klucz – równoległe zapytania o tę samą działkę czekają na ten sam wynik. */
const inflight = new Map<string, Promise<unknown>>();

export function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = run().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
