import { useEffect, useId, useRef, useState } from 'react';
import { centerOf } from '../data/geometry';
import type { PolygonGeometry } from '../types/analysis';
import { loadLeaflet, type Leaflet } from './leafletLoader';
import { SchematicMap } from './SchematicMap';

export interface MapParcel {
  id: string;
  label: string;
  /** Krótki opis na przycisku pod mapą; domyślnie identyfikator działki. */
  chipLabel?: string;
  geometry: PolygonGeometry;
}

interface Props {
  parcels: MapParcel[];
  selectedId: string | null;
  /** Gdy podane – działki można wybierać kliknięciem lub z listy pod mapą. */
  onSelect?: (parcelId: string) => void;
  /** Dodatkowe obszary, np. sugerowane miejsce zatrzymania wody. */
  highlights?: { label: string; geometry: PolygonGeometry }[];
  ariaLabel: string;
  /** Etykieta listy działek pod mapą (dostępna z klawiatury). */
  pickerLabel?: string;
}

type Mode = 'loading' | 'leaflet' | 'fallback';

const POLAND_BOUNDS: [[number, number], [number, number]] = [
  [49.0, 14.1],
  [54.9, 24.2],
];
const TILE_TIMEOUT_MS = 8000;
const NO_HIGHLIGHTS: NonNullable<Props['highlights']> = [];

const COLORS = {
  parcel: '#2f7d4f',
  selected: '#14532d',
  area: '#1f6fa8',
};

