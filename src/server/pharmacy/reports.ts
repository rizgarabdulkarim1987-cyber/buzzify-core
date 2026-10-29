/* eslint-disable no-restricted-properties -- read-only aggregates: every statement below is bound to the actor's restaurantId and branch ids, and none of them writes */
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import type { ScopedClient } from '@/server/data/tenant-db';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { baghdadWindow, bpOf, marginBp, ReportsError, type ReportWindow } from '@/server/domain/pharmacy/reports-domain';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { mayViewCost } from './products';

/**
 * Pharmacy reports, part 1: sales, returns, discounts and margin (phase 6, task 4; R6-7, R6-8). Read-only SQL aggregates with
 * bigint sums, over Baghdad calendar days (inclusive, at most 366), for the branches the actor works in (an optional `branchId`
 * narrows them further; one that is not theirs is refused). Money is per currency and never summed across currencies. Every
 * report returns, besides its rows, `totals` per currency and `byBranch` totals per currency and branch taken from the SAME
 * facts by GROUPING SETS, so the all-branches figure is the sum of the branch figures by construction (R6-8). A constant number
 * of statements however many rows. Cost, margin and profit exist only for roles that may see them (keys absent otherwise).
 *
 * What a "sale" is here: COMPLETED, RETURNED_PARTIAL and RETURNED_FULL sales, on the day of `completedAt`. A return stands on
 * the day it was made (`createdAt`), so a sale in October refunded in November lowers November. The model carries no tax
 * figure and there is no customer model yet, so there is no tax or customer report.
 */

export const REPORT_PAGE = 100;
export const REPORT_PAGE_MAX = 500;
const SOLD = Prisma.sql`('COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL')`;

const idText = z.string().min(1).max(64);
const dateText = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v, 'Enter a date as YYYY-MM-DD');
const currencyEnum = z.enum(['IQD', 'USD'], 'Choose IQD or USD');
const WHOLE = 'Enter a whole number';
export const periodShape = { from: dateText, to: dateText };
export const pagingShape = {
  cursor: z.string().min(1).max(400).nullish(),
  take: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(REPORT_PAGE_MAX, 'Enter a smaller number').default(REPORT_PAGE),
};

export type Currency = 'IQD' | 'USD';
export const SALES_GROUPS = ['day', 'branch', 'user', 'method', 'product', 'category'] as const;
export type SalesGroup = (typeof SALES_GROUPS)[number];
export const MARGIN_GROUPS = ['day', 'branch', 'category', 'product'] as const;
export type MarginGroup = (typeof MARGIN_GROUPS)[number];

export const salesInput = z.object({ ...periodShape, groupBy: z.enum(SALES_GROUPS, 'Choose how to group').default('day'), currency: currencyEnum.optional(), ...pagingShape });
export type SalesInput = z.input<typeof salesInput>;
export const returnsInput = z.object({ ...periodShape, userId: idText.optional(), currency: currencyEnum.optional(), ...pagingShape });
export type ReturnsInput = z.input<typeof returnsInput>;
export const discountsInput = z.object({ ...periodShape, userId: idText.optional(), currency: currencyEnum.optional(), ...pagingShape });
export type DiscountsInput = z.input<typeof discountsInput>;
export const marginInput = z.object({ ...periodShape, groupBy: z.enum(MARGIN_GROUPS, 'Choose how to group').default('day'), currency: currencyEnum.optional(), ...pagingShape });
export type MarginInput = z.input<typeof marginInput>;

// Shared -----------------------------------------------------------------------------------------------------------------

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
      const field = error.code === 'BAD_DATE' || error.code === 'FROM_AFTER_TO' ? 'from' : 'to';
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

export interface PageCursor {
  cur: string;
  net: bigint;
  key: string;
}
export function encodeCursor(c: PageCursor): string {
  return Buffer.from(JSON.stringify([c.cur, c.net.toString(), c.key])).toString('base64url');
}
export function decodeCursor(text: string): PageCursor {
  try {
    const v = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'string') && /^-?\d+$/.test(v[1] as string)) {
      return { cur: v[0] as string, net: BigInt(v[1] as string), key: v[2] as string };
    }
  } catch {
    // fall through
  }
  throw new StudioError('INVALID', 'The page marker is not valid', { cursor: 'The page marker is not valid' });
}

/** `(cur, net desc, key)` order: the rows after the cursor row. `byKey` orders by key alone (days). */
export function afterCursor(cursor: string | null | undefined, byKey: boolean): Prisma.Sql {
  if (!cursor) return Prisma.empty;
  const c = decodeCursor(cursor);
  if (byKey) return Prisma.sql`WHERE ("cur" > ${c.cur} OR ("cur" = ${c.cur} AND "k" > ${c.key}))`;
  return Prisma.sql`WHERE ("cur" > ${c.cur} OR ("cur" = ${c.cur} AND ("net" < ${c.net} OR ("net" = ${c.net} AND "k" > ${c.key}))))`;
}

const currencyFilter = (column: Prisma.Sql, currency: Currency | undefined) => (currency ? Prisma.sql`AND ${column}::text = ${currency}` : Prisma.empty);

export interface MoneyTotals {
  currency: Currency;
  count: number;
  grossMinor: string;
  discountMinor: string;
  roundingMinor: string;
  salesMinor: string;
  refundsMinor: string;
  refundCount: number;
  netMinor: string;
  avgTicketMinor: string | null;
}

interface FactRow {
  gb: number;
  gk: number;
  cur: Currency;
  branchId: string | null;
  k: string | null;
  n: number;
  rn: number;
  gross: bigint;
  disc: bigint;
  rnd: bigint;
  sales: bigint;
  refunds: bigint;
}

