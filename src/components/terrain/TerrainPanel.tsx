import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDatePl, formatDateTimePl } from '../../lib/dates';
import { fetchNdmi, fetchTerrain } from '../../services/terrain';
import type { NdmiResult, SourceInfo, TerrainResult } from '../../types/terrain';
import { Icon } from '../Icon';
import { draw2D } from './map2d';
import { TerrainRenderer, WebGLUnavailableError } from './renderer3d';
import {
  DEPRESSION_COLOR,
  DEVIATION_COLOR,
  FLOW_COLOR,
  NDMI_LEGEND,
  NO_DATA,
  RETENTION_COLOR,
  SLOPE_COLORS,
  SLOPE_LABELS,
  autoExaggeration,
  cssColor,
  type Layers,
  type SurfaceMode,
} from './scene';

interface Props {
  parcelId: string;
  analysisDate: string;
}

type Load<T> =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; value: T }
  | { kind: 'error'; message: string; notFound?: boolean };

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

export default function TerrainPanel({ parcelId, analysisDate }: Props) {
  const [terrain, setTerrain] = useState<Load<TerrainResult>>({ kind: 'loading' });
  const [ndmi, setNdmi] = useState<Load<NdmiResult>>({ kind: 'idle' });
  const [view, setView] = useState<'3d' | '2d'>(() => (supportsWebGL() ? '3d' : '2d'));
  const [webglProblem, setWebglProblem] = useState<string | null>(() =>
    supportsWebGL() ? null : 'Ta przeglądarka nie obsługuje WebGL – pokazujemy widok 2D.',
  );
  const [mode, setMode] = useState<SurfaceMode>('elevation');
  const [layers, setLayers] = useState<Layers>({ flow: true, depressions: true, retention: true });
  const [attempt, setAttempt] = useState(0);
  const canvas3d = useRef<HTMLCanvasElement>(null);
  const canvas2d = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<TerrainRenderer | null>(null);
  const startedAt = useRef(performance.now());
  const [loadMs, setLoadMs] = useState<number | null>(null);
  // Licznik sekund oczekiwania – po 15 s mówimy wprost, że usługa GUGiK odpowiada wolniej.
  const [waitedS, setWaitedS] = useState(0);
  useEffect(() => {
    if (terrain.kind !== 'loading') return;
    setWaitedS(0);
    const started = Date.now();
    const timer = window.setInterval(() => setWaitedS(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [terrain.kind]);

  useEffect(() => {
    let cancelled = false;
    setTerrain({ kind: 'loading' });
    startedAt.current = performance.now();
    fetchTerrain(parcelId)
      .then((response) => {
        if (cancelled) return;
        setLoadMs(Math.round(performance.now() - startedAt.current));
        if (response.status === 'ok') setTerrain({ kind: 'ok', value: response.result });
        else setTerrain({ kind: 'error', message: response.message, notFound: response.status === 'not_found' });
      })
      .catch((error: unknown) => {
        if (!cancelled) setTerrain({ kind: 'error', message: error instanceof Error ? error.message : 'Nieznany błąd.' });
      });
    return () => {
      cancelled = true;
    };
  }, [parcelId, attempt]);

  const ndmiValue = ndmi.kind === 'ok' ? ndmi.value : null;
  const terrainValue = terrain.kind === 'ok' ? terrain.value : null;

  const chooseMode = useCallback(
    (next: SurfaceMode) => {
      setMode(next);
      if (next === 'ndmi' && (ndmi.kind === 'idle' || ndmi.kind === 'error')) {
        setNdmi({ kind: 'loading' });
        fetchNdmi(parcelId, analysisDate)
          .then((response) =>
            setNdmi(response.status === 'ok' ? { kind: 'ok', value: response.result } : { kind: 'error', message: response.message }),
          )
          .catch((error: unknown) => setNdmi({ kind: 'error', message: error instanceof Error ? error.message : 'Nieznany błąd.' }));
      }
    },
    [ndmi.kind, parcelId, analysisDate],
  );

  // Widok 3D.
  useEffect(() => {
    if (!terrainValue || view !== '3d' || !canvas3d.current) return;
    if (!renderer.current) {
      try {
        renderer.current = new TerrainRenderer(canvas3d.current, () => {
          setWebglProblem('Utracono kontekst WebGL – przełączyliśmy na widok 2D.');
          setView('2d');
        });
      } catch (error) {
        setWebglProblem(
          error instanceof WebGLUnavailableError ? `${error.message} Pokazujemy widok 2D.` : 'Nie udało się uruchomić widoku 3D – pokazujemy widok 2D.',
        );
        setView('2d');
        return;
      }
      renderer.current.setScene(terrainValue, ndmiValue, mode, layers);
    } else {
      renderer.current.setScene(terrainValue, ndmiValue, mode, layers, true);
    }
  }, [terrainValue, ndmiValue, mode, layers, view]);

  useEffect(
    () => () => {
      renderer.current?.dispose();
      renderer.current = null;
    },
    [],
  );

  useEffect(() => {
    if (view === '2d' && renderer.current) {
      renderer.current.dispose();
      renderer.current = null;
    }
  }, [view]);

  // Widok 2D (zawsze rysowany – służy też do wydruku).
  useEffect(() => {
    if (!terrainValue || !canvas2d.current) return;
    const canvas = canvas2d.current;
    const redraw = () => draw2D(canvas, terrainValue, ndmiValue, mode, layers);
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas.parentElement ?? canvas);
    window.addEventListener('beforeprint', redraw);
    return () => {
      observer.disconnect();
      window.removeEventListener('beforeprint', redraw);
    };
  }, [terrainValue, ndmiValue, mode, layers, view]);

  return (
    <section className="report-section terrain" aria-labelledby="sekcja-teren" id="teren-i-splyw">
      <h2 id="sekcja-teren">
        <span className="section-number" aria-hidden="true">
          <Icon name="drop" size={18} />
        </span>
        Teren i spływ
        <span className="tag">Analiza topografii</span>
      </h2>

      {terrain.kind === 'loading' && (
        <div className="status status--loading" role="status">
          <p>
            Pobieram model terenu z GUGiK i liczę spływ – zwykle kilka sekund. Kolejne otwarcia tej działki są natychmiastowe.
          </p>
          {waitedS >= 15 && (
            <p>
              Trwa to już {waitedS} s – usługa GUGiK odpowiada wolniej niż zwykle albo chwilowo ogranicza liczbę zapytań. Jeśli nie
              odpowie, aplikacja spróbuje wolniejszego, zapasowego źródła (najwyżej ok. minuty).
            </p>
          )}
        </div>
      )}

      {terrain.kind === 'error' && (
        <div className={`status ${terrain.notFound ? 'status--info' : 'status--error'}`} role="alert">
          <p>
            <strong>{terrain.notFound ? 'Nie znaleziono działki.' : 'Nie udało się przygotować analizy terenu.'}</strong> {terrain.message}
          </p>
          {!terrain.notFound && (
            <button type="button" className="btn btn--small btn--secondary" onClick={() => setAttempt((n) => n + 1)}>
              Spróbuj ponownie
            </button>
          )}
        </div>
      )}

      {terrainValue && (
        <>
          <OriginNote terrain={terrainValue} />

          <div className="terrain-toolbar no-print">
            <div className="segmented" role="group" aria-label="Widok">
              <button type="button" aria-pressed={view === '3d'} onClick={() => setView('3d')} disabled={Boolean(webglProblem) && !supportsWebGL()}>
                3D
              </button>
              <button type="button" aria-pressed={view === '2d'} onClick={() => setView('2d')}>
                2D
              </button>
            </div>
            <div className="segmented" role="group" aria-label="Kolor powierzchni">
              <button type="button" aria-pressed={mode === 'elevation'} onClick={() => chooseMode('elevation')}>
                Wysokość
              </button>
              <button type="button" aria-pressed={mode === 'ndmi'} onClick={() => chooseMode('ndmi')}>
                NDMI
              </button>
              <button type="button" aria-pressed={mode === 'erosion'} onClick={() => chooseMode('erosion')}>
                Podatność na erozję
              </button>
            </div>
            <fieldset className="terrain-layers">
              <legend className="visually-hidden">Warstwy</legend>
              <label>
                <input type="checkbox" checked={layers.flow} onChange={() => setLayers({ ...layers, flow: !layers.flow })} /> Spływ
              </label>
              <label>
                <input type="checkbox" checked={layers.depressions} onChange={() => setLayers({ ...layers, depressions: !layers.depressions })} />{' '}
                Zastoiska
              </label>
              <label>
                <input type="checkbox" checked={layers.retention} onChange={() => setLayers({ ...layers, retention: !layers.retention })} />{' '}
                Obszar do sprawdzenia
              </label>
            </fieldset>
          </div>

          {webglProblem && <p className="map-notice no-print">{webglProblem}</p>}

          <div className="terrain-layout">
            <div className="terrain-viewer">
              {view === '3d' && (
                <div className="terrain-3d no-print">
                  <canvas
                    ref={canvas3d}
                    className="terrain-canvas"
                    tabIndex={0}
                    aria-label={`Model 3D terenu działki ${terrainValue.parcelId} z liniami spływu. Strzałki obracają widok, plus i minus przybliżają.`}
                  />
                  <div className="terrain-3d__controls">
                    <button type="button" className="icon-button" onClick={() => renderer.current?.rotate(-20)} aria-label="Obróć w lewo">
                      ↺
                    </button>
                    <button type="button" className="icon-button" onClick={() => renderer.current?.rotate(20)} aria-label="Obróć w prawo">
                      ↻
                    </button>
                    <button type="button" className="icon-button" onClick={() => renderer.current?.zoom(1 / 1.2)} aria-label="Przybliż">
                      +
                    </button>
                    <button type="button" className="icon-button" onClick={() => renderer.current?.zoom(1.2)} aria-label="Oddal">
                      −
                    </button>
                    <button type="button" className="btn btn--small btn--ghost" onClick={() => renderer.current?.topView()}>
                      Z góry
                    </button>
                    <button type="button" className="btn btn--small btn--ghost" onClick={() => renderer.current?.reset()}>
                      Reset
                    </button>
                  </div>
                  <p className="terrain-3d__hint">
                    Przeciągnij, aby obrócić; kółko myszy przybliża. Przewyższenie terenu ×{autoExaggeration(terrainValue)}. Północ – w
                    głąb ekranu przy widoku startowym.
                  </p>
                </div>
              )}
              <div className={`terrain-2d${view === '3d' ? ' terrain-2d--print-only' : ''}`}>
                <canvas ref={canvas2d} className="terrain-canvas terrain-canvas--2d" role="img" aria-label={`Mapa 2D terenu działki ${terrainValue.parcelId} z liniami spływu`} />
                <p className="terrain-3d__hint">Widok z góry; północ u góry.</p>
              </div>
            </div>

            <aside className="terrain-side">
              <Legend terrain={terrainValue} mode={mode} layers={layers} />
              {mode === 'ndmi' && <NdmiInfo state={ndmi} />}
              {mode === 'erosion' && <ErosionInfo terrain={terrainValue} />}
            </aside>
          </div>

          <RetentionCard terrain={terrainValue} />

          {terrainValue.inflowBeyondRaster.affectsParcel && (
            <p className="status status--info">
              <strong>Obszar dopływu wychodzi poza pobrany raster.</strong> {terrainValue.inflowBeyondRaster.note}
            </p>
          )}

          <SummaryFacts terrain={terrainValue} />

          <details className="terrain-details">
            <summary>Źródła, czas ładowania i ograniczenia analizy terenu</summary>
            <SourcesTable sources={[...terrainValue.sources, ...(ndmiValue?.sources ?? [])]} />
            <h4>Czas przygotowania</h4>
            <ul className="limitations">
              {terrainValue.timings.map((t) => (
                <li key={t.label}>
                  {t.label}: {formatMs(t.ms)}
                </li>
              ))}
              {ndmiValue?.timings.map((t) => (
                <li key={`ndmi-${t.label}`}>
                  {t.label}: {formatMs(t.ms)}
                </li>
              ))}
              {loadMs !== null && <li>Łącznie w przeglądarce (z przesłaniem danych): {formatMs(loadMs)}</li>}
            </ul>
            <h4>Metoda</h4>
            <p className="small">{terrainValue.method}</p>
            <h4>Ograniczenia</h4>
            <ul className="limitations">
              {terrainValue.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
              {mode === 'ndmi' && ndmiValue?.limitations.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} s`;
}

function OriginNote({ terrain }: { terrain: TerrainResult }) {
  if (terrain.origin === 'demo') {
    return (
      <p className="data-note data-note--demo">
        <Icon name="info" size={18} />
        <span>
          <strong>Dane demonstracyjne.</strong> Teren tej działki jest syntetyczny (tryb demo) – nie pochodzi z NMT Geoportalu.
        </span>
      </p>
    );
  }
  // Dla danych rzeczywistych źródła są w zakładce „Źródła danych” – bez osobnej ramki tutaj.
  return null;
}

function Swatch({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <li>
      <span className={`swatch${line ? ' swatch--line' : ''}`} style={{ background: color }} aria-hidden="true" />
      {label}
    </li>
  );
}

function Legend({ terrain, mode, layers }: { terrain: TerrainResult; mode: SurfaceMode; layers: Layers }) {
  return (
    <div className="terrain-legend">
      <h3>Legenda</h3>
      {mode === 'elevation' && (
        <p className="small">
          Wysokość: {terrain.elevationRange[0].toLocaleString('pl-PL', { maximumFractionDigits: 1 })} –{' '}
          {terrain.elevationRange[1].toLocaleString('pl-PL', { maximumFractionDigits: 1 })} m n.p.m.
        </p>
      )}
      {mode === 'ndmi' && (
        <>
          <div
            className="gradient-bar"
            style={{ background: `linear-gradient(90deg, ${NDMI_LEGEND.map((s) => cssColor(s.color)).join(', ')})` }}
            aria-hidden="true"
          />
          <p className="gradient-labels small">
            <span>suszej (−0,3)</span>
            <span>wilgotniej (0,45)</span>
          </p>
        </>
      )}
      {mode === 'erosion' && (
        <ul className="legend-list">
          {SLOPE_LABELS.map((label, i) => (
            <Swatch key={label} color={cssColor(SLOPE_COLORS[i] ?? NO_DATA)} label={`Nachylenie ${label}`} />
          ))}
        </ul>
      )}
      <ul className="legend-list">
        <Swatch color={cssColor([0.07, 0.19, 0.31])} label="Granica działki" line />
        {layers.flow && <Swatch color={cssColor(FLOW_COLOR)} label="Linie spływu – grubsza = większa koncentracja" line />}
        {layers.flow && <Swatch color="#ffffff" label="Miejsca koncentracji spływu (kółka)" />}
        {layers.depressions && <Swatch color={cssColor(DEPRESSION_COLOR)} label="Potencjalne zastoiska" />}
        {layers.retention && terrain.retentionCandidate && <Swatch color={cssColor(RETENTION_COLOR)} label="Obszar do sprawdzenia (retencja)" line />}
        {mode === 'ndmi' && <Swatch color={cssColor(DEVIATION_COLOR)} label="NDMI odbiega od reszty działki" />}
        {mode === 'ndmi' && <Swatch color={cssColor(NO_DATA)} label="Brak obserwacji lub maska chmur" />}
      </ul>
    </div>
  );
}

function NdmiInfo({ state }: { state: Load<NdmiResult> }) {
  if (state.kind === 'loading' || state.kind === 'idle') {
    return (
      <p className="status status--loading" role="status">
        Szukam scen Sentinel-2 z daty analizy lub wcześniejszych i maskuję chmury…
      </p>
    );
  }
  // Błąd pobierania Sentinel-2 nie przeszkadza w analizie terenu – nie pokazujemy komunikatu.
  if (state.kind === 'error') return null;
  const result = state.value;
  return (
    <div className="ndmi-info" role="status">
      <h3>NDMI – wilgotność roślin</h3>
      {result.origin === 'demo' && <p className="tag">Dane demonstracyjne</p>}
      <dl className="meta-list">
        <div>
          <dt>Scena</dt>
          <dd>{result.scene ? formatDatePl(result.scene.date) : 'brak'}</dd>
        </div>
        <div>
          <dt>Pokrycie działki</dt>
          <dd>{result.scene ? `${Math.round(result.scene.usefulCoveragePct)}% użytecznych pikseli` : '—'}</dd>
        </div>
        <div>
          <dt>Rozdzielczość</dt>
          <dd>{result.resolutionM} m (Sentinel-2 B8A i B11)</dd>
        </div>
        {result.stats && (
          <div>
            <dt>Mediana w działce</dt>
            <dd>
              {result.stats.median.toLocaleString('pl-PL')} (10–90%: {result.stats.p10.toLocaleString('pl-PL')} –{' '}
              {result.stats.p90.toLocaleString('pl-PL')})
            </dd>
          </div>
        )}
      </dl>
      <p className={result.scene ? 'small' : 'status status--info'}>{result.message}</p>
      {!result.scene && <p className="small">Analiza terenu działa bez obserwacji satelitarnej.</p>}
      <p className="small muted">
        Odchylenia NDMI to miejsca do sprawdzenia w terenie. Przyczynę (np. niedobór wody, zalewanie, choroba, gleba) można
        ocenić dopiero na podstawie dodatkowych danych.
      </p>
      {result.checkedScenes.length > 0 && (
        <details>
          <summary>Sprawdzone sceny ({result.checkedScenes.length})</summary>
          <ul className="limitations">
            {result.checkedScenes.map((s) => (
              <li key={s.id}>
                {formatDatePl(s.date)} – {Math.round(s.usefulCoveragePct)}% działki bez chmur
                {s.cloudCoverPct !== null ? ` (zachmurzenie sceny ${Math.round(s.cloudCoverPct)}%)` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ErosionInfo({ terrain }: { terrain: TerrainResult }) {
  const e = terrain.erosion;
  return (
    <div className="ndmi-info">
      <h3>Podatność na erozję</h3>
      <p className="small">{e.basis}</p>
      <dl className="meta-list">
        <div>
          <dt>Średnie nachylenie</dt>
          <dd>{e.parcelSlopeMeanDeg.toLocaleString('pl-PL')}°</dd>
        </div>
        <div>
          <dt>Największe nachylenie</dt>
          <dd>{e.parcelSlopeMaxDeg.toLocaleString('pl-PL')}°</dd>
        </div>
      </dl>
      <ul className="legend-list">
        {SLOPE_LABELS.map((label, i) => (
          <li key={label}>
            {label}: {(e.parcelClassPct[i] ?? 0).toLocaleString('pl-PL')}% działki
          </li>
        ))}
      </ul>
    </div>
  );
}

function RetentionCard({ terrain }: { terrain: TerrainResult }) {
  const candidate = terrain.retentionCandidate;
  return (
    <div className="retention-card">
      <div className="retention-card__head">
        <span className="retention-card__icon" aria-hidden="true">
          <Icon name="pin" />
        </span>
        <div>
          <p className="eyebrow">Obszar do sprawdzenia pod kątem retencji</p>
          <h3>{candidate ? candidate.title : 'Nie wskazujemy obszaru'}</h3>
        </div>
      </div>
      {candidate ? (
        <div className="retention-card__body">
          <ul className="retention-card__reasons">
            {candidate.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <dl className="meta-list">
            {candidate.metrics.map((m) => (
              <div key={m.label}>
                <dt>{m.label}</dt>
                <dd>{m.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <p>Na działce nie ma wyraźnego zagłębienia ani skupionego spływu – analiza topografii nie wskazuje miejsca do zatrzymania wody.</p>
      )}
      <p className="small muted">
        Wskazanie wynika wyłącznie z ukształtowania terenu. To miejsce do oględzin, a nie gotowe zalecenie budowy.
      </p>
    </div>
  );
}

function SummaryFacts({ terrain }: { terrain: TerrainResult }) {
  const outlets = terrain.concentration.filter((c) => c.kind === 'outlet');
  const inside = terrain.depressions.filter((d) => d.insideParcel);
  return (
    <ul className="terrain-facts">
      <li>
        <span className="terrain-facts__value">{terrain.flowLines.length}</span>
        <span>linii spływu w analizowanym obszarze</span>
      </li>
      <li>
        <span className="terrain-facts__value">{outlets.length}</span>
        <span>miejsc, w których skupiony spływ opuszcza działkę</span>
      </li>
      <li>
        <span className="terrain-facts__value">{inside.length}</span>
        <span>potencjalnych zastoisk w działce</span>
      </li>
      <li>
        <span className="terrain-facts__value">{terrain.erosion.parcelSlopeMeanDeg.toLocaleString('pl-PL')}°</span>
        <span>średnie nachylenie działki</span>
      </li>
    </ul>
  );
}

function SourcesTable({ sources }: { sources: SourceInfo[] }) {
  return (
    <div className="table-wrap">
      <table className="sources-table">
        <caption className="visually-hidden">Źródła danych analizy terenu</caption>
        <thead>
          <tr>
            <th scope="col">Dane</th>
            <th scope="col">Pochodzenie</th>
            <th scope="col">Data obserwacji</th>
            <th scope="col">Pobrano</th>
            <th scope="col">Rozdzielczość</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={`${s.name}-${s.provider}`}>
              <th scope="row">
                {s.name}
                <br />
                <span className="muted small">{s.provider}</span>
                {s.notes.length > 0 && (
                  <ul className="limitations small">
                    {s.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
              </th>
              <td>{s.origin === 'demo' ? 'Dane demonstracyjne' : 'Dane obserwowane'}</td>
              <td>{s.observationDate ? formatDatePl(s.observationDate) : '—'}</td>
              <td>{s.retrievedAt ? formatDateTimePl(s.retrievedAt) : '—'}</td>
              <td>{s.resolutionM ? `${s.resolutionM} m` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
