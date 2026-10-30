import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { baghdadWindow, ReportsError, validDay, type ReportWindow } from '@/server/domain/pharmacy/reports-domain';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';

/**
 * What every pharmacy report shares (phase 6, task 4; R6-7, R6-8): the paging and period input shapes, the scope of an actor (the
 * branches they work in, narrowed by an optional branch that must be theirs), the Baghdad window, small SQL fragments, and the
 * one page-marker implementation of the reports that page an aggregate in memory (sales and margin).
 */

export const REPORT_PAGE = 100;
export const REPORT_PAGE_MAX = 500;
export const SOLD = Prisma.sql`('COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL')`;

const dateText = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v, 'Enter a date as YYYY-MM-DD');
const WHOLE = 'Enter a whole number';
export const periodShape = { from: dateText, to: dateText };
export const pagingShape = {
  cursor: z.string().min(1).max(400).nullish(),
  take: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(REPORT_PAGE_MAX, 'Enter a smaller number').default(REPORT_PAGE),
};

export type Currency = 'IQD' | 'USD';

export interface Scope {
  restaurantId: string;
  branchIds: string[];
}

/** Who may read a report: a staff actor, for the branches they work in, narrowed by the chosen branch (which must be theirs). */
export function scopeOf(ph: PhActor, branchId: string | undefined): Scope {
  if (ph.support !== null || ph.role === null) throw new StudioError('FORBIDDEN');
  if (branchId !== undefined && !ph.branchIds.includes(branchId)) throw new StudioError('FORBIDDEN');
  return { restaurantId: ph.restaurantId, branchIds: branchId !== undefined ? [branchId] : ph.branchIds };
}

export function windowOf(from: string, to: string): ReportWindow {
  try {
    return baghdadWindow(from, to);
  } catch (error) {
    if (error instanceof ReportsError) {
      // A bad date is reported on the field that is bad (the start first); a reversed range on the start; a range too long on the end.
      const field = error.code === 'FROM_AFTER_TO' || (error.code === 'BAD_DATE' && !validDay(from)) ? 'from' : 'to';
      throw new StudioError('INVALID', 'Check the highlighted fields', { [field]: error.message });
    }
    throw error;
  }
}

export const stamp = (d: Date) => Prisma.sql`${d.toISOString().replace('Z', '')}::timestamp`;
/** The Baghdad calendar day of a timestamp column, as text. */
export const dayOf = (column: Prisma.Sql) => Prisma.sql`to_char(${column} + interval '3 hours', 'YYYY-MM-DD')`;
export const money = (v: bigint | null | undefined) => (v ?? 0n).toString();

export const profitOf = (ph: PhActor) => ph.role !== null && canPh(ph.role, 'profit.view');

export const currencyFilter = (column: Prisma.Sql, currency: Currency | undefined) => (currency ? Prisma.sql`AND ${column}::text = ${currency}` : Prisma.empty);

export const sortBy = <T>(rows: T[], ...keys: Array<(r: T) => string>) =>
  rows.sort((a, b) => {
    for (const key of keys) {
      const x = key(a);
      const y = key(b);
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  });

/** A row of an in-memory paged aggregate: ordered by currency, then (days: by key; others: by net descending, then key). */
export interface PagedRow {
  currency: Currency;
  netMinor: string;
  key: string;
}

const markerFails = () => new StudioError('INVALID', 'The page marker is not valid', { cursor: 'The page marker is not valid' });

/**
 * Orders the rows and cuts one page after the marker. The marker names the grouping it was made for: a marker from another
 * grouping is refused instead of landing somewhere unexpected. `byKey` orders by key alone (days run oldest first).
 */
export function pageRows<T extends PagedRow>(rows: T[], opts: { groupBy: string; cursor: string | null | undefined; take: number; byKey: boolean }): { page: T[]; hasMore: boolean; nextCursor: string | null } {
  const { groupBy, cursor, take, byKey } = opts;
  const order = (a: PagedRow, b: PagedRow): number => {
    if (a.currency !== b.currency) return a.currency < b.currency ? -1 : 1;
    if (byKey) return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    const x = BigInt(a.netMinor);
    const y = BigInt(b.netMinor);
    if (x !== y) return x > y ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  };
  const sorted = [...rows].sort(order);
  let start = 0;
  if (cursor) {
    let marker: unknown;
    try {
      marker = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
      throw markerFails();
    }
    if (!Array.isArray(marker) || marker.length !== 4 || !marker.every((x) => typeof x === 'string') || marker[0] !== groupBy || !/^-?\d+$/.test(marker[2] as string)) throw markerFails();
    const after: PagedRow = { currency: marker[1] as Currency, netMinor: marker[2] as string, key: marker[3] as string };
    start = sorted.findIndex((r) => order(r, after) > 0);
    if (start < 0) start = sorted.length;
  }
  const page = sorted.slice(start, start + take);
  const hasMore = start + take < sorted.length;
  const last = page[page.length - 1];
  return { page, hasMore, nextCursor: hasMore && last ? Buffer.from(JSON.stringify([groupBy, last.currency, last.netMinor, last.key])).toString('base64url') : null };
}