function totalsOf(r: FactRow): MoneyTotals {
  return {
    currency: r.cur,
    count: r.n,
    grossMinor: money(r.gross),
    discountMinor: money(r.disc),
    roundingMinor: money(r.rnd),
    salesMinor: money(r.sales),
    refundsMinor: money(r.refunds),
    refundCount: r.rn,
    netMinor: money(r.sales - r.refunds),
    avgTicketMinor: r.n > 0 ? money(r.sales / BigInt(r.n)) : null,
  };
}

// Sales ------------------------------------------------------------------------------------------------------------------

export interface SalesRowView {
  key: string;
  currency: Currency;
  count: number;
  grossMinor: string;
  discountMinor: string;
  /** Not attributable to a product or category: absent for those groupings. */
  roundingMinor?: string;
  salesMinor: string;
  refundsMinor: string;
  netMinor: string;
  avgTicketMinor: string | null;
  /** Product and category rows: base units sold. */
  qty?: number;
}

export interface SalesReport {
  from: string;
  to: string;
  groupBy: SalesGroup;
  /** `netMinor = salesMinor - refundsMinor`; refunds stand on the day the return was made. */
  note: 'returns-on-their-own-date';
  totals: MoneyTotals[];
  byBranch: Array<MoneyTotals & { branchId: string }>;
  /** Payments of those sales by method, per currency; cash is net of the change given. */
  payments: Array<{ currency: Currency; method: 'CASH' | 'CARD_MANUAL' | 'TRANSFER_MANUAL'; amountMinor: string; count: number }>;
  rows: SalesRowView[];
  hasMore: boolean;
  nextCursor: string | null;
}

/** The sale facts and the return facts of a window, one row each, with the grouping key `k` for the day, branch or user grouping. */
function saleFacts(scope: Scope, w: ReportWindow, group: SalesGroup | MarginGroup, currency: Currency | undefined): Prisma.Sql {
  const saleKey =
    group === 'day' ? dayOf(Prisma.sql`s."completedAt"`) : group === 'branch' ? Prisma.sql`s."branchId"` : group === 'user' ? Prisma.sql`s."soldById"` : Prisma.sql`NULL::text`;
  const returnKey =
    group === 'day' ? dayOf(Prisma.sql`r."createdAt"`) : group === 'branch' ? Prisma.sql`r."branchId"` : group === 'user' ? Prisma.sql`o."soldById"` : Prisma.sql`NULL::text`;
  return Prisma.sql`
    SELECT s."branchId" AS "branchId", s."currency" AS "cur", ${saleKey} AS "k", 1 AS "n", 0 AS "rn",
           s."subtotalMinor" AS "gross", s."discountMinor" AS "disc", s."roundingMinor" AS "rnd", s."totalMinor" AS "sales", 0::bigint AS "refunds"
    FROM "PhSale" s
    WHERE s."restaurantId" = ${scope.restaurantId} AND s."branchId" = ANY(${scope.branchIds}::text[]) AND s."status"::text IN ${SOLD}
      AND s."completedAt" >= ${stamp(w.start)} AND s."completedAt" < ${stamp(w.endExclusive)} ${currencyFilter(Prisma.sql`s."currency"`, currency)}
    UNION ALL
    SELECT r."branchId", r."currency", ${returnKey}, 0, 1, 0::bigint, 0::bigint, 0::bigint, 0::bigint, r."refundMinor"
    FROM "PhReturn" r JOIN "PhSale" o ON o."restaurantId" = r."restaurantId" AND o."id" = r."saleId"
    WHERE r."restaurantId" = ${scope.restaurantId} AND r."branchId" = ANY(${scope.branchIds}::text[])
      AND r."createdAt" >= ${stamp(w.start)} AND r."createdAt" < ${stamp(w.endExclusive)} ${currencyFilter(Prisma.sql`r."currency"`, currency)}`;
}

function rowOf(r: FactRow, withRounding: boolean): SalesRowView {
  const t = totalsOf(r);
  return {
    key: r.k ?? '',
    currency: r.cur,
    count: t.count,
    grossMinor: t.grossMinor,
    discountMinor: t.discountMinor,
    ...(withRounding ? { roundingMinor: t.roundingMinor } : {}),
    salesMinor: t.salesMinor,
    refundsMinor: t.refundsMinor,
    netMinor: t.netMinor,
    avgTicketMinor: t.avgTicketMinor,
  };
}

/** Totals per currency and per branch, from the facts, in one scan: GROUPING SETS ((cur), (cur, branch)) (+ (cur, k) for the rows of a sale-level grouping). */
async function groupedFacts(scoped: ScopedClient, facts: Prisma.Sql, withKey: boolean, page: Prisma.Sql | null): Promise<FactRow[]> {
  const sets = withKey ? Prisma.sql`((f."cur"), (f."cur", f."branchId"), (f."cur", f."k"))` : Prisma.sql`((f."cur"), (f."cur", f."branchId"))`;
  return scoped.$queryRaw<FactRow[]>(Prisma.sql`
    WITH f AS (${facts})
    SELECT GROUPING(f."branchId")::int AS "gb", ${withKey ? Prisma.sql`GROUPING(f."k")::int` : Prisma.sql`1`} AS "gk", f."cur"::text AS "cur", f."branchId", ${withKey ? Prisma.sql`f."k"` : Prisma.sql`NULL::text`} AS "k",
           SUM(f."n")::int AS "n", SUM(f."rn")::int AS "rn", SUM(f."gross")::bigint AS "gross", SUM(f."disc")::bigint AS "disc",
           SUM(f."rnd")::bigint AS "rnd", SUM(f."sales")::bigint AS "sales", SUM(f."refunds")::bigint AS "refunds"
    FROM f GROUP BY GROUPING SETS ${sets}${page ?? Prisma.empty}`);
}

