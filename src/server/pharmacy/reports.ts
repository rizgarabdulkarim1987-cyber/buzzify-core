/* eslint-disable no-restricted-properties -- read-only aggregates: every statement below is bound to the actor's restaurantId and branch ids, and none of them writes */
import type { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import type { ScopedClient } from '@/server/data/tenant-db';
import { bpOf, type ReportWindow } from '@/server/domain/pharmacy/reports-domain';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { currencyFilter, dayOf, money, pageRows, scopeOf, SOLD, stamp, windowOf, type Currency, type Scope } from './reports-common';
import type { discountsInput, returnsInput, SalesGroup, salesInput, MarginGroup } from './reports-inputs';

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
  /** Day, branch and user rows: sales per sale. Product and category rows: the product's sales per sale that contains it (not a ticket). Method rows: null; and their ''refundsMinor'' is ''0'': a refund is not attributed to the method a sale was paid with (a return has its own refund method, see the returns report). */
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
  const lineRows = saleLevel || input.groupBy === 'method' ? Promise.resolve([] as LineGroupRow[]) : lineGroups(scoped, scope, w, input.groupBy as 'product' | 'category', input.currency);
  const [grouped, lines, paid] = await Promise.all([groupedFacts(scoped, facts, saleLevel, null), lineRows, paymentsByMethod(scoped, scope, w, input.currency)]);
  const pays = paid.map((payment) => Object.fromEntries(Object.entries(payment).filter(([key]) => key !== 'sales')) as Omit<(typeof paid)[number], 'sales'>);

  const totals = grouped.filter((r) => r.gb === 1 && r.gk === 1).map(totalsOf);
  const byBranch = grouped.filter((r) => r.gb === 0 && r.gk === 1).map((r) => ({ ...totalsOf(r), branchId: r.branchId! }));
  let rows: SalesRowView[];
  if (saleLevel) {
    rows = grouped.filter((r) => r.gb === 1 && r.gk === 0).map((r) => rowOf(r, true));
  } else if (input.groupBy === 'method') {
    // The rows of the method grouping ARE the payments of the window (one aggregate, shared with the `payments` list).
    rows = paid.map((p) => ({ key: p.method, currency: p.currency, count: p.sales, grossMinor: p.amountMinor, discountMinor: '0', salesMinor: p.amountMinor, refundsMinor: '0', netMinor: p.amountMinor, avgTicketMinor: null }));
  } else {
    rows = lines;
  }
  totals.sort((a, b) => (a.currency < b.currency ? -1 : 1));
  byBranch.sort((a, b) => (a.currency !== b.currency ? (a.currency < b.currency ? -1 : 1) : a.branchId < b.branchId ? -1 : 1));
  const { page, hasMore, nextCursor } = pageRows(rows, { groupBy: input.groupBy, cursor: input.cursor, take: input.take, byKey: input.groupBy === 'day' });
  return {
    from: input.from,
    to: input.to,
    groupBy: input.groupBy,
    note: 'returns-on-their-own-date',
    totals,
    byBranch,
    payments: pays,
    rows: page,
    hasMore,
    nextCursor,
  };
}

type LineGroupRow = SalesRowView;

