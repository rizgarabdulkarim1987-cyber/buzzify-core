export type BillingPeriodKind = 'MONTHLY' | 'YEARLY';

/** Asia/Baghdad has been UTC+3 all year since 2008 (no DST). The one place this offset lives. */
export const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;

const daysInMonth = (year: number, month0: number): number => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

/**
 * Calendar arithmetic on the Asia/Baghdad wall clock: the time of day is kept, the day of month is the anchor day
 * (default: the start's Baghdad day) clamped to the target month's length.
 */
export function addPeriod(start: Date, period: BillingPeriodKind, anchorDay?: number): Date {
  // A Date whose UTC fields read as the Baghdad wall clock.
  const wall = new Date(start.getTime() + BAGHDAD_OFFSET_MS);
  const day = anchorDay ?? wall.getUTCDate();
  const monthsToAdd = period === 'MONTHLY' ? 1 : 12;
  const total = wall.getUTCFullYear() * 12 + wall.getUTCMonth() + monthsToAdd;
  const year = Math.floor(total / 12);
  const month0 = total % 12;
  const targetDay = Math.min(day, daysInMonth(year, month0));
  const result = Date.UTC(
    year,
    month0,
    targetDay,
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    wall.getUTCSeconds(),
    wall.getUTCMilliseconds(),
  );
  return new Date(result - BAGHDAD_OFFSET_MS);
}