export async function salesReport(scoped: ScopedClient, ph: PhActor, place: { branchId?: string | undefined }, input: z.infer<typeof salesInput>): Promise<SalesReport> {
  const scope = scopeOf(ph, place.branchId);
  const w = windowOf(input.from, input.to);
  const saleLevel = input.groupBy === 'day' || input.groupBy === 'branch' || input.groupBy === 'user';
  const facts = saleFacts(scope, w, input.groupBy, input.currency);
  const lineRows = saleLevel ? Promise.resolve([] as LineGroupRow[]) : lineGroups(scoped, scope, w, input.groupBy as 'method' | 'product' | 'category', input.currency);
  const [grouped, lines, pays] = await Promise.all([groupedFacts(scoped, facts, saleLevel, null), lineRows, paymentsByMethod(scoped, scope, w, input.currency)]);

  const totals = grouped.filter((r) => r.gb === 1 && r.gk === 1).map(totalsOf);
  const byBranch = grouped.filter((r) => r.gb === 0 && r.gk === 1).map((r) => ({ ...totalsOf(r), branchId: r.branchId! }));
  let rows: SalesRowView[];
  if (saleLevel) {
    rows = grouped.filter((r) => r.gb === 1 && r.gk === 0).map((r) => rowOf(r, true));
  } else {
    rows = lines;
  }
  rows.sort((a, b) =>
    a.currency !== b.currency ? (a.currency < b.currency ? -1 : 1) : input.groupBy === 'day' ? (a.key < b.key ? -1 : 1) : BigInt(b.netMinor) !== BigInt(a.netMinor) ? (BigInt(b.netMinor) > BigInt(a.netMinor) ? 1 : -1) : a.key < b.key ? -1 : 1,
  );
  totals.sort((a, b) => (a.currency < b.currency ? -1 : 1));
  byBranch.sort((a, b) => (a.currency !== b.currency ? (a.currency < b.currency ? -1 : 1) : a.branchId < b.branchId ? -1 : 1));

  let start = 0;
  if (input.cursor) {
    const c = decodeCursor(input.cursor);
    const byKey = input.groupBy === 'day';
    start = rows.findIndex((r) => r.currency > c.cur || (r.currency === c.cur && (byKey ? r.key > c.key : BigInt(r.netMinor) < c.net || (BigInt(r.netMinor) === c.net && r.key > c.key))));
    if (start < 0) start = rows.length;
  }
  const page = rows.slice(start, start + input.take);
  const more = start + input.take < rows.length;
  const last = page[page.length - 1];
  return {
    from: input.from,
    to: input.to,
    groupBy: input.groupBy,
    note: 'returns-on-their-own-date',
    totals,
    byBranch,
    payments: pays,
    rows: page,
    hasMore: more,
    nextCursor: more && last ? encodeCursor({ cur: last.currency, net: BigInt(last.netMinor), key: last.key }) : null,
  };
}

type LineGroupRow = SalesRowView;

/** Product, category and payment-method groupings: line-level (or payment-level) facts, since a sale is not one product or one method. */
async function lineGroups(scoped: ScopedClient, scope: Scope, w: ReportWindow, group: 'method' | 'product' | 'category', currency: Currency | undefined): Promise<LineGroupRow[]> {
  if (group === 'method') {
    const rows = await scoped.$queryRaw<Array<{ cur: Currency; k: string; n: number; paid: bigint }>>(Prisma.sql`
      SELECT p."currency"::text AS "cur", p."method"::text AS "k", COUNT(DISTINCT s."id")::int AS "n", SUM(p."amountMinor")::bigint AS "paid"
      FROM "PhPayment" p JOIN "PhSale" s ON s."restaurantId" = p."restaurantId" AND s."id" = p."saleId"
      WHERE s."restaurantId" = ${scope.restaurantId} AND s."branchId" = ANY(${scope.branchIds}::text[]) AND s."status"::text IN ${SOLD}
        AND s."completedAt" >= ${stamp(w.start)} AND s."completedAt" < ${stamp(w.endExclusive)} ${currencyFilter(Prisma.sql`s."currency"`, currency)}
      GROUP BY p."currency", p."method"`);
    const change = await changeByCurrency(scoped, scope, w, currency);
    return rows.map((r) => {
      const net = r.k === 'CASH' ? r.paid - (change.get(r.cur) ?? 0n) : r.paid;
      return { key: r.k, currency: r.cur, count: r.n, grossMinor: money(net), discountMinor: '0', salesMinor: money(net), refundsMinor: '0', netMinor: money(net), avgTicketMinor: null };
    });
  }
  const key = group === 'product' ? Prisma.sql`l."productId"` : Prisma.sql`COALESCE(pr."categoryId", '')`;
  const sold = await scoped.$queryRaw<Array<{ cur: Currency; k: string; n: number; qty: bigint; gross: bigint; disc: bigint; sales: bigint; refunds: bigint; rn: number }>>(Prisma.sql`
    WITH f AS (
      SELECT s."currency" AS "cur", ${key} AS "k", s."id" AS "sid", l."baseQty" AS "qty", l."totalMinor" + l."discountMinor" AS "gross", l."discountMinor" AS "disc", l."totalMinor" AS "sales", 0::bigint AS "refunds", NULL::text AS "rid"
      FROM "PhSaleLine" l JOIN "PhSale" s ON s."restaurantId" = l."restaurantId" AND s."id" = l."saleId" JOIN "PhProduct" pr ON pr."restaurantId" = l."restaurantId" AND pr."id" = l."productId"
      WHERE s."restaurantId" = ${scope.restaurantId} AND s."branchId" = ANY(${scope.branchIds}::text[]) AND s."status"::text IN ${SOLD}
        AND s."completedAt" >= ${stamp(w.start)} AND s."completedAt" < ${stamp(w.endExclusive)} ${currencyFilter(Prisma.sql`s."currency"`, currency)}
      UNION ALL
      SELECT r."currency", ${key}, NULL, 0, 0::bigint, 0::bigint, 0::bigint, rl."refundMinor", r."id"
      FROM "PhReturnLine" rl JOIN "PhReturn" r ON r."restaurantId" = rl."restaurantId" AND r."id" = rl."returnId"
        JOIN "PhSaleLineAllocation" a ON a."restaurantId" = rl."restaurantId" AND a."id" = rl."saleLineAllocationId"
        JOIN "PhSaleLine" l ON l."restaurantId" = a."restaurantId" AND l."id" = a."saleLineId" JOIN "PhProduct" pr ON pr."restaurantId" = l."restaurantId" AND pr."id" = l."productId"
      WHERE r."restaurantId" = ${scope.restaurantId} AND r."branchId" = ANY(${scope.branchIds}::text[])
        AND r."createdAt" >= ${stamp(w.start)} AND r."createdAt" < ${stamp(w.endExclusive)} ${currencyFilter(Prisma.sql`r."currency"`, currency)}
    )
    SELECT f."cur"::text AS "cur", f."k", COUNT(DISTINCT f."sid")::int AS "n", COALESCE(SUM(f."qty"), 0)::bigint AS "qty", SUM(f."gross")::bigint AS "gross", SUM(f."disc")::bigint AS "disc",
           SUM(f."sales")::bigint AS "sales", SUM(f."refunds")::bigint AS "refunds", COUNT(DISTINCT f."rid")::int AS "rn"
    FROM f GROUP BY f."cur", f."k"`);
  return sold.map((r) => ({
    key: r.k,
    currency: r.cur,
    count: r.n,
    qty: Number(r.qty),
    grossMinor: money(r.gross),
    discountMinor: money(r.disc),
    salesMinor: money(r.sales),
    refundsMinor: money(r.refunds),
    netMinor: money(r.sales - r.refunds),
    avgTicketMinor: r.n > 0 ? money(r.sales / BigInt(r.n)) : null,
  }));
}

