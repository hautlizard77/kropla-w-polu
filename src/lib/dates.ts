import type { IsoDate } from '../types/analysis';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Dzisiejsza data kalendarzowa w Polsce (Europe/Warsaw), niezależnie od strefy komputera. */
export function todayInPoland(now: Date = new Date()): IsoDate {
  // en-CA daje format YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function parse(value: string): DateParts | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function format({ year, month, day }: DateParts): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isValidIsoDate(value: string): value is IsoDate {
  return parse(value) !== null;
}

/** Ta sama data kalendarzowa N lat wcześniej (29 lutego → 28 lutego). */
export function minusYears(date: IsoDate, years: number): IsoDate {
  const parts = parse(date);
  if (!parts) throw new Error(`Nieprawidłowa data: ${date}`);
  const year = parts.year - years;
  return format({ year, month: parts.month, day: Math.min(parts.day, daysInMonth(year, parts.month)) });
}

/** Najwcześniejsza dozwolona data analizy: 10 lat wstecz od dziś (w Polsce). */
export function earliestAnalysisDate(today: IsoDate = todayInPoland()): IsoDate {
  return minusYears(today, 10);
}

/** Porównanie dat kalendarzowych w formacie YYYY-MM-DD działa leksykograficznie. */
export function compareIsoDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const MONTHS_GENITIVE = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
];

const MONTHS_NOMINATIVE = [
  'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
];

/** „26 czerwca 2019” – bez użycia obiektu Date, więc bez przesunięć strefy. */
export function formatDatePl(date: IsoDate | null): string {
  if (!date) return 'brak';
  const parts = parse(date);
  if (!parts) return date;
  return `${parts.day} ${MONTHS_GENITIVE[parts.month - 1]} ${parts.year}`;
}

export function formatRangePl(range: { from: IsoDate; to: IsoDate } | null): string {
  if (!range) return 'brak';
  return `${formatDatePl(range.from)} – ${formatDatePl(range.to)}`;
}

/** Lista miesięcy: [5,6,7] → „maj–lipiec”; miesiące nieciągłe są wymieniane po przecinku. */
export function formatMonthsPl(months: number[]): string {
  if (months.length === 0) return 'brak';
  const sorted = [...months].sort((a, b) => a - b);
  const contiguous = sorted.every((month, index) => index === 0 || month === (sorted[index - 1] ?? 0) + 1);
  const name = (month: number) => MONTHS_NOMINATIVE[month - 1] ?? String(month);
  if (contiguous && sorted.length > 1) {
    return `${name(sorted[0] ?? 1)}–${name(sorted[sorted.length - 1] ?? 12)}`;
  }
  return sorted.map(name).join(', ');
}

export function formatDateTimePl(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) return isoDateTime;
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw',
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}
