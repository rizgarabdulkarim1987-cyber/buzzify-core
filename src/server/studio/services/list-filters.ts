import { z } from 'zod';

/**
 * What the Studio's paged lists share: a typed search made literal, and calendar days in the Studio's time zone for the
 * "created" filters.
 */

/** Iraq has had no daylight saving since 2008, so a day there is always this far ahead of UTC. */
const STUDIO_UTC_OFFSET = '+03:00';
const DAY_MS = 24 * 60 * 60 * 1000;

function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

/**
 * A typed search as the text `contains` looks for. Prisma passes it to LIKE as it is, so a typed % or _ would match
 * anything; each is escaped (with the backslash PostgreSQL's LIKE reads as its escape), and a typed backslash, which
 * no name needs, is dropped.
 */
export function literal(text: string): string {
  return text.replace(/\\/g, '').replace(/[%_]/g, (character) => `\\${character}`);
}

/** A calendar day, `YYYY-MM-DD`. */
export const dateField = z.string().refine(isCalendarDate, 'Enter a valid date');

/** The moment a calendar day starts in the Studio's time zone. */
const startOfDay = (date: string) => new Date(`${date}T00:00:00${STUDIO_UTC_OFFSET}`);

/** A `createdAt` filter from the first day to the last, both whole, in the Studio's time zone; null without either. */
export function createdBetween(from: string | undefined, to: string | undefined): { gte?: Date; lt?: Date } | null {
  if (!from && !to) return null;
  return {
    ...(from ? { gte: startOfDay(from) } : {}),
    // The last day counts whole: up to, not including, the next one.
    ...(to ? { lt: new Date(startOfDay(to).getTime() + DAY_MS) } : {}),
  };
}
