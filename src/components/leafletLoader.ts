/**
 * Leaflet ładujemy dynamicznie: jeśli biblioteka lub jej styl się nie wczyta,
 * mapa przechodzi w stan awaryjny, a formularz i przykłady działają dalej.
 */
export type Leaflet = typeof import('leaflet');

let pending: Promise<Leaflet> | null = null;

export function loadLeaflet(): Promise<Leaflet> {
  pending ??= Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
    .then(([module]) => {
      const withDefault = module as unknown as { default?: Leaflet };
      return withDefault.default ?? (module as unknown as Leaflet);
    })
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}
