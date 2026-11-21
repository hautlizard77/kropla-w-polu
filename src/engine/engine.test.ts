import { describe, expect, it } from 'vitest';
import { observationsUpTo } from './observations';
import { comparePh } from './ph';
import {
  classifyDepletion,
  classifyRange,
  readilyAvailableWater,
  runDepletion,
  stressCoefficient,
  totalAvailableWater,
  type SoilLayer,
} from './waterBalance';

const uniformSoil: SoilLayer[] = [{ topCm: 0, bottomCm: 150, thetaFc: 0.25, thetaWp: 0.13 }];

describe('bilans wody – przykład kontrolny ze specyfikacji', () => {
  it('ziemniak: Zr 0,5 m, p 0,35 → TAW 60 mm, RAW 21 mm', () => {
    const taw = totalAvailableWater(uniformSoil, 0.5);
    expect(taw.tawMm).toBe(60);
    expect(readilyAvailableWater(60, 0.35)).toBe(21);
  });

  it('kukurydza: Zr 1,2 m, p 0,55 → TAW 144 mm, RAW 79,2 mm', () => {
    const taw = totalAvailableWater(uniformSoil, 1.2);
    expect(taw.tawMm).toBe(144);
    expect(readilyAvailableWater(144, 0.55)).toBe(79.2);
  });

  it('przy Dr 45 mm ziemniak jest w stresie, a kukurydza nie', () => {
    expect(classifyDepletion(45, 21)).toBe('stress');
    expect(classifyDepletion(45, 79.2)).toBe('no_stress');
    expect(stressCoefficient(45, 60, 21)).toBeLessThan(1);
    expect(stressCoefficient(45, 144, 79.2)).toBe(1);
  });
});

describe('TAW w profilu warstwowym', () => {
  it('sumuje wkłady warstw w zasięgu korzeni, a warstwę przeciętą liczy proporcjonalnie', () => {
    const layers: SoilLayer[] = [
      { topCm: 0, bottomCm: 30, thetaFc: 0.3, thetaWp: 0.15 }, // 0,15 · 300 mm = 45 mm
      { topCm: 30, bottomCm: 100, thetaFc: 0.2, thetaWp: 0.1 }, // do 60 cm: 0,1 · 300 mm = 30 mm
    ];
    const result = totalAvailableWater(layers, 0.6);
    expect(result.tawMm).toBe(75);
    expect(result.contributions).toHaveLength(2);
  });

  it('zwraca null, gdy brakuje θ dla warstwy w zasięgu korzeni', () => {
    const result = totalAvailableWater([{ topCm: 0, bottomCm: 100, thetaFc: null, thetaWp: 0.1 }], 0.5);
    expect(result.tawMm).toBeNull();
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('zwraca null, gdy dane o glebie nie sięgają głębokości korzeni', () => {
    const result = totalAvailableWater([{ topCm: 0, bottomCm: 40, thetaFc: 0.25, thetaWp: 0.13 }], 1.0);
    expect(result.tawMm).toBeNull();
  });
});

describe('dzienny bilans ubytku Dr', () => {
  it('ubytek rośnie o ETc i maleje o opad, w granicach [0, TAW]', () => {
    const run = runDepletion({
      initialDepletionMm: 10,
      tawMm: 60,
      kcForDate: () => 1.0,
      days: [
        { date: '2024-06-01', precipitationMm: 0, et0Mm: 5 }, // 15
        { date: '2024-06-02', precipitationMm: 30, et0Mm: 4 }, // 15 − 30 + 4 = −11 → 0, DP 11
        { date: '2024-06-03', precipitationMm: 0, et0Mm: 6 }, // 6
      ],
    });
    expect(run.steps.map((s) => s.drMm)).toEqual([15, 0, 6]);
    expect(run.steps[1]?.deepPercolationMm).toBe(11);
    expect(run.finalDrMm).toBe(6);
  });

  it('zatrzymuje się na brakującym dniu zamiast wstawiać zero', () => {
    const run = runDepletion({
      initialDepletionMm: 0,
      tawMm: 60,
      kcForDate: () => 1.0,
      days: [
        { date: '2024-06-01', precipitationMm: 0, et0Mm: 5 },
        { date: '2024-06-02', precipitationMm: null, et0Mm: 5 },
        { date: '2024-06-03', precipitationMm: 0, et0Mm: 5 },
      ],
    });
    expect(run.finalDrMm).toBe(5);
    expect(run.lastCompleteDate).toBe('2024-06-01');
    expect(run.missingDates).toEqual(['2024-06-02']);
  });

  it('zakres przecinający próg daje wynik niejednoznaczny', () => {
    expect(classifyRange({ min: 15, max: 30 }, { min: 21, max: 21 })).toBe('ambiguous');
    expect(classifyRange({ min: 25, max: 30 }, { min: 21, max: 21 })).toBe('stress');
    expect(classifyRange({ min: 5, max: 20 }, { min: 21, max: 21 })).toBe('no_stress');
  });
});

describe('pH – porównujemy tylko zgodne metody', () => {
  it('KCl i H₂O → brak porównywalnych danych', () => {
    const result = comparePh({ value: 5.2, method: 'KCl' }, { min: 6.0, max: 7.0, method: 'H2O' });
    expect(result.kind).toBe('no_comparable_data');
    expect(result.message).toContain('Brak porównywalnych danych');
  });

  it('nieznana metoda działki → brak porównywalnych danych', () => {
    expect(comparePh({ value: 6.5, method: null }, { min: 6, max: 7, method: 'KCl' }).kind).toBe('no_comparable_data');
  });

  it('zakres uprawy bez metody → tylko informacja opisowa', () => {
    expect(comparePh({ value: 6.5, method: 'KCl' }, { min: 5.5, max: 7.5, method: 'unspecified' }).kind).toBe('descriptive_only');
  });

  it('ta sama metoda → porównanie liczbowe', () => {
    expect(comparePh({ value: 5.0, method: 'KCl' }, { min: 5.5, max: 7.0, method: 'KCl' }).kind).toBe('below');
    expect(comparePh({ value: 6.0, method: 'KCl' }, { min: 5.5, max: 7.0, method: 'KCl' }).kind).toBe('in_range');
  });

  it('brak pomiaru → brak danych, a nie domyślna ocena', () => {
    expect(comparePh({ value: null, method: 'KCl' }, { min: 5.5, max: 7.0, method: 'KCl' }).kind).toBe('no_data');
  });
});

describe('obserwacje po dacie analizy', () => {
  it('pomija obserwacje późniejsze niż data analizy i zwraca datę ostatniej dostępnej', () => {
    const result = observationsUpTo(
      [
        { date: '2019-06-27', value: 3 },
        { date: '2019-06-24', value: 1 },
        { date: '2019-06-26', value: 2 },
      ],
      '2019-06-26',
    );
    expect(result.kept.map((o) => o.date)).toEqual(['2019-06-24', '2019-06-26']);
    expect(result.excludedAfterCount).toBe(1);
    expect(result.lastObservationDate).toBe('2019-06-26');
  });

  it('gdy dzisiejszych danych jeszcze nie ma, ostatnią datą jest dzień wcześniejszy', () => {
    const result = observationsUpTo([{ date: '2026-11-20', value: 1 }], '2026-11-21');
    expect(result.lastObservationDate).toBe('2026-11-20');
  });
});
