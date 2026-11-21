/**
 * Widok 2D terenu na płótnie (canvas) – zapas przy braku WebGL, widok do wydruku i podgląd „z góry”.
 */
import type { NdmiResult, TerrainResult, Xy } from '../../types/terrain';
import {
  BOUNDARY_COLOR,
  FLOW_COLOR,
  RETENTION_COLOR,
  cellColor,
  cssColor,
  makeFlowWeight,
  hillshade,
  toGrid,
  type Layers,
  type SurfaceMode,
} from './scene';

export function draw2D(
  canvas: HTMLCanvasElement,
  terrain: TerrainResult,
  ndmi: NdmiResult | null,
  mode: SurfaceMode,
  layers: Layers,
): void {
  const g = terrain.displayGrid;
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 640;
  const scale = cssWidth / g.width;
  const cssHeight = g.height * scale;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Powierzchnia: piksel na komórkę, potem skalowanie.
  const image = new ImageData(g.width, g.height);
  for (let i = 0; i < g.width * g.height; i += 1) {
    const [r, gr, b] = cellColor(terrain, ndmi, mode, layers, i);
    const shade = terrain.elevation[i] === null ? 1 : hillshade(terrain, i);
    image.data[i * 4] = Math.min(255, r * 255 * shade);
    image.data[i * 4 + 1] = Math.min(255, gr * 255 * shade);
    image.data[i * 4 + 2] = Math.min(255, b * 255 * shade);
    image.data[i * 4 + 3] = 255;
  }
  const buffer = document.createElement('canvas');
  buffer.width = g.width;
  buffer.height = g.height;
  buffer.getContext('2d')?.putImageData(image, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);

  const k = scale * ratio;
  const toPx = (p: Xy): Xy => {
    const [col, row] = toGrid(terrain, p);
    return [(col + 0.5) * k, (row + 0.5) * k];
  };

  if (layers.flow) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = cssColor(FLOW_COLOR);
    const flowWeight = makeFlowWeight(terrain);
    for (const line of terrain.flowLines) {
      for (let i = 1; i < line.points.length; i += 1) {
        const weight = flowWeight(line.accumulationM2[i] ?? 0);
        ctx.lineWidth = (0.8 + weight * 5.5) * ratio;
        ctx.globalAlpha = 0.45 + weight * 0.5;
        const [x0, y0] = toPx(line.points[i - 1] as Xy);
        const [x1, y1] = toPx(line.points[i] as Xy);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = cssColor(FLOW_COLOR);
    const arrowLen = Math.max(8, Math.min(16, canvas.width / 45));
    for (const arrow of terrain.arrows) {
      const [x, y] = toPx(arrow.at);
      const dx = arrow.dir[0];
      const dy = -arrow.dir[1];
      ctx.beginPath();
      ctx.moveTo(x + dx * arrowLen * 0.6, y + dy * arrowLen * 0.6);
      ctx.lineTo(x - dx * arrowLen * 0.4 - dy * arrowLen * 0.3, y - dy * arrowLen * 0.4 + dx * arrowLen * 0.3);
      ctx.lineTo(x - dx * arrowLen * 0.4 + dy * arrowLen * 0.3, y - dy * arrowLen * 0.4 - dx * arrowLen * 0.3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const point of terrain.concentration) {
      const [x, y] = toPx(point.at);
      ctx.beginPath();
      ctx.arc(x, y, 6 * ratio, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 3 * ratio;
      ctx.strokeStyle = cssColor(FLOW_COLOR);
      ctx.stroke();
    }
  }

  // Granica działki.
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  strokeRing(ctx, terrain.parcel.ring2180.map(toPx), '#ffffff', 5 * ratio);
  strokeRing(ctx, terrain.parcel.ring2180.map(toPx), cssColor(BOUNDARY_COLOR), 2.5 * ratio);

  if (layers.retention && terrain.retentionCandidate) {
    ctx.setLineDash([6 * ratio, 4 * ratio]);
    strokeRing(ctx, terrain.retentionCandidate.ring.map(toPx), '#ffffff', 5 * ratio);
    strokeRing(ctx, terrain.retentionCandidate.ring.map(toPx), cssColor(RETENTION_COLOR), 3 * ratio);
    ctx.setLineDash([]);
  }
}

function strokeRing(ctx: CanvasRenderingContext2D, points: Xy[], color: string, width: number): void {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(...(points[0] as Xy));
  for (const p of points.slice(1)) ctx.lineTo(...p);
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}
