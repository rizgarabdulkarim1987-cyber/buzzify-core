import type { Locale } from '@/lib/locale';

/**
 * The time zone the Studio states times in. Every client and the agency are in Iraq; a time rendered on the server is
 * then the same as the browser would show, and the same for everyone reading it.
 */
export const STUDIO_TIME_ZONE = 'Asia/Baghdad';

/**
 * Sorani's month names, as CLDR (and so Node) has them, with December spelt like January. Browsers ship no Sorani
 * formatting data (Chrome formats `ckb` as American English), so the Studio writes Sorani dates itself: the server and
 * the browser then print the same text, and a page rendered on the server is not thrown away when it hydrates.
 */
const SORANI_MONTHS = [
  'کانوونی دووەم',
  'شوبات',
  'ئازار',
  'نیسان',
  'ئایار',
  'حوزەیران',
  'تەمووز',
  'ئاب',
  'ئەیلوول',
  'تشرینی یەکەم',
  'تشرینی دووەم',
  'کانوونی یەکەم',
] as const;

/** Before and after noon in Sorani (CLDR's ب.ن and د.ن). */
const SORANI_DAY_PERIODS = ['ب.ن', 'د.ن'] as const;

/**
 * Numbers in the interface language. Sorani uses Arabic-script digits, which the numbering system gives in every runtime,
 * where the `ckb` locale alone gives them only where the runtime has Sorani data (Node, not browsers).
 */
export function numberFormat(locale: Locale, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, locale === 'ckb' ? { numberingSystem: 'arab', ...options } : options);
}

/** A size in bytes as people read it: `820 B`, `12.4 KB`, `3.1 MB` (powers of 1,024), in the interface's digits. */
export function formatBytes(bytes: number, locale: Locale): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${numberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}

/** The calendar fields of `iso` on the Studio's clock, from a format every runtime has. */
function studioClock(iso: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STUDIO_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const field = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: field('year'), month: field('month'), day: field('day'), hour: field('hour'), minute: field('minute') };
}

/** CLDR's Sorani medium date, "y MMM d": ٢٠٢٦ تشرینی یەکەم ١٦. */
function soraniDate(iso: string): string {
  const { year, month, day } = studioClock(iso);
  const digits = numberFormat('ckb', { useGrouping: false });
  return `${digits.format(year)} ${SORANI_MONTHS[month - 1]} ${digits.format(day)}`;
}

/** CLDR's Sorani medium date and short time, "y MMM d h:mm a": ٢٠٢٦ تشرینی یەکەم ١٦ ٧:٠٥ د.ن. */
function soraniDateTime(iso: string): string {
  const { hour, minute } = studioClock(iso);
  const digits = numberFormat('ckb', { useGrouping: false });
  const minutes = numberFormat('ckb', { minimumIntegerDigits: 2 });
  return `${soraniDate(iso)} ${digits.format(hour % 12 || 12)}:${minutes.format(minute)} ${SORANI_DAY_PERIODS[hour < 12 ? 0 : 1]}`;
}

/** A date and time in the interface language: "Oct 16, 2026, 7:05 PM" in English, Arabic-script digits in Sorani. */
export function formatDateTime(iso: string, locale: Locale): string {
  if (locale === 'ckb') return soraniDateTime(iso);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: STUDIO_TIME_ZONE }).format(new Date(iso));
}

const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/** The browser and system a `User-Agent` names, as a person would say them; null for what it does not recognise. */
export function describeUserAgent(userAgent: string): { browser: string | null; system: string | null } {
  return {
    browser: BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null,
    system: SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null,
  };
}

/** A date in the interface language ("Oct 16, 2026" in English), on the Studio calendar: the same day for everyone reading it. */
export function formatDate(iso: string, locale: Locale): string {
  if (locale === 'ckb') return soraniDate(iso);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: STUDIO_TIME_ZONE }).format(new Date(iso));
}