/** The change given back in cash on the sales of the window, per currency: the cash payments on record are what was handed over, not what was kept. */
async function changeByCurrency(scoped: ScopedClient, scope: Scope, w: ReportWindow, currency: Currency | undefined): Promise<Map<Currency, bigint>> {
  const rows = await scoped.$queryRaw<Array<{ cur: Currency; change: bigint }>>(Prisma.sql`
    SELECT s."currency"::text AS "cur", COALESCE(SUM(s."changeMinor"), 0)::bigint AS "change"
    FROM "PhSale" s
    WHERE s."restaurantId" = ${scope.restaurantId} AND s."branchId" = ANY(${scope.branchIds}::text[]) AND s."status"::text IN ${SOLD}
      AND s."completedAt" >= ${stamp(w.start)} AND s."completedAt" < ${stamp(w.endExclusive)} ${currencyFilter(Prisma.sql`s."currency"`, currency)}
      AND EXISTS (SELECT 1 FROM "PhPayment" p WHERE p."restaurantId" = s."restaurantId" AND p."saleId" = s."id" AND p."method" = 'CASH')
    GROUP BY s."currency"`);
  return new Map(rows.map((r) => [r.cur, r.change]));
}

async function paymentsByMethod(scoped: ScopedClient, scope: Scope, w: ReportWindow, currency: Currency | undefined): Promise<SalesReport['payments']> {
  const [rows, change] = await Promise.all([
    scoped.$queryRaw<Array<{ cur: Currency; method: SalesReport['payments'][number]['method']; n: number; amount: bigint }>>(Prisma.sql`
      SELECT p."currency"::text AS "cur", p."method"::text AS "method", COUNT(*)::int AS "n", SUM(p."amountMinor")::bigint AS "amount"
      FROM "PhPayment" p JOIN "PhSale" s ON s."restaurantId" = p."restaurantId" AND s."id" = p."saleId"
      WHERE s."restaurantId" = ${scope.restaurantId} AND s."branchId" = ANY(${scope.branchIds}::text[]) AND s."status"::text IN ${SOLD}
        AND s."completedAt" >= ${stamp(w.start)} AND s."completedAt" < ${stamp(w.endExclusive)} ${currencyFilter(Prisma.sql`s."currency"`, currency)}
      GROUP BY p."currency", p."method"`),
    changeByCurrency(scoped, scope, w, currency),
  ]);
  return rows
    .map((r) => ({ currency: r.cur, method: r.method, amountMinor: money(r.method === 'CASH' ? r.amount - (change.get(r.cur) ?? 0n) : r.amount), count: r.n }))
    .sort((a, b) => (a.currency !== b.currency ? (a.currency < b.currency ? -1 : 1) : a.method < b.method ? -1 : 1));
}

// Returns ----------------------------------------------------------------------------------------------------------------

export interface ReturnRowView {
  id: string;
  number: string | null;
  saleId: string;
  saleNumber: string | null;
  branchId: string;
  reason: string;
  approvedById: string;
  approverName: string | null;
  method: 'CASH' | 'CARD_MANUAL' | 'TRANSFER_MANUAL';
  currency: Currency;
  refundMinor: string;
  createdAt: string;
}

export interface ReturnsReport {
  from: string;
  to: string;
  totals: Array<{ currency: Currency; count: number; refundMinor: string }>;
  byBranch: Array<{ branchId: string; currency: Currency; count: number; refundMinor: string }>;
  byReason: Array<{ reason: string; count: number }>;
  byMethod: Array<{ currency: Currency; method: ReturnRowView['method']; count: number; refundMinor: string }>;
  rows: ReturnRowView[];
  hasMore: boolean;
  nextCursor: string | null;
}

