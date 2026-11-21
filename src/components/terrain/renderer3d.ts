/**
 * Widok 3D terenu na WebGL (bez zewnętrznych bibliotek).
 * Siatka terenu z cieniowaniem, granica działki, linie spływu (grubość = względna koncentracja),
 * strzałki kierunku, miejsca koncentracji i obszar do sprawdzenia.
 */
import type { NdmiResult, TerrainResult, Xy } from '../../types/terrain';
import {
  BOUNDARY_COLOR,
  FLOW_COLOR,
  RETENTION_COLOR,
  autoExaggeration,
  cellColor,
  heightAt,
  makeFlowWeight,
  toGrid,
  type Layers,
  type Rgb,
  type SurfaceMode,
} from './scene';

type Mat4 = Float32Array;

function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function lookAt(eye: number[], target: number[], up: number[]): Mat4 {
  const [ex, ey, ez] = eye as [number, number, number];
  let zx = ex - (target[0] as number);
  let zy = ey - (target[1] as number);
  let zz = ez - (target[2] as number);
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len;
  zy /= len;
  zz /= len;
  let xx = (up[1] as number) * zz - (up[2] as number) * zy;
  let xy = (up[2] as number) * zx - (up[0] as number) * zz;
  let xz = (up[0] as number) * zy - (up[1] as number) * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len;
  xy /= len;
  xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * ex + xy * ey + xz * ez), -(yx * ex + yy * ey + yz * ez), -(zx * ex + zy * ey + zz * ez), 1,
  ]);
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += (a[k * 4 + j] as number) * (b[i * 4 + k] as number);
      out[i * 4 + j] = sum;
    }
  }
  return out;
}

