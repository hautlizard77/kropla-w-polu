/**
 * Walidacja na rzeczywistych działkach – odtworzenie offline z zapisanych odpowiedzi usług.
 *
 *   npx tsx validation/run.ts            # przelicza przypadki, zapisuje validation/results.json i docs/walidacja.md
 *
 * Dane wejściowe (pogoda, gleba, NMT, NDMI, granice) pochodzą z prawdziwych usług – zostały pobrane 22.11.2026 przez
 * serwer aplikacji i zapisane w validation/cache/. Cieki: odpowiedzi MPHP10 w validation/mphp.json. Sieć jest
 * w tym skrypcie wyłączona, więc wynik jest powtarzalny i nie zużywa limitów API.
 * Kontekst regionalny: System Monitoringu Suszy Rolniczej IUNG-PIB (tabele dla gmin, susza.iung.pulawy.pl) – dane
 * dla gminy i kategorii gleby, a nie dla działki, więc nie są walidacją, tylko tłem.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { JURY_PARCELS } from '../src/data/juryParcels';

const root = join(import.meta.dirname, '..');
const work = mkdtempSync(join(tmpdir(), 'kropla-walidacja-'));
cpSync(join(root, 'validation', 'cache'), work, { recursive: true });
process.env.KROPLA_CACHE_DIR = work;

const mphp = JSON.parse(readFileSync(join(root, 'validation', 'mphp.json'), 'utf8')) as Partial<Record<string, string[][][]>>;
const RINGS = [50, 100, 300];

const { analysis } = await import('../server/api');
const { lookupParcel } = await import('../server/sources/uldk');
const { cropLabel } = await import('../src/data/crops');
const { formatDatePl } = await import('../src/lib/dates');

// Prostokąty działek – do rozpoznania pierścienia w zapytaniu MPHP.
const bounds = new Map<string, number[]>();

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.host === 'wody.isok.gov.pl') {
    const bbox = (url.searchParams.get('BBOX') ?? '').split(',').map(Number);
    for (const [id, b] of bounds) {
      const ring = RINGS.findIndex((r) => b.every((value, i) => value + (i < 2 ? -r : r) === bbox[i]));
      const saved = mphp[id]?.[ring];
      if (saved) {
        const features = saved.map(([n, c, t, w, cid], i) => ({
          properties: { Nazwarzeki: n, Charakterodcinkacieku: c, Typodcinkacieku: t, Szerokośćodcinkaciekum: w, Identyfikatorhydrograficznycieku: cid, ObjectID: String(i) },
        }));
        return new Response(JSON.stringify({ type: 'FeatureCollection', features }), { headers: { 'content-type': 'application/json' } });
      }
    }
  }
  throw new Error('nie odpytywano – odtworzenie z zapisanych danych');
}) as typeof fetch;

interface Iung {
  period: string;
  status: string;
  sharePct: number | null;
  url: string;
}

const IUNG_BY_PARCEL: Partial<Record<string, Iung>> = {
  '220907_4.0007.1/1': {
    period: '21 IV–20 VI 2024 (okres 4)', status: 'zagrożenie suszą (zboża ozime, kat. gleby I–II)',
    sharePct: 3.35, url: 'https://susza.iung.pulawy.pl/wykazy/2024,2209073/',
  },
  '022305_2.0012.16': {
    period: '1 V–30 VI 2024 (okres 5)', status: 'zagrożenie suszą (zboża ozime, kat. gleby I–II)',
    sharePct: 2.01, url: 'https://susza.iung.pulawy.pl/wykazy/2024,0223052/',
  },
  '060408_2.0167.696/1': {
    period: '21 IV–20 VI 2024 (okres 4)', status: 'zagrożenie suszą (zboża ozime, kat. gleby I)',
    sharePct: 0.37, url: 'https://susza.iung.pulawy.pl/wykazy/2024,0604082/',
  },
};

const CASES = JURY_PARCELS.map(({ commune, voivodeship, request }) => ({
  parcelId: request.parcelId,
  gmina: `${commune}, woj. ${voivodeship}`,
  cropId: request.cropId,
  date: request.analysisDate,
  cropNote: 'uprawa przyjęta',
  iung: IUNG_BY_PARCEL[request.parcelId],
}));

/** Przypadek do raportu PDF dla jury: grunt orny wg WorldCover, bilans i NDMI porównywalne, miejsce retencji z NMT. */
const PDF_CASE = '142504_2.0018.127';