export async function returnsReport(scoped: ScopedClient, ph: PhActor, place: { branchId?: string | undefined }, input: z.infer<typeof returnsInput>): Promise<ReturnsReport> {
  const scope = scopeOf(ph, place.branchId);
  const w = windowOf(input.from, input.to);
  let after = Prisma.empty;
  if (input.cursor) {
    const at = await scoped.$queryRaw<Array<{ createdAt: Date }>>(Prisma.sql`SELECT "createdAt" FROM "PhReturn" WHERE "id" = ${input.cursor} AND "restaurantId" = ${scope.restaurantId} AND "branchId" = ANY(${scope.branchIds}::text[])`);
    if (!at[0]) throw new StudioError('INVALID', 'Check the highlighted fields', { cursor: 'This page of results is no longer available' });
    after = Prisma.sql`AND (r."createdAt" < ${stamp(at[0].createdAt)} OR (r."createdAt" = ${stamp(at[0].createdAt)} AND r."id" < ${input.cursor}))`;
  }
  const where = Prisma.sql`r."restaurantId" = ${scope.restaurantId} AND r."branchId" = ANY(${scope.branchIds}::text[])
    AND r."createdAt" >= ${stamp(w.start)} AND r."createdAt" < ${stamp(w.endExclusive)} ${currencyFilter(Prisma.sql`r."currency"`, input.currency)}
    ${input.userId ? Prisma.sql`AND o."soldById" = ${input.userId}` : Prisma.empty}`;
  const from = Prisma.sql`"PhReturn" r JOIN "PhSale" o ON o."restaurantId" = r."restaurantId" AND o."id" = r."saleId"`;
  const [rows, grouped, reasons, methods] = await Promise.all([
    scoped.$queryRaw<Array<{ id: string; number: string | null; saleId: string; saleNumber: string | null; branchId: string; reason: string; approvedById: string; approverName: string | null; method: ReturnRowView['method']; currency: Currency; refundMinor: bigint; createdAt: Date }>>(Prisma.sql`
      SELECT r."id", r."number", r."saleId", o."number" AS "saleNumber", r."branchId", r."reason", r."approvedById", u."name" AS "approverName", r."refundMethod"::text AS "method",
             r."currency"::text AS "currency", r."refundMinor", r."createdAt"
      FROM ${from} LEFT JOIN "user" u ON u."id" = r."approvedById"
      WHERE ${where} ${after} ORDER BY r."createdAt" DESC, r."id" DESC LIMIT ${input.take + 1}`),
    scoped.$queryRaw<Array<{ gb: number; cur: Currency; branchId: string | null; n: number; refund: bigint }>>(Prisma.sql`
      SELECT GROUPING(r."branchId")::int AS "gb", r."currency"::text AS "cur", r."branchId", COUNT(*)::int AS "n", SUM(r."refundMinor")::bigint AS "refund"
      FROM ${from} WHERE ${where} GROUP BY GROUPING SETS ((r."currency"), (r."currency", r."branchId"))`),
    scoped.$queryRaw<Array<{ reason: string; n: number }>>(Prisma.sql`
      SELECT r."reason", COUNT(*)::int AS "n" FROM ${from} WHERE ${where} GROUP BY r."reason" ORDER BY COUNT(*) DESC, r."reason" LIMIT 20`),
    scoped.$queryRaw<Array<{ cur: Currency; method: ReturnRowView['method']; n: number; refund: bigint }>>(Prisma.sql`
      SELECT r."currency"::text AS "cur", r."refundMethod"::text AS "method", COUNT(*)::int AS "n", SUM(r."refundMinor")::bigint AS "refund"
      FROM ${from} WHERE ${where} GROUP BY r."currency", r."refundMethod" ORDER BY 1, 2`),
  ]);
  const more = rows.length > input.take;
  const page = more ? rows.slice(0, input.take) : rows;
  return {
    from: input.from,
    to: input.to,
    totals: grouped.filter((g) => g.gb === 1).map((g) => ({ currency: g.cur, count: g.n, refundMinor: money(g.refund) })).sort((a, b) => (a.currency < b.currency ? -1 : 1)),
    byBranch: grouped
      .filter((g) => g.gb === 0)
      .map((g) => ({ branchId: g.branchId!, currency: g.cur, count: g.n, refundMinor: money(g.refund) }))
      .sort((a, b) => (a.currency !== b.currency ? (a.currency < b.currency ? -1 : 1) : a.branchId < b.branchId ? -1 : 1)),
    byReason: reasons.map((r) => ({ reason: r.reason, count: r.n })),
    byMethod: methods.map((m) => ({ currency: m.cur, method: m.method, count: m.n, refundMinor: money(m.refund) })),
    rows: page.map((r) => ({ ...r, refundMinor: money(r.refundMinor), createdAt: r.createdAt.toISOString() })),
    hasMore: more,
    nextCursor: more ? page[page.length - 1]!.id : null,
  };
}

// Discounts --------------------------------------------------------------------------------------------------------------

export interface DiscountRowView {
  saleId: string;
  number: string | null;
  branchId: string;
  soldById: string;
  currency: Currency;
  grossMinor: string;
  discountMinor: string;
  /** Discount as basis points of the gross. */
  discountBp: number;
  /** Above the business's current maximum discount: judged against today's setting. */
  overLimit: boolean;
  completedAt: string;
}