export function ParcelMap({ parcels, selectedId, onSelect, highlights = NO_HIGHLIGHTS, ariaLabel, pickerLabel = 'Twoje działki:' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const leafletRef = useRef<Leaflet | null>(null);
  const onSelectRef = useRef(onSelect);
  const [mode, setMode] = useState<Mode>('loading');
  const [tilesFailed, setTilesFailed] = useState(false);
  const pickerId = useId();

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Inicjalizacja mapy (raz).
  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let tileTimer: number | undefined;

    loadLeaflet()
      .then((L) => {
        const container = containerRef.current;
        if (cancelled || !container) return;
        leafletRef.current = L;
        const map = L.map(container, { scrollWheelZoom: false, zoomControl: true });
        map.fitBounds(POLAND_BOUNDS);
        map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');

        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">Współtwórcy OpenStreetMap</a>',
        });
        let loadedAny = false;
        let errors = 0;
        tiles.on('tileload', () => {
          loadedAny = true;
          setTilesFailed(false);
        });
        tiles.on('tileerror', () => {
          errors += 1;
          if (!loadedAny && errors >= 2) setTilesFailed(true);
        });
        tiles.addTo(map);
        tileTimer = window.setTimeout(() => {
          if (!loadedAny) setTilesFailed(true);
        }, TILE_TIMEOUT_MS);

        layerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        resizeObserver = new ResizeObserver(() => map.invalidateSize());
        resizeObserver.observe(container);
        setMode('leaflet');
      })
      .catch(() => {
        if (!cancelled) setMode('fallback');
      });

    return () => {
      cancelled = true;
      window.clearTimeout(tileTimer);
      resizeObserver?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Rysowanie działek i obszarów.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (mode !== 'leaflet' || !L || !map || !layer) return;
    layer.clearLayers();

    const toLatLngs = (geometry: PolygonGeometry) =>
      geometry.coordinates.map((ring) => ring.map(([lng, lat]) => L.latLng(lat, lng)));

    let selectedBounds: import('leaflet').LatLngBounds | null = null;
    let allBounds: import('leaflet').LatLngBounds | null = null;
    for (const parcel of parcels) {
      const isSelected = parcel.id === selectedId;
      const polygon = L.polygon(toLatLngs(parcel.geometry), {
        color: isSelected ? COLORS.selected : COLORS.parcel,
        weight: isSelected ? 4 : 2,
        fillColor: COLORS.parcel,
        fillOpacity: isSelected ? 0.35 : 0.15,
        dashArray: isSelected ? undefined : '6 4',
      }).bindTooltip(parcel.label);
      const center = centerOf(parcel.geometry);
      const marker = center
        ? L.circleMarker([center.lat, center.lng], {
            radius: isSelected ? 9 : 7,
            color: '#ffffff',
            weight: 2,
            fillColor: isSelected ? COLORS.selected : COLORS.parcel,
            fillOpacity: 1,
          }).bindTooltip(parcel.label)
        : null;
      if (onSelectRef.current) {
        const select = () => onSelectRef.current?.(parcel.id);
        polygon.on('click', select);
        marker?.on('click', select);
      }
      polygon.addTo(layer);
      // Znacznik pomaga znaleźć małą działkę przy widoku całej Polski.
      marker?.addTo(layer);
      if (isSelected) selectedBounds = polygon.getBounds();
      allBounds = allBounds ? allBounds.extend(polygon.getBounds()) : polygon.getBounds();
    }

    for (const highlight of highlights) {
      const area = L.polygon(toLatLngs(highlight.geometry), {
        color: COLORS.area,
        weight: 2,
        fillColor: COLORS.area,
        fillOpacity: 0.45,
      }).bindTooltip(highlight.label);
      area.addTo(layer);
      selectedBounds = selectedBounds ? selectedBounds.extend(area.getBounds()) : area.getBounds();
    }

    if (selectedBounds) {
      map.fitBounds(selectedBounds, { padding: [24, 24], maxZoom: 16 });
    } else if (allBounds) {
      // Bez wybranej działki – widok obejmujący wszystkie działki z listy.
      map.fitBounds(allBounds, { padding: [32, 32], maxZoom: 14 });
    } else {
      map.fitBounds(POLAND_BOUNDS);
    }
  }, [mode, parcels, selectedId, highlights]);

  const selected = parcels.find((parcel) => parcel.id === selectedId) ?? null;

  return (
    <div className="parcel-map">
      {mode !== 'fallback' && (
        <div
          ref={containerRef}
          className="parcel-map__canvas"
          role="region"
          aria-label={ariaLabel}
          aria-busy={mode === 'loading'}
        >
          {mode === 'loading' && <p className="parcel-map__loading">Wczytuję mapę…</p>}
        </div>
      )}

      {mode === 'leaflet' && tilesFailed && (
        <p className="map-notice" role="status">
          Nie udało się wczytać podkładu mapy. Granice działek są widoczne na pustym tle. Identyfikator możesz też wpisać
          ręcznie, a lista działek działa bez mapy.
        </p>
      )}

      {mode === 'fallback' && (
        <div className="map-fallback" role="region" aria-label={ariaLabel}>
          <p className="map-notice" role="status">
            {onSelect
              ? parcels.length > 0 ? 'Mapa jest teraz niedostępna – wybierz działkę z listy poniżej albo wpisz identyfikator.' : 'Mapa jest teraz niedostępna – wpisz identyfikator działki w formularzu.'
              : 'Mapa jest teraz niedostępna. Poniżej pokazujemy szkic działki bez podkładu mapy.'}
          </p>
          {selected && <SchematicMap parcel={selected} highlights={highlights} title={`Szkic działki ${selected.id}`} />}
        </div>
      )}

      {onSelect && parcels.length > 0 && (
        <div className="parcel-picker">
          <p className="parcel-picker__label" id={pickerId}>
            {pickerLabel}
          </p>
          <ul aria-labelledby={pickerId}>
            {parcels.map((parcel) => (
              <li key={parcel.id}>
                <button
                  type="button"
                  className="chip"
                  aria-pressed={parcel.id === selectedId}
                  onClick={() => onSelect(parcel.id)}
                >
                  {parcel.chipLabel ? <span>{parcel.chipLabel}</span> : <span className="mono">{parcel.id}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