const LC_VERDICT: Record<string, string> = { arable: 'grunt orny', grassland: 'łąka / pastwisko', mixed: 'częściowo rolna', non_agricultural: 'nierolnicza', unknown: 'nieokreślone' };

const LEVEL: Record<string, string> = { low: 'niskie', moderate: 'umiarkowane', elevated: 'podwyższone', insufficient_data: 'za mało danych' };
const VERDICT: Record<string, string> = { ok: 'rośliny dobrze uwodnione', watch: 'uwodnienie słabsze', stress: 'wyraźny niedobór' };
const REASON: Record<string, string> = { unavailable: 'zdjęcie niepobrane', no_scene: 'brak sceny', low_coverage: 'działka zasłonięta chmurami', stale: 'scena za stara', phase: 'faza nie pozwala porównać' };

const rows = [];
for (const c of CASES) {
  const lookup = await lookupParcel(c.parcelId);
  if (lookup.status === 'ok') {
    const xs = lookup.parcel.ring2180.map((p) => p[0]);
    const ys = lookup.parcel.ring2180.map((p) => p[1]);
    bounds.set(c.parcelId, [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)), Math.round(Math.max(...xs)), Math.round(Math.max(...ys))]);
  }
  const outcome = await analysis(c.parcelId, c.cropId, c.date);
  if (outcome.status !== 'ok') {
    rows.push({ ...c, error: 'message' in outcome ? outcome.message : outcome.status });
    continue;
  }
  const r = outcome.result;
  const s = r.satellite;
  const balanceLevel = r.currentState.level;
  // Wskaźnik „zapas” jest w mm (wartość) z pełnym zapasem TAW w odniesieniu – procent liczymy z obu.
  const zapas = r.currentState.indicators.find((i) => i.id === 'zapas');
  const reserveMm = typeof zapas?.value === 'number' ? zapas.value : null;
  const tawMm = typeof zapas?.reference?.value === 'number' ? zapas.reference.value : null;
  const reserve = reserveMm !== null && tawMm ? `zapas ${reserveMm} mm z ${tawMm} mm, ${Math.round((100 * reserveMm) / tawMm)}%` : null;
  const pl2 = (v: number | null | undefined) => (v ?? 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ndmiText = !s ? '—' : s.verdict ? `NDMI ${pl2(s.ndmiMedian)} (scena ${formatDatePl(s.sceneDate!)}, pokrycie ${s.coveragePct}%) – ${VERDICT[s.verdict]}` : `brak podstaw do porównania – ${REASON[s.reason ?? 'unavailable']}${s.coveragePct !== null ? ` (najlepsze pokrycie ${s.coveragePct}%)` : ''}${s.sceneDate ? ` (scena ${formatDatePl(s.sceneDate)}, NDMI ${pl2(s.ndmiMedian)})` : ''}`;
  // Kontekst IUNG: zgodny kierunek = bilans „niskie” przy braku zagrożenia w gminie albo „umiarkowane/podwyższone” przy zagrożeniu.
  const iungDry = c.iung ? (c.iung.sharePct ?? 0) > 0 : null;
  const modelDry = balanceLevel === 'moderate' || balanceLevel === 'elevated';
  const context = iungDry === null ? 'brak danych IUNG dla tego roku' : iungDry === modelDry ? 'kierunek zgodny z kontekstem gminy' : 'kierunek różny od kontekstu gminy';
  const satellite = s?.comparison === 'agree' ? 'Satelita potwierdza bilans' : s?.comparison === 'partial' ? 'Satelita różni się od bilansu o 1 stopień' : s?.comparison === 'diverge' ? 'Satelita i bilans się rozchodzą – „Sprawdź stan roślin na polu”' : 'Satelita bez porównania';
  rows.push({
    parcelId: c.parcelId,
    gmina: c.gmina,
    crop: cropLabel(r.request.cropId),
    dateText: formatDatePl(c.date),
    cropNote: c.cropNote,
    date: c.date,
    balance: `${LEVEL[balanceLevel]}${reserve !== null ? ` (${reserve})` : ''}`,
    balanceLevel,
    ndmi: ndmiText,
    comparison: s?.comparison ?? null,
    landCover: r.landCover ? `${LC_VERDICT[r.landCover.verdict]}: ${r.landCover.classes.slice(0, 2).map((c) => `${c.label} ${String(c.pct).replace('.', ',')}%`).join(', ')}` : 'brak danych',
    landVerdict: r.landCover?.verdict ?? 'unknown',
    ndmiDrier: s?.verdict ? ['ok', 'watch', 'stress'].indexOf(s.verdict) > ['low', 'moderate', 'elevated'].indexOf(balanceLevel) : null,
    soil: `${r.historicalVulnerability.summary.split('(')[0]!.trim()} | ${r.dataSources.find((d) => d.id === 'gleba')?.details ?? ''}`,
    reference: c.iung ? `IUNG SMSR, ${c.iung.period}: ${c.iung.status}${c.iung.sharePct !== null ? `, ${String(c.iung.sharePct).replace('.', ',')}% pow. gminy` : ''}` : 'IUNG SMSR: archiwum gmin od 2020 r. – brak',
    iungUrl: c.iung?.url ?? null,
    conclusion: `**Niezwalidowany** (brak niezależnego pomiaru na działce). ${satellite}; ${context}.${r.landCover?.notice ? ` Pokrycie terenu: ${r.landCover.notice.title.toLowerCase()} – ${r.landCover.notice.severity === 'warning' ? 'ocena dla przyjętej uprawy nie ma tu zastosowania' : 'przyjęta uprawa prawdopodobnie inna'}.` : ''}`,
    validated: false,
    sources: r.dataSources.map((d) => `${d.id}:${d.availability}`).join(' '),
    result: r,
  });
}