export interface DiscountsReport {
  from: string;
  to: string;
  /** The business's maximum discount percent today (the limit `overLimit` is judged by); null when no settings row exists. */
  maxDiscountPercent: number | null;
  totals: Array<{ currency: Currency; salesCount: number; discountedCount: number; grossMinor: string; discountMinor: string; discountBp: number | null }>;
  byBranch: Array<{ branchId: string; currency: Currency; salesCount: number; discountedCount: number; grossMinor: string; discountMinor: string; discountBp: number | null }>;
  topUsers: Array<{ userId: string; userName: string | null; currency: Currency; discountedCount: number; discountMinor: string; grossMinor: string; discountBp: number | null }>;
  rows: DiscountRowView[];
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Discounts given on sold sales. The stored discount of a sale is the sum of its lines' discounts (an invoice discount is
 * shared into the lines), so line and invoice discounts are not told apart, and the seller is the person who rang the sale: a
 * discount above the limit needs the seller's own `discount.over_limit`, so no separate approver is recorded.
 */
export async function discountsReport(scoped: ScopedClient, ph: PhActor, place: { branchId?: string | undefined }, input: z.infer<typeof discountsInput>): Promise<DiscountsReport> {
  const scope = scopeOf(ph, place.branchId);
  const w = windowOf(input.from, input.to);
  let after = Prisma.empty;
  if (input.cursor) {
    const at = await scoped.$queryRaw<Array<{ completedAt: Date }>>(Prisma.sql`SELECT "completedAt" FROM "PhSale" WHERE "id" = ${input.cursor} AND "restaurantId" = ${scope.restaurantId} AND "branchId" = ANY(${scope.branchIds}::text[]) AND "completedAt" IS NOT NULL`);
    if (!at[0]) throw new StudioError('INVALID', 'Check the highlighted fields', { cursor: 'This page of results is no longer available' });
    after = Prisma.sql`AND (s."completedAt" < ${stamp(at[0].completedAt)} OR (s."completedAt" = ${stamp(at[0].completedAt)} AND s."id" < ${input.cursor}))`;
  }
  const where = Prisma.sql`s."restaurantId" = ${scope.restaurantId} AND s."branchId" = ANY(${scope.branchIds}::text[]) AND s."status"::text IN ${SOLD}
    AND s."completedAt" >= ${stamp(w.start)} AND s."completedAt" < ${stamp(w.endExclusive)} ${currencyFilter(Prisma.sql`s."currency"`, input.currency)}
    ${input.userId ? Prisma.sql`AND s."soldById" = ${input.userId}` : Prisma.empty}`;
  const [settings, rows, grouped, users] = await Promise.all([
    scoped.$queryRaw<Array<{ maxDiscountPercent: number }>>(Prisma.sql`SELECT "maxDiscountPercent" FROM "PhSettings" WHERE "restaurantId" = ${scope.restaurantId} LIMIT 1`),
    scoped.$queryRaw<Array<{ id: string; number: string | null; branchId: string; soldById: string; currency: Currency; gross: bigint; disc: bigint; completedAt: Date }>>(Prisma.sql`
      SELECT s."id", s."number", s."branchId", s."soldById", s."currency"::text AS "currency", s."subtotalMinor" AS "gross", s."discountMinor" AS "disc", s."completedAt"
      FROM "PhSale" s WHERE ${where} AND s."discountMinor" > 0 ${after} ORDER BY s."completedAt" DESC, s."id" DESC LIMIT ${input.take + 1}`),
    scoped.$queryRaw<Array<{ gb: number; cur: Currency; branchId: string | null; n: number; dn: number; gross: bigint; disc: bigint }>>(Prisma.sql`
      SELECT GROUPING(s."branchId")::int AS "gb", s."currency"::text AS "cur", s."branchId", COUNT(*)::int AS "n", (COUNT(*) FILTER (WHERE s."discountMinor" > 0))::int AS "dn",
             SUM(s."subtotalMinor")::bigint AS "gross", SUM(s."discountMinor")::bigint AS "disc"
      FROM "PhSale" s WHERE ${where} GROUP BY GROUPING SETS ((s."currency"), (s."currency", s."branchId"))`),
    scoped.$queryRaw<Array<{ userId: string; userName: string | null; cur: Currency; dn: number; disc: bigint; gross: bigint }>>(Prisma.sql`
      SELECT s."soldById" AS "userId", u."name" AS "userName", s."currency"::text AS "cur", COUNT(*)::int AS "dn", SUM(s."discountMinor")::bigint AS "disc", SUM(s."subtotalMinor")::bigint AS "gross"
      FROM "PhSale" s LEFT JOIN "user" u ON u."id" = s."soldById" WHERE ${where} AND s."discountMinor" > 0
      GROUP BY s."soldById", u."name", s."currency" ORDER BY SUM(s."discountMinor") DESC, s."soldById" LIMIT 10`),
  ]);
  const maxPercent = settings[0]?.maxDiscountPercent ?? null;
  const bp = (disc: bigint, gross: bigint) => {
    const v = bpOf(disc, gross);
    return v === null ? null : Number(v);
  };
  const more = rows.length > input.take;
  const page = more ? rows.slice(0, input.take) : rows;
  const shape = (g: (typeof grouped)[number]) => ({ currency: g.cur, salesCount: g.n, discountedCount: g.dn, grossMinor: money(g.gross), discountMinor: money(g.disc), discountBp: bp(g.disc, g.gross) });
  return {
    from: input.from,
    to: input.to,
    maxDiscountPercent: maxPercent,
    totals: grouped.filter((g) => g.gb === 1).map(shape).sort((a, b) => (a.currency < b.currency ? -1 : 1)),
    byBranch: grouped
      .filter((g) => g.gb === 0)
      .map((g) => ({ branchId: g.branchId!, ...shape(g) }))
      .sort((a, b) => (a.currency !== b.currency ? (a.currency < b.currency ? -1 : 1) : a.branchId < b.branchId ? -1 : 1)),
    topUsers: users.map((u) => ({ userId: u.userId, userName: u.userName, currency: u.cur, discountedCount: u.dn, discountMinor: money(u.disc), grossMinor: money(u.gross), discountBp: bp(u.disc, u.gross) })),
    rows: page.map((r) => {
      const discountBp = bp(r.disc, r.gross) ?? 0;
      return {
        saleId: r.id,
        number: r.number,
        branchId: r.branchId,
        soldById: r.soldById,
        currency: r.currency,
        grossMinor: money(r.gross),
        discountMinor: money(r.disc),
        discountBp,
        overLimit: maxPercent !== null && discountBp > maxPercent * 100,
        completedAt: r.completedAt.toISOString(),
      };
    }),
    hasMore: more,
    nextCursor: more ? page[page.length - 1]!.id : null,
  };
}

