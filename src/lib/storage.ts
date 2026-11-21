/**
 * Zapis drobnych ustawień w przeglądarce (przeczytane powiadomienia, preferencje, dodane działki).
 * Pamięć przeglądarki może być niedostępna – wtedy aplikacja działa na wartościach domyślnych.
 */
const PREFIX = 'woda-na-polu:';

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Brak dostępu do pamięci przeglądarki – zmiana obowiązuje tylko do odświeżenia strony.
  }
}
