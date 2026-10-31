import type { Locale } from '@/lib/locale';
import { formatDate, formatDateTime, STUDIO_TIME_ZONE } from '@/studio/format';

/**
 * Dates on the pharmacy screens, written for a left-to-right isolate (`<bdi dir="ltr">`). The Arabic and Sorani forms from
 * `formatDate` carry direction marks and Arabic-script digits, and inside an isolate they come out scrambled
 * ("282026/10/"). So English keeps its form and the other languages get year-month-day in Latin digits, which reads the
 * same in every direction.
 */
const PARTS = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: STUDIO_TIME_ZONE } as const;

function parts(iso: string | Date): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-US', PARTS);
  return Object.fromEntries(formatter.formatToParts(typeof iso === 'string' ? new Date(iso) : iso).map((p) => [p.type, p.value]));
}

export function phDate(iso: string, locale: Locale): string {
  if (locale === 'en') return formatDate(iso, locale);
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day}`;
}

export function phDateTime(iso: string, locale: Locale): string {
  if (locale === 'en') return formatDateTime(iso, locale);
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** Today on the Studio calendar (YYYY-MM-DD): the pharmacy's day, not UTC's, which is still yesterday until 03:00 in Baghdad. */
export function todayInStudioZone(now: Date = new Date()): string {
  const p = parts(now);
  return `${p.year}-${p.month}-${p.day}`;
}