// Margin -----------------------------------------------------------------------------------------------------------------

export interface MarginTotals {
  currency: Currency;
  /** Sales of the lines whose cost is complete, less the refunds of those lines. */
  netMinor: string;
  /** Cost of what they sold, less the cost of what came back. */
  costMinor: string;
  marginMinor: string;
  /** `(net - cost) / net` in basis points; null without sales. An estimate. */
  marginBp: number | null;
}

export interface MarginReport {
  from: string;
  to: string;
  groupBy: MarginGroup;
  estimated: true;
  totals: MarginTotals[];
  byBranch: Array<MarginTotals & { branchId: string }>;
  /** Sale allocations of the period with no cost on record: their lines are left out of the margin, never counted as free. */
  incompleteCostRows: number;
  /** Sale allocations whose cost is in another currency than the sale: not converted, their lines are left out. */
  mixedCurrencyRows: number;
  /** Sales of the left-out lines, per currency: what the margin does not cover. */
  excluded: Array<{ currency: Currency; netMinor: string }>;
  rows: Array<MarginTotals & { key: string }>;
  hasMore: boolean;
  nextCursor: string | null;
}

interface MarginFact {
  gb: number;
  gk: number;
  cur: Currency;
  branchId: string | null;
  k: string | null;
  net: bigint;
  cost: bigint;
}

/**
 * Margin per day, branch, category or product (needs `profit.view` and `cost.view`). The cost of what was sold is the sum of the
 * allocations' cost snapshots (the one cost rule of the sale: `costOfBaseQty`, floored), and what a return gave back is taken
 * off in proportion, floored, on the day of the return. A line is in the margin only when EVERY allocation has a cost in the
 * sale's currency; the others are counted (`incompleteCostRows`, `mixedCurrencyRows`) and their sales shown under `excluded`.
 * The invoice rounding of IQD sales belongs to no line and is not in the margin.
 */