writeFileSync(join(root, 'validation', 'results.json'), JSON.stringify(rows.map(({ result, ...row }) => row), null, 1));
// Pełny wynik pierwszego przypadku z miejscem retencji – do raportu PDF.
const forPdf = rows.find((row) => row.parcelId === PDF_CASE && 'result' in row);
if (forPdf && 'result' in forPdf) writeFileSync(join(root, 'validation', 'pdf-case.json'), JSON.stringify({ status: 'ok', result: forPdf.result }));

const md = [
  '# Walidacja na rzeczywistych działkach',
  '',
  'Cztery działki dla jury z czterech województw. W aplikacji otwórz listę „Przykłady dla jury”, wybierz działkę i kliknij „Sprawdź sytuację wodną”.',
  '',
  'Wygenerowano: `npx tsx validation/run.ts` (offline, z danych w `validation/cache/` pobranych 22.11.2026 z usług: ULDK, Open-Meteo/NASA POWER, SoilGrids, GUGiK NMT, Sentinel-2 L2A, ESA WorldCover; dostępne odpowiedzi o ciekach – MPHP10 Wód Polskich).',
  '',
  '**Status: żaden przypadek nie jest zwalidowany.** Dla tych działek nie ma niezależnego pomiaru (wilgotność gleby w polu, plon, obserwacja rolnika). Dane IUNG (SMSR) opisują gminę i kategorię gleby, a nie działkę – są kontekstem regionalnym, nie punktem odniesienia. Uprawy są przyjęte, bo nie znamy faktycznych zasiewów; pokrycie terenu z ESA WorldCover 2021 (odczyt 22.11.2026) pokazuje, czy działka w ogóle jest polem.',
  '',
  '| # | Działka (gmina) | Uprawa, data | Pokrycie terenu (ESA WorldCover 2021) | Wynik bilansu (klasa ryzyka) | Wynik NDMI (Sentinel-2) | Kontekst regionalny (IUNG) | Wniosek |',
  '|---|---|---|---|---|---|---|---|',
  ...rows.map((row, i) =>
    'error' in row
      ? `| ${i + 1} | ${row.parcelId} | ${row.cropId}, ${row.date} | — | błąd: ${row.error} | — | — | — |`
      : `| ${i + 1} | ${row.parcelId} (${row.gmina}) | ${row.crop} (${row.cropNote}), ${row.dateText} | ${row.landCover} | ${row.balance} | ${row.ndmi} | ${row.iungUrl ? `[${row.reference}](${row.iungUrl})` : row.reference} | ${row.conclusion} |`,
  ),
  '',
  ...summary(),
  '',
  'Jak czytać: klasę ryzyka wyznacza bilans wody (FAO-56). NDMI jest osobnym sygnałem – „potwierdza” oznacza tę samą klasę, „różni się o 1 stopień” mieści się w dokładności obu metod, „rozchodzą się” oznacza różnicę o dwie klasy i komunikat „Sprawdź stan roślin na polu”. Kierunek względem IUNG porównuje tylko „jest / nie ma niedoboru”, bo IUNG ocenia klimatyczny bilans wodny dla gminy, nie zapas wody w glebie działki.',
  '',
  'Co byłoby walidacją: pomiar wilgotności gleby (np. sonda TDR na 10–30 cm) albo plon z działki w tym samym terminie; punkty pomiarowe IUNG („Monitoring wilgotności gleby”) – gdy któryś leży w pobliżu działki o tej samej kategorii gleby.',
  '',
];
writeFileSync(join(root, 'docs', 'walidacja.md'), md.join('\n'));

