/* eslint-disable no-restricted-properties -- read-only aggregates: every statement below is bound to the actor's restaurantId and branch ids, and none of them writes */
import type { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import type { ScopedClient } from '@/server/data/tenant-db';
import { marginBp } from '@/server/domain/pharmacy/reports-domain';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { mayViewCost } from './products';
import { currencyFilter, dayOf, money, pageRows, profitOf, scopeOf, SOLD, stamp, windowOf, type Currency } from './reports-common';
import type { MarginGroup, marginInput } from './reports-inputs';

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
  /** Per branch and currency, with the left-out allocations of that branch and currency. */
  byBranch: Array<MarginTotals & { branchId: string; incompleteCostRows: number; mixedCurrencyRows: number }>;
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
    scoped.$queryRaw<Array<{ cur: Currency; branchId: string; nulls: number; mixed: number }>>(Prisma.sql`
      ${base}
      SELECT sold."cur"::text AS "cur", sold."branchId", SUM(lc."nulls")::int AS "nulls", SUM(lc."mixed")::int AS "mixed"
      FROM lc JOIN sold ON sold."lineId" = lc."lineId" WHERE true ${currencyFilter(Prisma.sql`sold."cur"`, input.currency)}
      GROUP BY sold."cur", sold."branchId"`),
    scoped.$queryRaw<Array<{ cur: Currency; net: bigint }>>(Prisma.sql`
      ${base}
      SELECT x."cur"::text AS "cur", SUM(x."net")::bigint AS "net" FROM x WHERE NOT x."ok" ${cur} GROUP BY x."cur"`),
  ]);
  const shape = (f: MarginFact): MarginTotals => {
    const bpv = marginBp(f.net, f.cost);
    return { currency: f.cur, netMinor: money(f.net), costMinor: money(f.cost), marginMinor: money(f.net - f.cost), marginBp: bpv === null ? null : Number(bpv) };
  };
  // One row per branch and currency that sold anything: with the counts of its own left-out allocations (a branch whose every line was
  // left out still shows, with no margin and the counts that say why).
  const branchRows = new Map<string, MarginReport['byBranch'][number]>();
  for (const f of facts.filter((x) => x.gb === 0 && x.gk === 1)) branchRows.set(`${f.branchId}|${f.cur}`, { branchId: f.branchId!, ...shape(f), incompleteCostRows: 0, mixedCurrencyRows: 0 });
  for (const f of flags) {
    const row = branchRows.get(`${f.branchId}|${f.cur}`) ?? { branchId: f.branchId, ...shape({ gb: 0, gk: 1, cur: f.cur, branchId: f.branchId, k: null, net: 0n, cost: 0n }), incompleteCostRows: 0, mixedCurrencyRows: 0 };
    row.incompleteCostRows = f.nulls;
    row.mixedCurrencyRows = f.mixed;
    branchRows.set(`${f.branchId}|${f.cur}`, row);
  }
  const byBranch = [...branchRows.values()].sort((a, b) => (a.currency !== b.currency ? (a.currency < b.currency ? -1 : 1) : a.branchId < b.branchId ? -1 : 1));
  const rowsAll = facts.filter((f) => f.gb === 1 && f.gk === 0).map((f) => ({ key: f.k ?? '', ...shape(f) }));
  const { page, hasMore, nextCursor } = pageRows(rowsAll, { groupBy: input.groupBy, cursor: input.cursor, take: input.take, byKey: input.groupBy === 'day' });
  return {
    from: input.from,
    to: input.to,
    groupBy: input.groupBy,
    estimated: true,
    totals: facts.filter((f) => f.gb === 1 && f.gk === 1).map(shape).sort((a, b) => (a.currency < b.currency ? -1 : 1)),
    byBranch,
    incompleteCostRows: flags.reduce((n, f) => n + f.nulls, 0),
    mixedCurrencyRows: flags.reduce((n, f) => n + f.mixed, 0),
    excluded: excluded.map((e) => ({ currency: e.cur, netMinor: money(e.net) })).sort((a, b) => (a.currency < b.currency ? -1 : 1)),
    rows: page,
    hasMore,
    nextCursor,
  };
}