export async function marginReport(scoped: ScopedClient, ph: PhActor, place: { branchId?: string | undefined }, input: z.infer<typeof marginInput>): Promise<MarginReport> {
  if (!mayViewCost(ph) || ph.role === null || !profitOf(ph)) throw new StudioError('FORBIDDEN');
  const scope = scopeOf(ph, place.branchId);
  const w = windowOf(input.from, input.to);
  const key =
    input.groupBy === 'product' ? Prisma.sql`x."productId"` : input.groupBy === 'category' ? Prisma.sql`COALESCE(x."categoryId", '')` : input.groupBy === 'branch' ? Prisma.sql`(x."branchId" || '')` : Prisma.sql`x."day"`;
  const cur = currencyFilter(Prisma.sql`x."cur"`, input.currency);
  const bounds = (col: string) => Prisma.sql`${Prisma.raw(col)} >= ${stamp(w.start)} AND ${Prisma.raw(col)} < ${stamp(w.endExclusive)}`;
  const base = Prisma.sql`
    WITH sold AS (
      SELECT l."id" AS "lineId", l."productId", pr."categoryId", s."id" AS "saleId", s."branchId", s."currency" AS "cur", l."totalMinor", ${dayOf(Prisma.sql`s."completedAt"`)} AS "day"
      FROM "PhSaleLine" l JOIN "PhSale" s ON s."restaurantId" = l."restaurantId" AND s."id" = l."saleId" JOIN "PhProduct" pr ON pr."restaurantId" = l."restaurantId" AND pr."id" = l."productId"
      WHERE s."restaurantId" = ${scope.restaurantId} AND s."branchId" = ANY(${scope.branchIds}::text[]) AND s."status"::text IN ${SOLD} AND ${bounds('s."completedAt"')}
    ), ret AS (
      SELECT rl."id" AS "rlId", rl."refundMinor", rl."baseQty" AS "rq", a."baseQty" AS "aq", a."saleLineId" AS "lineId", a."costSnapshotMinor" AS "snap", r."branchId", r."currency" AS "cur", l."productId", pr."categoryId",
             ${dayOf(Prisma.sql`r."createdAt"`)} AS "day"
      FROM "PhReturnLine" rl JOIN "PhReturn" r ON r."restaurantId" = rl."restaurantId" AND r."id" = rl."returnId"
        JOIN "PhSaleLineAllocation" a ON a."restaurantId" = rl."restaurantId" AND a."id" = rl."saleLineAllocationId"
        JOIN "PhSaleLine" l ON l."restaurantId" = a."restaurantId" AND l."id" = a."saleLineId" JOIN "PhProduct" pr ON pr."restaurantId" = l."restaurantId" AND pr."id" = l."productId"
      WHERE r."restaurantId" = ${scope.restaurantId} AND r."branchId" = ANY(${scope.branchIds}::text[]) AND ${bounds('r."createdAt"')}
    ), need AS (
      SELECT "lineId" FROM sold UNION SELECT "lineId" FROM ret
    ), lc AS (
      SELECT a."saleLineId" AS "lineId", SUM(a."costSnapshotMinor")::bigint AS "cost",
             bool_and(a."costSnapshotMinor" IS NOT NULL AND a."costCurrency" = s."currency") AS "ok",
             (COUNT(*) FILTER (WHERE a."costSnapshotMinor" IS NULL))::int AS "nulls",
             (COUNT(*) FILTER (WHERE a."costSnapshotMinor" IS NOT NULL AND a."costCurrency" <> s."currency"))::int AS "mixed"
      FROM "PhSaleLineAllocation" a JOIN need ON need."lineId" = a."saleLineId"
        JOIN "PhSaleLine" l ON l."restaurantId" = a."restaurantId" AND l."id" = a."saleLineId" JOIN "PhSale" s ON s."restaurantId" = l."restaurantId" AND s."id" = l."saleId"
      WHERE a."restaurantId" = ${scope.restaurantId}
      GROUP BY a."saleLineId"
    ), x AS (
      SELECT sold."branchId", sold."cur", sold."productId", sold."categoryId", sold."day", lc."ok",
             sold."totalMinor" AS "net", COALESCE(lc."cost", 0) AS "cost"
      FROM sold JOIN lc ON lc."lineId" = sold."lineId"
      UNION ALL
      SELECT ret."branchId", ret."cur", ret."productId", ret."categoryId", ret."day", lc."ok",
             -ret."refundMinor", -(CASE WHEN ret."snap" IS NULL THEN 0 ELSE floor(ret."snap"::numeric * ret."rq" / ret."aq")::bigint END)
      FROM ret JOIN lc ON lc."lineId" = ret."lineId"
    )`;
  const [facts, flags, excluded] = await Promise.all([
    scoped.$queryRaw<MarginFact[]>(Prisma.sql`
      ${base}
      SELECT GROUPING(x."branchId")::int AS "gb", GROUPING(${key})::int AS "gk", x."cur"::text AS "cur", x."branchId", ${key} AS "k",
             SUM(x."net")::bigint AS "net", SUM(x."cost")::bigint AS "cost"
      FROM x WHERE x."ok" ${cur}
      GROUP BY GROUPING SETS ((x."cur"), (x."cur", x."branchId"), (x."cur", ${key}))`),
    scoped.$queryRaw<Array<{ nulls: number; mixed: number }>>(Prisma.sql`
      ${base}
      SELECT COALESCE(SUM(lc."nulls"), 0)::int AS "nulls", COALESCE(SUM(lc."mixed"), 0)::int AS "mixed"
      FROM lc JOIN sold ON sold."lineId" = lc."lineId" WHERE true ${currencyFilter(Prisma.sql`sold."cur"`, input.currency)}`),
    scoped.$queryRaw<Array<{ cur: Currency; net: bigint }>>(Prisma.sql`
      ${base}
      SELECT x."cur"::text AS "cur", SUM(x."net")::bigint AS "net" FROM x WHERE NOT x."ok" ${cur} GROUP BY x."cur"`),
  ]);
  const shape = (f: MarginFact): MarginTotals => {
    const bpv = marginBp(f.net, f.cost);
    return { currency: f.cur, netMinor: money(f.net), costMinor: money(f.cost), marginMinor: money(f.net - f.cost), marginBp: bpv === null ? null : Number(bpv) };
  };
  const rowsAll = facts
    .filter((f) => f.gb === 1 && f.gk === 0)
    .map((f) => ({ key: f.k ?? '', ...shape(f) }))
    .sort((a, b) =>
      a.currency !== b.currency ? (a.currency < b.currency ? -1 : 1) : input.groupBy === 'day' ? (a.key < b.key ? -1 : 1) : BigInt(b.netMinor) !== BigInt(a.netMinor) ? (BigInt(b.netMinor) > BigInt(a.netMinor) ? 1 : -1) : a.key < b.key ? -1 : 1,
    );
  let start = 0;
  if (input.cursor) {
    const c = decodeCursor(input.cursor);
    const byKey = input.groupBy === 'day';
    start = rowsAll.findIndex((r) => r.currency > c.cur || (r.currency === c.cur && (byKey ? r.key > c.key : BigInt(r.netMinor) < c.net || (BigInt(r.netMinor) === c.net && r.key > c.key))));
    if (start < 0) start = rowsAll.length;
  }
  const page = rowsAll.slice(start, start + input.take);
  const more = start + input.take < rowsAll.length;
  const last = page[page.length - 1];
  return {
    from: input.from,
    to: input.to,
    groupBy: input.groupBy,
    estimated: true,
    totals: facts.filter((f) => f.gb === 1 && f.gk === 1).map(shape).sort((a, b) => (a.currency < b.currency ? -1 : 1)),
    byBranch: facts
      .filter((f) => f.gb === 0 && f.gk === 1)
      .map((f) => ({ branchId: f.branchId!, ...shape(f) }))
      .sort((a, b) => (a.currency !== b.currency ? (a.currency < b.currency ? -1 : 1) : a.branchId < b.branchId ? -1 : 1)),
    incompleteCostRows: flags[0]?.nulls ?? 0,
    mixedCurrencyRows: flags[0]?.mixed ?? 0,
    excluded: excluded.map((e) => ({ currency: e.cur, netMinor: money(e.net) })).sort((a, b) => (a.currency < b.currency ? -1 : 1)),
    rows: page,
    hasMore: more,
    nextCursor: more && last ? encodeCursor({ cur: last.currency, net: BigInt(last.netMinor), key: last.key }) : null,
  };
}
