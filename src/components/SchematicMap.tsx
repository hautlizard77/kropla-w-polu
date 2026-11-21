import { useId } from 'react';
import { boundsOf } from '../data/geometry';
import type { PolygonGeometry } from '../types/analysis';

interface Props {
  parcel: { id: string; geometry: PolygonGeometry };
  highlights?: { label: string; geometry: PolygonGeometry }[];
  title: string;
  className?: string;
}

const SIZE = { width: 320, height: 220, padding: 16 };

/**
 * Prosty szkic działki bez podkładu mapowego.
 * Używany jako stan awaryjny mapy i na wydruku raportu (kafelki mapy drukują się zawodnie).
 */
export function SchematicMap({ parcel, highlights = [], title, className }: Props) {
  const patternId = `kreskowanie-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const bounds = boundsOf([parcel.geometry, ...highlights.map((h) => h.geometry)]);
  if (!bounds) return null;
  const [minLng, minLat, maxLng, maxLat] = bounds;
  const midLat = (minLat + maxLat) / 2;
  const lngScale = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max((maxLng - minLng) * lngScale, 1e-9);
  const spanY = Math.max(maxLat - minLat, 1e-9);
  const scale = Math.min((SIZE.width - 2 * SIZE.padding) / spanX, (SIZE.height - 2 * SIZE.padding) / spanY);
  const offsetX = (SIZE.width - spanX * scale) / 2;
  const offsetY = (SIZE.height - spanY * scale) / 2;

  const toPath = (geometry: PolygonGeometry) =>
    geometry.coordinates
      .map(
        (ring) =>
          ring
            .map(([lng, lat], index) => {
              const x = offsetX + (lng - minLng) * lngScale * scale;
              const y = offsetY + (maxLat - lat) * scale;
              return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ') + ' Z',
      )
      .join(' ');

  return (
    <figure className={`schematic ${className ?? ''}`}>
      <svg viewBox={`0 0 ${SIZE.width} ${SIZE.height}`} role="img" aria-label={title}>
        <defs>
          <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--water-700)" strokeWidth="2.5" />
          </pattern>
        </defs>
        <rect width={SIZE.width} height={SIZE.height} fill="var(--surface-muted)" />
        <path d={toPath(parcel.geometry)} fill="var(--green-100)" stroke="var(--green-700)" strokeWidth="2" />
        {highlights.map((highlight) => (
          <path key={highlight.label} d={toPath(highlight.geometry)} fill={`url(#${patternId})`} stroke="var(--water-700)" strokeWidth="1.5" />
        ))}
        <text x={SIZE.width - 14} y={22} textAnchor="middle" fontSize="12" fill="var(--text-muted)">
          N↑
        </text>
      </svg>
      <figcaption>
        <span className="legend legend--parcel">Granica działki</span>
        {highlights.map((highlight) => (
          <span key={highlight.label} className="legend legend--area">
            {highlight.label}
          </span>
        ))}
        <span className="muted"> · szkic bez podkładu mapy, geometria ilustracyjna</span>
      </figcaption>
    </figure>
  );
}
