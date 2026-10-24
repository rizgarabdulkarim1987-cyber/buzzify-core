/**
 * Baghdad business days and times of day. Pure, so the server (board, reports) and the browser (the report's printed-at
 * line) use the same rule.
 */

/** Baghdad is UTC+3 all year: Iraq has had no daylight saving time since 2008. */
const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** The business day that contains `now`: from 00:00 to the next 00:00 in Baghdad, as UTC instants (end exclusive). */
export function baghdadDayRange(now: Date): { start: Date; end: Date } {
  const local = now.getTime() + BAGHDAD_OFFSET_MS;
  const start = Math.floor(local / DAY_MS) * DAY_MS - BAGHDAD_OFFSET_MS;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}

/**
 * The Baghdad business day `day` ('YYYY-MM-DD', a real calendar date the caller has checked) as UTC instants, from its
 * 00:00 to the next 00:00 in Baghdad (end exclusive).
 */
export function baghdadDay(day: string): { start: Date; end: Date } {
  const [y, m, d] = day.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d) - BAGHDAD_OFFSET_MS;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}

/** The Baghdad business day that contains `now`, as 'YYYY-MM-DD'. */
export function baghdadDayOf(now: Date): string {
  return new Date(now.getTime() + BAGHDAD_OFFSET_MS).toISOString().slice(0, 10);
}

/** The Baghdad time of day of `at`, as 'HH:mm' (24-hour, Latin digits). */
export function baghdadClock(at: Date): string {
  return new Date(at.getTime() + BAGHDAD_OFFSET_MS).toISOString().slice(11, 16);
}

/** The Baghdad time of day of `at` with seconds, as 'HH:mm:ss' (24-hour, Latin digits). */
export function baghdadClockSeconds(at: Date): string {
  return new Date(at.getTime() + BAGHDAD_OFFSET_MS).toISOString().slice(11, 19);
}

/** 'YYYY-MM-DD' in Latin digits and a real calendar date: 2026-02-30 is not one. */
export function isCalendarDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The Baghdad calendar month that contains `now`, as 'YYYY-MM'. */
export function baghdadMonthOf(now: Date): string {
  return baghdadDayOf(now).slice(0, 7);
}
