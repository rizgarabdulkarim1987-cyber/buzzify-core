import type { Locale } from '@/lib/locale';

/**
 * The time zone the Studio states times in. Every client and the agency are in Iraq; a time rendered on the server is
 * then the same as the browser would show, and the same for everyone reading it.
 */
export const STUDIO_TIME_ZONE = 'Asia/Baghdad';

/** A date and time in the interface language: "16 Oct 2026, 19:05" (Arabic-script digits in Arabic and Sorani). */
export function formatDateTime(iso: string, locale: Locale): string {
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
