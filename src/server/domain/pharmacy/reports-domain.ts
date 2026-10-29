/**
 * The pure rules behind the pharmacy reports (phase 6, task 4; R6-7, R6-8). No database, no clock.
 *
 * Days are Baghdad calendar days (Iraq has been on UTC+3 all year since 2008, so a day is a fixed 3-hour shift of UTC, which
 * SQL does with `+ interval '3 hours'` and a range filter does with the instants below). A report range is `from..to`
 * inclusive and at most 366 days. Money is bigint minor units; percentages are basis points computed in bigint (never Float).
 */

export const REPORT_MAX_DAYS = 366;
/** Iraq: UTC+3, no daylight saving time. */
export const BAGHDAD_OFFSET_HOURS = 3;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type ReportsErrorCode = 'BAD_DATE' | 'FROM_AFTER_TO' | 'RANGE_TOO_LONG' | 'BAD_QUANTITY';

export class ReportsError extends Error {
  constructor(
    readonly code: ReportsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReportsError';
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const midnightUtc = (date: string): Date => new Date(`${date}T00:00:00.000Z`);

function validDay(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && iso(midnightUtc(date)) === date;
}

/** The Baghdad calendar day of an instant, 'YYYY-MM-DD'. */
export function baghdadDay(at: Date): string {
  return iso(new Date(at.getTime() + BAGHDAD_OFFSET_HOURS * HOUR_MS));
}

export function addDays(date: string, days: number): string {
  if (!validDay(date)) throw new ReportsError('BAD_DATE', 'Enter a date as YYYY-MM-DD');
  return iso(new Date(midnightUtc(date).getTime() + days * DAY_MS));
}

export interface ReportWindow {
  from: string;
  to: string;
  /** The instant Baghdad midnight of `from` falls on (inclusive). */
  start: Date;
  /** The instant Baghdad midnight after `to` falls on (exclusive). */
  endExclusive: Date;
  /** Calendar days covered, `to` included. */
  days: number;
}

/** Validates `from..to` (inclusive Baghdad days, at most 366 of them) and returns the instants that bound it. */
export function baghdadWindow(from: string, to: string): ReportWindow {
  if (!validDay(from) || !validDay(to)) throw new ReportsError('BAD_DATE', 'Enter a date as YYYY-MM-DD');
  if (from > to) throw new ReportsError('FROM_AFTER_TO', 'The start date is after the end date');
  const days = Math.round((midnightUtc(to).getTime() - midnightUtc(from).getTime()) / DAY_MS) + 1;
  if (days > REPORT_MAX_DAYS) throw new ReportsError('RANGE_TOO_LONG', 'Use a range of at most one year');
  const shift = BAGHDAD_OFFSET_HOURS * HOUR_MS;
  return { from, to, start: new Date(midnightUtc(from).getTime() - shift), endExclusive: new Date(midnightUtc(to).getTime() + DAY_MS - shift), days };
}

/** `part / whole` in basis points, half away from zero, in bigint. Null when `whole` is not above zero. */
export function bpOf(part: bigint, whole: bigint): bigint | null {
  if (whole <= 0n) return null;
  const abs = part < 0n ? -part : part;
  const rounded = (abs * 20_000n + whole) / (2n * whole);
  return part < 0n ? -rounded : rounded;
}

/** The estimated margin, `(net - cost) / net` in basis points; null when there are no sales to divide by. */
export function marginBp(netMinor: bigint, costMinor: bigint): bigint | null {
  return bpOf(netMinor - costMinor, netMinor);
}

/** The cost of the units a return gave back: the allocation's cost in proportion to the units returned, floored. */
export function returnedCost(allocationCostMinor: bigint, allocationBaseQty: number, returnedBaseQty: number): bigint {
  if (!Number.isSafeInteger(allocationBaseQty) || allocationBaseQty < 1 || !Number.isSafeInteger(returnedBaseQty) || returnedBaseQty < 0 || returnedBaseQty > allocationBaseQty) {
    throw new ReportsError('BAD_QUANTITY', 'A return cannot be larger than the sale');
  }
  return (allocationCostMinor * BigInt(returnedBaseQty)) / BigInt(allocationBaseQty);
}

/**
 * The units a valuation counts (ruling R6-12a): stock that still belongs to the business and is not written off, so available,
 * reserved and quarantine. Damaged stock is shown on its own and left out of the total.
 */
export function valuedUnits(b: { available: number; reserved: number; quarantine: number; damaged: number }): number {
  return b.available + b.reserved + b.quarantine;
}

export interface BranchTotal<K extends string> {
  branchId: string;
  currency: string;
  values: Record<K, bigint>;
}

/**
 * The all-branches total from the per-branch totals: summed by currency, never across currencies. The chain dashboard
 * and the acceptance test use it as the second way of reaching a figure the SQL also gives.
 */
export function consolidate<K extends string>(rows: readonly BranchTotal<K>[]): Array<{ currency: string; values: Record<K, bigint> }> {
  const byCurrency = new Map<string, Record<string, bigint>>();
  for (const row of rows) {
    const sum = byCurrency.get(row.currency) ?? {};
    for (const [key, value] of Object.entries(row.values) as Array<[string, bigint]>) sum[key] = (sum[key] ?? 0n) + value;
    byCurrency.set(row.currency, sum);
  }
  return [...byCurrency.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([currency, values]) => ({ currency, values: values as Record<K, bigint> }));
}
