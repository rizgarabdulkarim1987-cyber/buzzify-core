import type { Locale } from '@/lib/locale';

/**
 * Times for scheduled publishing: the person picks a wall-clock time in the menu's own time zone, the server stores the
 * instant (spec 10.6).
 */

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const MINUTE = 60_000;

/** The wall-clock time an instant shows in a zone, as `YYYY-MM-DDTHH:mm`. */
function wallClock(instant: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** How far a zone's clock is ahead of UTC at an instant, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const [date, time] = wallClock(instant, timeZone).split('T') as [string, string];
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  return Date.UTC(y, mo - 1, d, h, mi) - Math.floor(instant / MINUTE) * MINUTE;
}

/**
 * The instant a wall-clock time (`YYYY-MM-DDTHH:mm`) names in a time zone. A time that does not exist there (the hour
 * skipped when clocks go forward) moves forward to the first minute that does; a time that happens twice (the hour
 * repeated when clocks go back) is the earlier of the two.
 */
export function zonedLocalToUtc(local: string, timeZone: string): Date {
  const match = LOCAL.exec(local);
  if (!match) throw new Error(`Not a local time: ${local}`);
  const [y, mo, d, h, mi] = match.slice(1).map(Number) as [number, number, number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(naive);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) throw new Error(`Not a local time: ${local}`);

  // The zone's offsets a day either side cover any change of clocks that night.
  const offsets = [...new Set([offsetAt(naive - 24 * 60 * MINUTE, timeZone), offsetAt(naive + 24 * 60 * MINUTE, timeZone), offsetAt(naive, timeZone)])];
  const candidates = offsets.map((offset) => naive - offset).sort((x, z) => x - z);
  const exact = candidates.find((instant) => wallClock(instant, timeZone) === local);
  if (exact !== undefined) return new Date(exact);

  // In a gap: the first minute whose wall-clock time is at or after the one asked for.
  for (let instant = candidates[0]!; instant <= candidates.at(-1)!; instant += MINUTE) {
    if (wallClock(instant, timeZone) >= local) return new Date(instant);
  }
  return new Date(candidates.at(-1)!);
}

/** An instant as the menu's clock shows it, in the reader's language: "Nov 1, 2026, 9:00 AM". */
export function formatInZone(date: Date, timeZone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(locale === 'ckb' ? { numberingSystem: 'arab' } : {}),
  }).format(date);
}

/** An instant as the value of a `datetime-local` field in the zone: `YYYY-MM-DDTHH:mm`. */
export function utcToZonedLocal(date: Date, timeZone: string): string {
  return wallClock(date.getTime(), timeZone);
}