function summary(): string[] {
  type Row = { balanceLevel: string; comparison: string | null; conclusion: string; ndmiDrier: boolean | null; soil: string; landVerdict: string };
  const ok = rows.filter((row) => !('error' in row)) as Row[];
  const arable = ok.filter((row) => row.landVerdict === 'arable');
  const arableComparable = arable.filter((row) => row.comparison !== null);
  const arablePartialOrAgree = arableComparable.filter((row) => row.comparison !== 'diverge').length;
  const iungMismatch = ok.filter((row) => row.conclusion.includes('różny od kontekstu')).length;
  const iungKnown = ok.filter((row) => !row.conclusion.includes('brak danych IUNG')).length;
  const light = ok.filter((row) => /^Gleba lekka/.test(row.soil)).length;
  return [
    '## Wnioski',
    '',
    `- ESA WorldCover (2021) klasyfikuje ${arable.length} z ${ok.length} działek jako grunt orny.`,
    `- Na gruntach ornych dało się porównać bilans z Sentinel-2 w ${arableComparable.length} z ${arable.length} przypadków. W ${arablePartialOrAgree} z ${arableComparable.length} porównań oceny różnią się najwyżej o jeden stopień.`,
    `- Kierunek bilansu różni się od kontekstu IUNG w ${iungMismatch} z ${iungKnown} przypadków z danymi IUNG. SoilGrids wskazuje glebę lekką na ${light} z ${ok.length} działek.`,
    '- Konsekwencja w kodzie: klasę wyznacza bilans; NDMI i pokrycie terenu są osobnymi sygnałami z poleceniem sprawdzenia w terenie. Do kalibracji potrzebne są pomiary wilgotności gleby na działkach i znajomość faktycznej uprawy.',
  ];
}
writeFileSync(join(root, 'validation', 'used-files.txt'), [...(await import('../server/cache')).cacheReads].map((f) => relative(work, f).split(sep).join('/')).sort().join('\n'));
console.log(rows.map((row) => ('error' in row ? `${row.parcelId}: BŁĄD ${row.error}` : `${row.parcelId} ${row.date}: ${row.balance} | ${row.ndmi} | ${row.sources}`)).join('\n'));
if (rows.some((row) => 'error' in row || row.balanceLevel === 'insufficient_data')) process.exitCode = 1;