const SURFACE_VS = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uMvp;
uniform vec3 uLight;
varying vec3 vColor;
void main() {
  float diffuse = max(dot(normalize(aNormal), uLight), 0.0);
  vColor = aColor * (0.5 + 0.6 * diffuse);
  gl_Position = uMvp * vec4(aPosition, 1.0);
}`;

const FLAT_VS = `
attribute vec3 aPosition;
attribute vec3 aColor;
uniform mat4 uMvp;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uMvp * vec4(aPosition, 1.0);
}`;

const FS = `
precision mediump float;
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0); }`;

interface Program {
  program: WebGLProgram;
  attribs: Record<string, number>;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

interface Mesh {
  buffers: Record<string, WebGLBuffer>;
  index: WebGLBuffer | null;
  count: number;
}

export class WebGLUnavailableError extends Error {}

export class TerrainRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly surfaceProgram: Program;
  private readonly flatProgram: Program;
  private surface: Mesh | null = null;
  private overlay: Mesh | null = null;
  private azimuth = (20 * Math.PI) / 180;
  private elevationAngle = (48 * Math.PI) / 180;
  private distance = 1;
  private baseDistance = 1;
  private target: [number, number, number] = [0, 0, 0];
  private frame = 0;
  private readonly resizeObserver: ResizeObserver;
  private drag: { x: number; y: number } | null = null;
  exaggeration = 1;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly onLost: () => void) {
    const gl = (canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true }) ??
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) throw new WebGLUnavailableError('Przeglądarka nie udostępnia WebGL.');
    this.gl = gl;
    this.surfaceProgram = this.compile(SURFACE_VS, ['aPosition', 'aNormal', 'aColor'], ['uMvp', 'uLight']);
    this.flatProgram = this.compile(FLAT_VS, ['aPosition', 'aColor'], ['uMvp']);
    gl.enable(gl.DEPTH_TEST);
    canvas.addEventListener('webglcontextlost', this.handleLost);
    canvas.addEventListener('pointerdown', this.handleDown);
    canvas.addEventListener('pointermove', this.handleMove);
    canvas.addEventListener('pointerup', this.handleUp);
    canvas.addEventListener('pointercancel', this.handleUp);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('keydown', this.handleKey);
    this.resizeObserver = new ResizeObserver(() => this.requestRender());
    this.resizeObserver.observe(canvas);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.handleLost);
    this.canvas.removeEventListener('pointerdown', this.handleDown);
    this.canvas.removeEventListener('pointermove', this.handleMove);
    this.canvas.removeEventListener('pointerup', this.handleUp);
    this.canvas.removeEventListener('pointercancel', this.handleUp);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('keydown', this.handleKey);
  }

  private compile(vs: string, attribs: string[], uniforms: string[]): Program {
    const gl = this.gl;
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type);
      if (!s) throw new WebGLUnavailableError('Nie udało się utworzyć shadera.');
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new WebGLUnavailableError(gl.getShaderInfoLog(s) ?? 'Błąd shadera');
      return s;
    };
    const program = gl.createProgram();
    if (!program) throw new WebGLUnavailableError('Nie udało się utworzyć programu WebGL.');
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new WebGLUnavailableError(gl.getProgramInfoLog(program) ?? 'Błąd programu');
    return {
      program,
      attribs: Object.fromEntries(attribs.map((a) => [a, gl.getAttribLocation(program, a)])),
      uniforms: Object.fromEntries(uniforms.map((u) => [u, gl.getUniformLocation(program, u)])),
    };
  }

  private upload(data: Record<string, Float32Array>, indices: Uint16Array | null, count: number): Mesh {
    const gl = this.gl;
    const buffers: Record<string, WebGLBuffer> = {};
    for (const [name, array] of Object.entries(data)) {
      const buffer = gl.createBuffer();
      if (!buffer) throw new WebGLUnavailableError('Brak pamięci WebGL.');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
      buffers[name] = buffer;
    }
    let index: WebGLBuffer | null = null;
    if (indices) {
      index = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    }
    return { buffers, index, count };
  }

  private release(mesh: Mesh | null): void {
    if (!mesh) return;
    for (const buffer of Object.values(mesh.buffers)) this.gl.deleteBuffer(buffer);
    if (mesh.index) this.gl.deleteBuffer(mesh.index);
  }

  /** Buduje geometrię sceny dla aktualnych warstw. */
  setScene(terrain: TerrainResult, ndmi: NdmiResult | null, mode: SurfaceMode, layers: Layers, keepCamera = false): void {
    const g = terrain.displayGrid;
    const exaggeration = autoExaggeration(terrain);
    this.exaggeration = exaggeration;
    const zMin = terrain.elevationRange[0];
    const cs = g.cellSize;
    const halfW = ((g.width - 1) * cs) / 2;
    const halfH = ((g.height - 1) * cs) / 2;
    const extent = Math.max(g.width, g.height) * cs;
    const px = (col: number) => col * cs - halfW;
    const pz = (row: number) => row * cs - halfH;
    const py = (z: number) => (z - zMin) * exaggeration;

    // Powierzchnia terenu.
    const n = g.width * g.height;
    const positions = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const zAt = (c: number, r: number) =>
      terrain.elevation[Math.max(0, Math.min(g.height - 1, r)) * g.width + Math.max(0, Math.min(g.width - 1, c))] ?? zMin;
    for (let r = 0; r < g.height; r += 1) {
      for (let c = 0; c < g.width; c += 1) {
        const i = r * g.width + c;
        const z = terrain.elevation[i] ?? zMin;
        positions.set([px(c), py(z), pz(r)], i * 3);
        const dx = (py(zAt(c + 1, r)) - py(zAt(c - 1, r))) / (2 * cs);
        const dz = (py(zAt(c, r + 1)) - py(zAt(c, r - 1))) / (2 * cs);
        const len = Math.hypot(dx, 1, dz);
        normals.set([-dx / len, 1 / len, -dz / len], i * 3);
        colors.set(cellColor(terrain, ndmi, mode, layers, i), i * 3);
      }
    }
    const indices = new Uint16Array((g.width - 1) * (g.height - 1) * 6);
    let k = 0;
    for (let r = 0; r < g.height - 1; r += 1) {
      for (let c = 0; c < g.width - 1; c += 1) {
        const a = r * g.width + c;
        const b = a + 1;
        const d = a + g.width;
        const e = d + 1;
        indices.set([a, d, b, b, d, e], k);
        k += 6;
      }
    }
    this.release(this.surface);
    this.surface = this.upload({ aPosition: positions, aNormal: normals, aColor: colors }, indices, indices.length);

    // Nakładki jako trójkąty nad powierzchnią.
    const lift = Math.max(0.15, extent * 0.002);
    const pos: number[] = [];
    const col: number[] = [];
    const vertex = ([gc, gr]: Xy, color: Rgb, extra = 0) => {
      pos.push(px(gc), py(heightAt(terrain, gc, gr)) + lift + extra, pz(gr));
      col.push(...color);
    };
    const ribbon = (a: Xy, b: Xy, widthM: number, color: Rgb, extra = 0) => {
      const ga = toGrid(terrain, a);
      const gb = toGrid(terrain, b);
      const steps = Math.max(1, Math.ceil(Math.hypot(gb[0] - ga[0], gb[1] - ga[1])));
      const dx = gb[0] - ga[0];
      const dy = gb[1] - ga[1];
      const len = Math.hypot(dx, dy) || 1;
      const half = widthM / 2 / cs;
      const ox = (-dy / len) * half;
      const oy = (dx / len) * half;
      for (let s = 0; s < steps; s += 1) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        const p0: Xy = [ga[0] + dx * t0, ga[1] + dy * t0];
        const p1: Xy = [ga[0] + dx * t1, ga[1] + dy * t1];
        const q = [
          [p0[0] + ox, p0[1] + oy],
          [p0[0] - ox, p0[1] - oy],
          [p1[0] + ox, p1[1] + oy],
          [p1[0] - ox, p1[1] - oy],
        ] as Xy[];
        for (const idx of [0, 1, 2, 2, 1, 3]) vertex(q[idx] as Xy, color, extra);
      }
    };
    const ring = (points: Xy[], widthM: number, color: Rgb, extra = 0) => {
      for (let i = 0; i < points.length; i += 1) ribbon(points[i] as Xy, points[(i + 1) % points.length] as Xy, widthM, color, extra);
    };

    if (layers.flow) {
      const weight = makeFlowWeight(terrain);
      for (const line of terrain.flowLines) {
        for (let i = 1; i < line.points.length; i += 1) {
          const w = weight(line.accumulationM2[i] ?? 0);
          ribbon(line.points[i - 1] as Xy, line.points[i] as Xy, extent * (0.0012 + w * 0.007), FLOW_COLOR, w * lift);
        }
      }
      const size = extent * 0.016;
      for (const arrow of terrain.arrows) {
        const [gc, gr] = toGrid(terrain, arrow.at);
        const fx = arrow.dir[0];
        const fy = -arrow.dir[1];
        const s = size / cs;
        const tip: Xy = [gc + fx * s * 0.6, gr + fy * s * 0.6];
        const left: Xy = [gc - fx * s * 0.4 - fy * s * 0.3, gr - fy * s * 0.4 + fx * s * 0.3];
        const right: Xy = [gc - fx * s * 0.4 + fy * s * 0.3, gr - fy * s * 0.4 - fx * s * 0.3];
        vertex(tip, FLOW_COLOR);
        vertex(left, FLOW_COLOR);
        vertex(right, FLOW_COLOR);
      }
      for (const point of terrain.concentration) {
        const [gc, gr] = toGrid(terrain, point.at);
        const radius = (extent * 0.009) / cs;
        for (let i = 0; i < 12; i += 1) {
          const a0 = (i / 12) * Math.PI * 2;
          const a1 = ((i + 1) / 12) * Math.PI * 2;
          vertex([gc, gr], [1, 1, 1], lift);
          vertex([gc + Math.cos(a0) * radius, gr + Math.sin(a0) * radius], FLOW_COLOR, lift);
          vertex([gc + Math.cos(a1) * radius, gr + Math.sin(a1) * radius], FLOW_COLOR, lift);
        }
      }
    }
    ring(terrain.parcel.ring2180, extent * 0.0045, BOUNDARY_COLOR, lift);
    if (layers.retention && terrain.retentionCandidate) ring(terrain.retentionCandidate.ring, extent * 0.006, RETENTION_COLOR, lift * 2);

    this.release(this.overlay);
    this.overlay = this.upload({ aPosition: new Float32Array(pos), aColor: new Float32Array(col) }, null, pos.length / 3);

    if (!keepCamera) {
      const relief = py(terrain.elevationRange[1]);
      this.target = [0, relief * 0.4, 0];
      this.baseDistance = Math.max(halfW, halfH) * 2.6;
      this.distance = this.baseDistance;
    }
    this.requestRender();
  }

  rotate(deltaDeg: number): void {
    this.azimuth += (deltaDeg * Math.PI) / 180;
    this.requestRender();
  }

  tilt(deltaDeg: number): void {
    this.elevationAngle = Math.max((12 * Math.PI) / 180, Math.min((89 * Math.PI) / 180, this.elevationAngle + (deltaDeg * Math.PI) / 180));
    this.requestRender();
  }

  zoom(factor: number): void {
    this.distance = Math.max(this.baseDistance * 0.25, Math.min(this.baseDistance * 3, this.distance * factor));
    this.requestRender();
  }

  topView(): void {
    this.azimuth = 0;
    this.elevationAngle = (89 * Math.PI) / 180;
    this.requestRender();
  }

  reset(): void {
    this.azimuth = (20 * Math.PI) / 180;
    this.elevationAngle = (48 * Math.PI) / 180;
    this.distance = this.baseDistance;
    this.requestRender();
  }

  requestRender(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.render());
  }

  private render(): void {
    const gl = this.gl;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.953, 0.961, 0.973, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.surface) return;

    const eye = [
      this.target[0] + this.distance * Math.cos(this.elevationAngle) * Math.sin(this.azimuth),
      this.target[1] + this.distance * Math.sin(this.elevationAngle),
      this.target[2] + this.distance * Math.cos(this.elevationAngle) * Math.cos(this.azimuth),
    ];
    const up = this.elevationAngle > (85 * Math.PI) / 180 ? [-Math.sin(this.azimuth), 0, -Math.cos(this.azimuth)] : [0, 1, 0];
    const mvp = multiply(perspective((38 * Math.PI) / 180, width / height, this.distance / 200, this.distance * 10), lookAt(eye, this.target, up));

    const draw = (program: Program, mesh: Mesh, attributes: [string, number][]) => {
      gl.useProgram(program.program);
      gl.uniformMatrix4fv(program.uniforms.uMvp ?? null, false, mvp);
      for (const [name, size] of attributes) {
        const location = program.attribs[name] as number;
        if (location < 0) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffers[name] as WebGLBuffer);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
      }
      if (mesh.index) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
        gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
      } else if (mesh.count > 0) {
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      }
    };

    gl.useProgram(this.surfaceProgram.program);
    const light = [-0.45, 0.8, -0.4];
    const l = Math.hypot(...light);
    gl.uniform3f(this.surfaceProgram.uniforms.uLight ?? null, (light[0] as number) / l, (light[1] as number) / l, (light[2] as number) / l);
    draw(this.surfaceProgram, this.surface, [
      ['aPosition', 3],
      ['aNormal', 3],
      ['aColor', 3],
    ]);
    if (this.overlay) {
      draw(this.flatProgram, this.overlay, [
        ['aPosition', 3],
        ['aColor', 3],
      ]);
    }
  }

  private handleLost = (event: Event) => {
    event.preventDefault();
    this.onLost();
  };

  private handleDown = (event: PointerEvent) => {
    this.drag = { x: event.clientX, y: event.clientY };
    this.canvas.setPointerCapture(event.pointerId);
  };

  private handleMove = (event: PointerEvent) => {
    if (!this.drag) return;
    const dx = event.clientX - this.drag.x;
    const dy = event.clientY - this.drag.y;
    this.drag = { x: event.clientX, y: event.clientY };
    this.azimuth -= dx * 0.006;
    this.tilt(dy * 0.25);
  };

  private handleUp = () => {
    this.drag = null;
  };

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.zoom(event.deltaY > 0 ? 1.1 : 1 / 1.1);
  };

  private handleKey = (event: KeyboardEvent) => {
    const actions: Record<string, () => void> = {
      ArrowLeft: () => this.rotate(-10),
      ArrowRight: () => this.rotate(10),
      ArrowUp: () => this.tilt(5),
      ArrowDown: () => this.tilt(-5),
      '+': () => this.zoom(1 / 1.15),
      '=': () => this.zoom(1 / 1.15),
      '-': () => this.zoom(1.15),
    };
    const action = actions[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  };
}