/** Product and category groupings: line-level facts, since a sale is not one product (the payment-method grouping is payment-level and comes from `paymentsByMethod`). */
async function lineGroups(scoped: ScopedClient, scope: Scope, w: ReportWindow, group: 'product' | 'category', currency: Currency | undefined): Promise<LineGroupRow[]> {
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

/** The payments of the sold sales of the window by method and currency, cash net of the change given; `sales` counts the sales paid that way. */
async function paymentsByMethod(scoped: ScopedClient, scope: Scope, w: ReportWindow, currency: Currency | undefined): Promise<Array<SalesReport['payments'][number] & { sales: number }>> {
  const [rows, change] = await Promise.all([
    scoped.$queryRaw<Array<{ cur: Currency; method: SalesReport['payments'][number]['method']; n: number; sales: number; amount: bigint }>>(Prisma.sql`
      SELECT p."currency"::text AS "cur", p."method"::text AS "method", COUNT(*)::int AS "n", COUNT(DISTINCT s."id")::int AS "sales", SUM(p."amountMinor")::bigint AS "amount"
      FROM "PhPayment" p JOIN "PhSale" s ON s."restaurantId" = p."restaurantId" AND s."id" = p."saleId"
      WHERE s."restaurantId" = ${scope.restaurantId} AND s."branchId" = ANY(${scope.branchIds}::text[]) AND s."status"::text IN ${SOLD}
        AND s."completedAt" >= ${stamp(w.start)} AND s."completedAt" < ${stamp(w.endExclusive)} ${currencyFilter(Prisma.sql`s."currency"`, currency)}
      GROUP BY p."currency", p."method"`),
    changeByCurrency(scoped, scope, w, currency),
  ]);
  return rows
    .map((r) => ({ currency: r.cur, method: r.method, amountMinor: money(r.method === 'CASH' ? r.amount - (change.get(r.cur) ?? 0n) : r.amount), count: r.n, sales: r.sales }))
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
  /** Above the business's current maximum discount, judged on the exact money (`discount x 10000 > gross x limit in basis points`, the sale's own rule) against today's setting; `discountBp` is the rounded display figure. */
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
    scoped.$queryRaw<Array<{ id: string; number: string | null; branchId: string; soldById: string; currency: Currency; gross: bigint; disc: bigint; over: boolean; completedAt: Date }>>(Prisma.sql`
      SELECT s."id", s."number", s."branchId", s."soldById", s."currency"::text AS "currency", s."subtotalMinor" AS "gross", s."discountMinor" AS "disc", s."completedAt",
             COALESCE(s."discountMinor" * 10000 > s."subtotalMinor" * (SELECT "maxDiscountPercent" * 100 FROM "PhSettings" WHERE "restaurantId" = s."restaurantId"), false) AS "over"
      FROM "PhSale" s WHERE ${where} AND s."discountMinor" > 0 ${after} ORDER BY s."completedAt" DESC, s."id" DESC LIMIT ${input.take + 1}`),
    scoped.$queryRaw<Array<{ gb: number; cur: Currency; branchId: string | null; n: number; dn: number; gross: bigint; disc: bigint }>>(Prisma.sql`
      SELECT GROUPING(s."branchId")::int AS "gb", s."currency"::text AS "cur", s."branchId", COUNT(*)::int AS "n", (COUNT(*) FILTER (WHERE s."discountMinor" > 0))::int AS "dn",
             SUM(s."subtotalMinor")::bigint AS "gross", SUM(s."discountMinor")::bigint AS "disc"
      FROM "PhSale" s WHERE ${where} GROUP BY GROUPING SETS ((s."currency"), (s."currency", s."branchId"))`),
    // The ten biggest givers of each currency (rank inside the currency: IQD minor units would crowd USD ones out of one list).
    scoped.$queryRaw<Array<{ userId: string; userName: string | null; cur: Currency; dn: number; disc: bigint; gross: bigint }>>(Prisma.sql`
      SELECT t."userId", t."userName", t."cur", t."dn", t."disc", t."gross" FROM (
        SELECT s."soldById" AS "userId", u."name" AS "userName", s."currency"::text AS "cur", COUNT(*)::int AS "dn", SUM(s."discountMinor")::bigint AS "disc", SUM(s."subtotalMinor")::bigint AS "gross",
               ROW_NUMBER() OVER (PARTITION BY s."currency" ORDER BY SUM(s."discountMinor") DESC, s."soldById") AS "rk"
        FROM "PhSale" s LEFT JOIN "user" u ON u."id" = s."soldById" WHERE ${where} AND s."discountMinor" > 0
        GROUP BY s."soldById", u."name", s."currency"
      ) t WHERE t."rk" <= 10 ORDER BY t."cur", t."rk"`),
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
        overLimit: r.over,
        completedAt: r.completedAt.toISOString(),
      };
    }),
    hasMore: more,
    nextCursor: more ? page[page.length - 1]!.id : null,
  };
}

