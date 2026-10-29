/* eslint-disable no-restricted-properties -- read-only aggregates: every statement below is bound to the actor's restaurantId and branch ids, and none of them writes */
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import type { ScopedClient } from '@/server/data/tenant-db';
import { expiryBand, utcToday, type ExpiryBand } from '@/server/domain/pharmacy/expiry';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { expiryInput, listExpiry, type ExpiryRow, type ExpiryTotals } from './expiry';
import { mayViewCost } from './products';
import { money, pagingShape, periodShape, scopeOf, stamp, windowOf, type Currency, type Scope } from './reports';

/**
 * Pharmacy reports, part 2: stock valuation, expiry, damaged and lost stock, transfers and low stock (phase 6, task 4; R6-7).
 * Same rules as `reports.ts`: read-only SQL, the actor's branches, one currency per money total, `byBranch` taken from the
 * same facts as `totals` (GROUPING SETS), cost keys present only with `cost.view`.
 *
 * The cost rule is the sale snapshot's (`costOfBaseQty`): a batch cost is for `costUnit.baseQty` base units, so `n` units are
 * worth `floor(unitCost x n / per)`, floored per stock row, and `SUM` adds the floors. A batch with no cost (or no cost unit) is
 * never valued as zero: it is counted (`noCostRows`) and the valuation says it is incomplete.
 */

const idText = z.string().min(1).max(64);
const DAY_MS = 86_400_000;

export const VALUATION_GROUPS = ['branch', 'category', 'product'] as const;
export type ValuationGroup = (typeof VALUATION_GROUPS)[number];
export const valuationInput = z.object({ groupBy: z.enum(VALUATION_GROUPS, 'Choose how to group').default('branch'), categoryId: idText.optional(), ...pagingShape });
export type ValuationInput = z.input<typeof valuationInput>;
export const expiryReportInput = z.object({ cursor: z.string().min(1).max(800).nullish(), take: z.number().int().min(1).max(100).default(50) });
export type ExpiryReportInput = z.input<typeof expiryReportInput>;
export const damagedInput = z.object({ ...periodShape });
export type DamagedInput = z.input<typeof damagedInput>;
export const TRANSFER_STATUSES = ['REQUESTED', 'SENT', 'RECEIVED', 'PARTIAL', 'CANCELLED'] as const;
export const transfersReportInput = z.object({ ...periodShape, status: z.enum(TRANSFER_STATUSES, 'Choose a status').optional(), ...pagingShape });
export type TransfersReportInput = z.input<typeof transfersReportInput>;
export const lowStockInput = z.object({ cursor: z.string().min(1).max(400).nullish(), take: z.number().int().min(1).max(500).default(100) });
export type LowStockInput = z.input<typeof lowStockInput>;

/** `n` units of a stock row's batch at its cost, floored (the sale snapshot's rule); needs the aliases `b` (batch) and `cu` (its cost unit). */
const valueOf = (units: Prisma.Sql) => Prisma.sql`floor(b."unitCostMinor"::numeric * (${units}) / cu."baseQty")::bigint`;
const HAS_COST = Prisma.sql`b."unitCostMinor" IS NOT NULL AND b."costCurrency" IS NOT NULL AND cu."baseQty" IS NOT NULL`;
const sortBy = <T>(rows: T[], ...keys: Array<(r: T) => string>) =>
  rows.sort((a, b) => {
    for (const key of keys) {
      const x = key(a);
      const y = key(b);
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  });

// Stock valuation --------------------------------------------------------------------------------------------------------

export interface Buckets {
  available: number;
  reserved: number;
  quarantine: number;
  damaged: number;
}

export interface ValueView {
  currency: Currency;
  /** Available + reserved + quarantine at batch cost. */
  valueMinor: string;
  /** Damaged stock at batch cost: shown, and not in `valueMinor`. */
  damagedValueMinor: string;
}

export interface ValuationRow extends Buckets {
  key: string;
  label: string;
  /** Cost keys, only with `cost.view`. */
  noCostRows?: number;
  valuationComplete?: boolean;
  values?: ValueView[];
}

export interface ValuationReport {
  groupBy: ValuationGroup;
  asOf: 'now';
  /** Which buckets the value counts (ruling R6-12a). */
  valued: ['available', 'reserved', 'quarantine'];
  totals: Buckets & { noCostRows?: number; valuationComplete?: boolean; values?: ValueView[] };
  byBranch: Array<Buckets & { branchId: string; noCostRows?: number; values?: ValueView[] }>;
  /** Goods sent and not yet received, shown apart from on-hand: units by destination, and (with `cost.view`) their value. */
  inTransit: { units: number; transfers: number; byDestination: Array<{ branchId: string; units: number }>; values?: Array<{ currency: Currency; valueMinor: string }> };
  rows: ValuationRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

interface QtyFact extends Buckets {
  gb: number;
  gk: number;
  branchId: string | null;
  k: string | null;
  label: string | null;
  nocost: number;
}
interface ValueFact {
  gb: number;
  gk: number;
  cur: Currency;
  branchId: string | null;
  k: string | null;
  value: bigint;
  damaged: bigint;
}

export async function stockValuation(scoped: ScopedClient, ph: PhActor, place: { branchId?: string | undefined }, input: z.infer<typeof valuationInput>): Promise<ValuationReport> {
  const scope = scopeOf(ph, place.branchId);
  const withCost = mayViewCost(ph);
  const key =
    input.groupBy === 'product' ? Prisma.sql`sb."productId"` : input.groupBy === 'category' ? Prisma.sql`COALESCE(pr."categoryId", '')` : Prisma.sql`(sb."branchId" || '')`;
  const label =
    input.groupBy === 'product' ? Prisma.sql`pr."tradeName"` : input.groupBy === 'category' ? Prisma.sql`COALESCE(c."name", '')` : Prisma.sql`br."name"`;
  const bal = Prisma.sql`
    FROM "PhStockBalance" sb
      JOIN "PhBatch" b ON b."restaurantId" = sb."restaurantId" AND b."id" = sb."batchId"
      JOIN "PhProduct" pr ON pr."restaurantId" = sb."restaurantId" AND pr."id" = sb."productId"
      JOIN "Branch" br ON br."restaurantId" = sb."restaurantId" AND br."id" = sb."branchId"
      LEFT JOIN "PhCategory" c ON c."restaurantId" = pr."restaurantId" AND c."id" = pr."categoryId"
      LEFT JOIN "PhProductUnit" cu ON cu."productId" = b."productId" AND cu."id" = b."costUnitId"
    WHERE sb."restaurantId" = ${scope.restaurantId} AND sb."branchId" = ANY(${scope.branchIds}::text[])
      AND (sb."available" + sb."reserved" + sb."quarantine" + sb."damaged") > 0
      ${input.categoryId ? Prisma.sql`AND pr."categoryId" = ${input.categoryId}` : Prisma.empty}`;
  const valued = Prisma.sql`(sb."available" + sb."reserved" + sb."quarantine")`;
  const [qty, values, transit] = await Promise.all([
    scoped.$queryRaw<QtyFact[]>(Prisma.sql`
      SELECT GROUPING(sb."branchId")::int AS "gb", GROUPING(${key})::int AS "gk", sb."branchId", ${key} AS "k", MIN(${label}) AS "label",
             SUM(sb."available")::int AS "available", SUM(sb."reserved")::int AS "reserved", SUM(sb."quarantine")::int AS "quarantine", SUM(sb."damaged")::int AS "damaged",
             (COUNT(*) FILTER (WHERE NOT (${HAS_COST}) AND ${valued} > 0))::int AS "nocost"
      ${bal}
      GROUP BY GROUPING SETS ((), (sb."branchId"), (${key}))`),
    withCost
      ? scoped.$queryRaw<ValueFact[]>(Prisma.sql`
          SELECT GROUPING(sb."branchId")::int AS "gb", GROUPING(${key})::int AS "gk", b."costCurrency"::text AS "cur", sb."branchId", ${key} AS "k",
                 COALESCE(SUM(${valueOf(valued)}), 0)::bigint AS "value", COALESCE(SUM(${valueOf(Prisma.sql`sb."damaged"`)}), 0)::bigint AS "damaged"
          ${bal} AND ${HAS_COST}
          GROUP BY GROUPING SETS ((b."costCurrency"), (b."costCurrency", sb."branchId"), (b."costCurrency", ${key}))`)
      : Promise.resolve([] as ValueFact[]),
    inTransitNow(scoped, scope, withCost, input.categoryId),
  ]);

  const valueViews = (rows: ValueFact[]): ValueView[] =>
    sortBy(rows.map((v) => ({ currency: v.cur, valueMinor: money(v.value), damagedValueMinor: money(v.damaged) })), (r) => r.currency);
  const total = qty.find((q) => q.gb === 1 && q.gk === 1);
  const zero: Buckets = { available: 0, reserved: 0, quarantine: 0, damaged: 0 };
  const buckets = (q: Buckets): Buckets => ({ available: q.available, reserved: q.reserved, quarantine: q.quarantine, damaged: q.damaged });
  const totals: ValuationReport['totals'] = { ...(total ? buckets(total) : zero) };
  if (withCost) {
    totals.noCostRows = total?.nocost ?? 0;
    totals.valuationComplete = (total?.nocost ?? 0) === 0;
    totals.values = valueViews(values.filter((v) => v.gb === 1 && v.gk === 1));
  }
  const byBranch = sortBy(
    qty
      .filter((q) => q.gb === 0 && q.gk === 1)
      .map((q) => ({
        branchId: q.branchId!,
        ...buckets(q),
        ...(withCost ? { noCostRows: q.nocost, values: valueViews(values.filter((v) => v.gb === 0 && v.gk === 1 && v.branchId === q.branchId)) } : {}),
      })),
    (r) => r.branchId,
  );
  const all = sortBy(
    qty
      .filter((q) => q.gb === 1 && q.gk === 0)
      .map((q): ValuationRow => ({
        key: q.k ?? '',
        label: q.label ?? '',
        ...buckets(q),
        ...(withCost
          ? { noCostRows: q.nocost, valuationComplete: q.nocost === 0, values: valueViews(values.filter((v) => v.gb === 1 && v.gk === 0 && (v.k ?? '') === (q.k ?? ''))) }
          : {}),
      })),
    (r) => r.key,
  );
  const found = input.cursor ? all.findIndex((r) => r.key > input.cursor!) : 0;
  const begin = found < 0 ? all.length : found;
  const page = all.slice(begin, begin + input.take);
  const more = begin + input.take < all.length;
  return {
    groupBy: input.groupBy,
    asOf: 'now',
    valued: ['available', 'reserved', 'quarantine'],
    totals,
    byBranch,
    inTransit: transit,
    rows: page,
    hasMore: more,
    nextCursor: more ? page[page.length - 1]!.key : null,
  };
}

/** What is on the road now: the sent lines of SENT transfers that touch the actor's branches, `sent - received - damaged - lost` (R6-2). */
async function inTransitNow(scoped: ScopedClient, scope: Scope, withCost: boolean, categoryId: string | undefined): Promise<ValuationReport['inTransit']> {
  const from = Prisma.sql`
    FROM "PhTransferLine" l
      JOIN "PhTransfer" t ON t."restaurantId" = l."restaurantId" AND t."id" = l."transferId"
      JOIN "PhBatch" b ON b."restaurantId" = l."restaurantId" AND b."id" = l."batchId"
      JOIN "PhProduct" pr ON pr."restaurantId" = l."restaurantId" AND pr."id" = l."productId"
      LEFT JOIN "PhProductUnit" cu ON cu."productId" = b."productId" AND cu."id" = b."costUnitId"
    WHERE t."restaurantId" = ${scope.restaurantId} AND t."status" = 'SENT' AND l."requestLineId" IS NOT NULL
      AND (t."fromBranchId" = ANY(${scope.branchIds}::text[]) OR t."toBranchId" = ANY(${scope.branchIds}::text[]))
      ${categoryId ? Prisma.sql`AND pr."categoryId" = ${categoryId}` : Prisma.empty}`;
  const left = Prisma.sql`GREATEST(l."sentQty" - l."receivedQty" - l."damagedQty" - l."lostQty", 0)`;
  const [units, values] = await Promise.all([
    scoped.$queryRaw<Array<{ branchId: string; units: number; transfers: number }>>(Prisma.sql`
      SELECT t."toBranchId" AS "branchId", SUM(${left})::int AS "units", COUNT(DISTINCT t."id")::int AS "transfers" ${from} GROUP BY t."toBranchId"`),
    withCost
      ? scoped.$queryRaw<Array<{ cur: Currency; value: bigint }>>(Prisma.sql`
          SELECT b."costCurrency"::text AS "cur", COALESCE(SUM(${valueOf(left)}), 0)::bigint AS "value" ${from} AND ${HAS_COST} GROUP BY b."costCurrency"`)
      : Promise.resolve([] as Array<{ cur: Currency; value: bigint }>),
  ]);
  const all = await scoped.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT COUNT(DISTINCT t."id")::int AS "n" ${from}`);
  return {
    units: units.reduce((s, r) => s + r.units, 0),
    transfers: all[0]?.n ?? 0,
    byDestination: sortBy(units.map((u) => ({ branchId: u.branchId, units: u.units })), (r) => r.branchId),
    ...(withCost ? { values: sortBy(values.map((v) => ({ currency: v.cur, valueMinor: money(v.value) })), (r) => r.currency) } : {}),
  };
}

// Expiry -----------------------------------------------------------------------------------------------------------------

export const EXPIRY_REPORT_BANDS = ['expired', 'd30', 'd60', 'd90'] as const;
export type ExpiryReportBand = (typeof EXPIRY_REPORT_BANDS)[number];

export interface ExpiryBandTotals {
  band: ExpiryReportBand;
  /** Stock rows (batch x branch) in the band. */
  rows: number;
  /** Available + reserved + quarantine units. */
  units: number;
  noCostRows?: number;
  values?: Array<{ currency: Currency; valueMinor: string }>;
}

export interface ExpiryReport {
  /** `d30` is up to 30 days, `d60` 31 to 60, `d90` 61 to 90 (a month-precision batch alerts from the start of its month). */
  days: 90;
  totals: ExpiryBandTotals[];
  byBranch: Array<{ branchId: string; bands: ExpiryBandTotals[] }>;
  /** The phase 2 list's own counts, from `listExpiry`. */
  listTotals: ExpiryTotals;
  items: ExpiryRow[];
  nextCursor: string | null;
}

export async function expiryReport(scoped: ScopedClient, ph: PhActor, place: { branchId?: string | undefined }, input: z.infer<typeof expiryReportInput>): Promise<ExpiryReport> {
  const scope = scopeOf(ph, place.branchId);
  const withCost = mayViewCost(ph);
  const today = utcToday();
  const reach = new Date(new Date(`${today}T00:00:00.000Z`).getTime() + (90 + 31) * DAY_MS);
  const [list, groups] = await Promise.all([
    // The list, its rows and its counts, are the phase 2 service's: not rebuilt here.
    listExpiry(scoped, ph, { ...expiryInput.parse({ days: 90, includeExpired: true, pageSize: input.take, cursor: input.cursor ?? null }), ...(place.branchId ? { branchId: place.branchId } : {}) }),
    scoped.$queryRaw<Array<{ branchId: string; expiryDate: Date; precision: 'DAY' | 'MONTH'; rows: number; units: number; nocost: number; cur: Currency | null; value: bigint }>>(Prisma.sql`
      SELECT sb."branchId", b."expiryDate", b."expiryPrecision"::text AS "precision", COUNT(*)::int AS "rows", SUM(sb."available" + sb."reserved" + sb."quarantine")::int AS "units",
             (COUNT(*) FILTER (WHERE NOT (${HAS_COST})))::int AS "nocost", b."costCurrency"::text AS "cur",
             COALESCE(SUM(${valueOf(Prisma.sql`sb."available" + sb."reserved" + sb."quarantine"`)}) FILTER (WHERE ${HAS_COST}), 0)::bigint AS "value"
      FROM "PhStockBalance" sb
        JOIN "PhBatch" b ON b."restaurantId" = sb."restaurantId" AND b."id" = sb."batchId"
        LEFT JOIN "PhProductUnit" cu ON cu."productId" = b."productId" AND cu."id" = b."costUnitId"
      WHERE sb."restaurantId" = ${scope.restaurantId} AND sb."branchId" = ANY(${scope.branchIds}::text[])
        AND (sb."available" > 0 OR sb."reserved" > 0 OR sb."quarantine" > 0) AND b."expiryDate" <= ${reach.toISOString().slice(0, 10)}::date
      GROUP BY sb."branchId", b."expiryDate", b."expiryPrecision", b."costCurrency"`),
  ]);

  type Acc = { rows: number; units: number; nocost: number; values: Map<Currency, bigint> };
  const blank = (): Acc => ({ rows: 0, units: 0, nocost: 0, values: new Map() });
  const perBranch = new Map<string, Map<ExpiryReportBand, Acc>>();
  const overall = new Map<ExpiryReportBand, Acc>();
  for (const g of groups) {
    const band: ExpiryBand = expiryBand({ expiryDate: g.expiryDate.toISOString().slice(0, 10), expiryPrecision: g.precision }, today);
    if (band === 'ok' || band === 'd180') continue;
    const branch = perBranch.get(g.branchId) ?? new Map<ExpiryReportBand, Acc>();
    perBranch.set(g.branchId, branch);
    const b = branch.get(band) ?? blank();
    const o = overall.get(band) ?? blank();
    branch.set(band, b);
    overall.set(band, o);
    for (const acc of [b, o]) {
      acc.rows += g.rows;
      acc.units += g.units;
      acc.nocost += g.nocost;
      if (g.cur !== null) acc.values.set(g.cur, (acc.values.get(g.cur) ?? 0n) + g.value);
    }
  }
  const view = (band: ExpiryReportBand, acc: Acc | undefined): ExpiryBandTotals => ({
    band,
    rows: acc?.rows ?? 0,
    units: acc?.units ?? 0,
    ...(withCost
      ? {
          noCostRows: acc?.nocost ?? 0,
          values: sortBy([...(acc?.values.entries() ?? [])].map(([currency, v]) => ({ currency, valueMinor: money(v) })), (r) => r.currency),
        }
      : {}),
  });
  return {
    days: 90,
    totals: EXPIRY_REPORT_BANDS.map((band) => view(band, overall.get(band))),
    byBranch: sortBy(
      [...perBranch.entries()].map(([branchId, bands]) => ({ branchId, bands: EXPIRY_REPORT_BANDS.map((band) => view(band, bands.get(band))) })),
      (r) => r.branchId,
    ),
    listTotals: list.totals,
    items: list.items,
    nextCursor: list.nextCursor,
  };
}

// Damaged, quarantined and lost ------------------------------------------------------------------------------------------

export interface DamagedReport {
  from: string;
  to: string;
  /** Stock in the DAMAGED and QUARANTINE buckets now. */
  current: {
    totals: { damaged: number; quarantine: number; noCostRows?: number; values?: Array<{ currency: Currency; damagedValueMinor: string; quarantineValueMinor: string }> };
    byBranch: Array<{ branchId: string; damaged: number; quarantine: number }>;
  };
  /** Units written off in the range by ledger type: DAMAGE (into damaged), ADJUST and SUPPLIER_RETURN (net units taken out). */
  movements: {
    totals: Array<{ type: 'DAMAGE' | 'ADJUST' | 'SUPPLIER_RETURN'; units: number; values?: Array<{ currency: Currency; valueMinor: string }> }>;
    byBranch: Array<{ branchId: string; type: 'DAMAGE' | 'ADJUST' | 'SUPPLIER_RETURN'; units: number }>;
    reasons: Array<{ type: 'DAMAGE' | 'ADJUST' | 'SUPPLIER_RETURN'; reason: string; units: number }>;
  };
  /** Transfers received in the range: what did not arrive. */
  transfers: {
    totals: { lostQty: number; damagedQty: number; values?: Array<{ currency: Currency; lostValueMinor: string; damagedValueMinor: string }> };
    byRoute: Array<{ fromBranchId: string; toBranchId: string; lostQty: number; damagedQty: number }>;
    byReason: Array<{ reason: 'LOST' | 'OTHER'; lostQty: number }>;
  };
}

export async function damagedReport(scoped: ScopedClient, ph: PhActor, place: { branchId?: string | undefined }, input: z.infer<typeof damagedInput>): Promise<DamagedReport> {
  const scope = scopeOf(ph, place.branchId);
  const w = windowOf(input.from, input.to);
  const withCost = mayViewCost(ph);
  const branchOf = (col: string) => Prisma.sql`${Prisma.raw(col)} = ANY(${scope.branchIds}::text[])`;
  const costJoin = Prisma.sql`JOIN "PhBatch" b ON b."restaurantId" = x."restaurantId" AND b."id" = x."batchId" LEFT JOIN "PhProductUnit" cu ON cu."productId" = b."productId" AND cu."id" = b."costUnitId"`;
  // A ledger row's size: DAMAGE adds to damaged; ADJUST and SUPPLIER_RETURN take units out (a reversal nets against them).
  const size = Prisma.sql`CASE WHEN x."type" = 'DAMAGE' THEN x."damagedDelta" ELSE -(x."availableDelta" + x."reservedDelta" + x."quarantineDelta" + x."damagedDelta") END`;
  const ledger = Prisma.sql`FROM "PhStockMovement" x WHERE x."restaurantId" = ${scope.restaurantId} AND ${branchOf('x."branchId"')} AND x."type"::text IN ('DAMAGE', 'ADJUST', 'SUPPLIER_RETURN')
    AND x."createdAt" >= ${stamp(w.start)} AND x."createdAt" < ${stamp(w.endExclusive)}`;
  const lines = Prisma.sql`FROM "PhTransferLine" x JOIN "PhTransfer" t ON t."restaurantId" = x."restaurantId" AND t."id" = x."transferId"
    WHERE t."restaurantId" = ${scope.restaurantId} AND t."status"::text IN ('RECEIVED', 'PARTIAL') AND x."requestLineId" IS NOT NULL
      AND (${branchOf('t."fromBranchId"')} OR ${branchOf('t."toBranchId"')}) AND t."receivedAt" >= ${stamp(w.start)} AND t."receivedAt" < ${stamp(w.endExclusive)}`;
  const empty = Promise.resolve([] as never[]);

  const [cur, curValue, moveQty, moveValue, reasons, tQty, tRoute, tReason, tValue] = await Promise.all([
    scoped.$queryRaw<Array<{ gb: number; branchId: string | null; damaged: number; quarantine: number; nocost: number }>>(Prisma.sql`
      SELECT GROUPING(x."branchId")::int AS "gb", x."branchId", SUM(x."damaged")::int AS "damaged", SUM(x."quarantine")::int AS "quarantine",
             (COUNT(*) FILTER (WHERE NOT (${HAS_COST}) AND (x."damaged" + x."quarantine") > 0))::int AS "nocost"
      FROM "PhStockBalance" x JOIN "PhBatch" b ON b."restaurantId" = x."restaurantId" AND b."id" = x."batchId" LEFT JOIN "PhProductUnit" cu ON cu."productId" = b."productId" AND cu."id" = b."costUnitId"
      WHERE x."restaurantId" = ${scope.restaurantId} AND ${branchOf('x."branchId"')} AND (x."damaged" > 0 OR x."quarantine" > 0)
      GROUP BY GROUPING SETS ((), (x."branchId"))`),
    withCost
      ? scoped.$queryRaw<Array<{ cur: Currency; damaged: bigint; quarantine: bigint }>>(Prisma.sql`
          SELECT b."costCurrency"::text AS "cur", COALESCE(SUM(${valueOf(Prisma.sql`x."damaged"`)}), 0)::bigint AS "damaged", COALESCE(SUM(${valueOf(Prisma.sql`x."quarantine"`)}), 0)::bigint AS "quarantine"
          FROM "PhStockBalance" x ${costJoin}
          WHERE x."restaurantId" = ${scope.restaurantId} AND ${branchOf('x."branchId"')} AND (x."damaged" > 0 OR x."quarantine" > 0) AND ${HAS_COST} GROUP BY b."costCurrency"`)
      : empty,
    scoped.$queryRaw<Array<{ gb: number; branchId: string | null; type: 'DAMAGE' | 'ADJUST' | 'SUPPLIER_RETURN'; units: number }>>(Prisma.sql`
      SELECT GROUPING(x."branchId")::int AS "gb", x."branchId", x."type"::text AS "type", COALESCE(SUM(${size}), 0)::int AS "units"
      ${ledger} GROUP BY GROUPING SETS ((x."type"), (x."type", x."branchId"))`),
    withCost
      ? scoped.$queryRaw<Array<{ type: 'DAMAGE' | 'ADJUST' | 'SUPPLIER_RETURN'; cur: Currency; value: bigint }>>(Prisma.sql`
          SELECT x."type"::text AS "type", b."costCurrency"::text AS "cur",
                 COALESCE(SUM(CASE WHEN ${size} < 0 THEN -1 ELSE 1 END * floor(b."unitCostMinor"::numeric * abs(${size}) / cu."baseQty")::bigint), 0)::bigint AS "value"
          ${Prisma.sql`FROM "PhStockMovement" x`} ${costJoin}
          WHERE x."restaurantId" = ${scope.restaurantId} AND ${branchOf('x."branchId"')} AND x."type"::text IN ('DAMAGE', 'ADJUST', 'SUPPLIER_RETURN')
            AND x."createdAt" >= ${stamp(w.start)} AND x."createdAt" < ${stamp(w.endExclusive)} AND ${HAS_COST}
          GROUP BY x."type", b."costCurrency"`)
      : empty,
    scoped.$queryRaw<Array<{ type: 'DAMAGE' | 'ADJUST' | 'SUPPLIER_RETURN'; reason: string; units: number }>>(Prisma.sql`
      SELECT x."type"::text AS "type", x."reason", SUM(${size})::int AS "units" ${ledger} AND x."reason" <> ''
      GROUP BY x."type", x."reason" HAVING SUM(${size}) <> 0 ORDER BY ABS(SUM(${size})) DESC, x."type", x."reason" LIMIT 30`),
    scoped.$queryRaw<Array<{ lost: number; damaged: number }>>(Prisma.sql`SELECT COALESCE(SUM(x."lostQty"), 0)::int AS "lost", COALESCE(SUM(x."damagedQty"), 0)::int AS "damaged" ${lines}`),
    scoped.$queryRaw<Array<{ f: string; t: string; lost: number; damaged: number }>>(Prisma.sql`
      SELECT t."fromBranchId" AS "f", t."toBranchId" AS "t", SUM(x."lostQty")::int AS "lost", SUM(x."damagedQty")::int AS "damaged" ${lines}
      GROUP BY t."fromBranchId", t."toBranchId" HAVING SUM(x."lostQty") + SUM(x."damagedQty") > 0`),
    scoped.$queryRaw<Array<{ reason: 'LOST' | 'OTHER'; lost: number }>>(Prisma.sql`
      SELECT x."lostReason"::text AS "reason", SUM(x."lostQty")::int AS "lost" ${lines} AND x."lostQty" > 0 GROUP BY x."lostReason"`),
    withCost
      ? scoped.$queryRaw<Array<{ cur: Currency; lost: bigint; damaged: bigint }>>(Prisma.sql`
          SELECT b."costCurrency"::text AS "cur", COALESCE(SUM(${valueOf(Prisma.sql`x."lostQty"`)}), 0)::bigint AS "lost", COALESCE(SUM(${valueOf(Prisma.sql`x."damagedQty"`)}), 0)::bigint AS "damaged"
          FROM "PhTransferLine" x JOIN "PhTransfer" t ON t."restaurantId" = x."restaurantId" AND t."id" = x."transferId"
            JOIN "PhBatch" b ON b."restaurantId" = x."restaurantId" AND b."id" = x."batchId" LEFT JOIN "PhProductUnit" cu ON cu."productId" = b."productId" AND cu."id" = b."costUnitId"
          WHERE t."restaurantId" = ${scope.restaurantId} AND t."status"::text IN ('RECEIVED', 'PARTIAL') AND x."requestLineId" IS NOT NULL
            AND (${branchOf('t."fromBranchId"')} OR ${branchOf('t."toBranchId"')}) AND t."receivedAt" >= ${stamp(w.start)} AND t."receivedAt" < ${stamp(w.endExclusive)} AND ${HAS_COST}
          GROUP BY b."costCurrency"`)
      : empty,
  ]);

  const total = cur.find((r) => r.gb === 1);
  const types = ['DAMAGE', 'ADJUST', 'SUPPLIER_RETURN'] as const;
  return {
    from: input.from,
    to: input.to,
    current: {
      totals: {
        damaged: total?.damaged ?? 0,
        quarantine: total?.quarantine ?? 0,
        ...(withCost
          ? {
              noCostRows: total?.nocost ?? 0,
              values: sortBy(curValue.map((v) => ({ currency: v.cur, damagedValueMinor: money(v.damaged), quarantineValueMinor: money(v.quarantine) })), (r) => r.currency),
            }
          : {}),
      },
      byBranch: sortBy(
        cur.filter((r) => r.gb === 0).map((r) => ({ branchId: r.branchId!, damaged: r.damaged, quarantine: r.quarantine })),
        (r) => r.branchId,
      ),
    },
    movements: {
      totals: types.map((type) => ({
        type,
        units: moveQty.find((r) => r.gb === 1 && r.type === type)?.units ?? 0,
        ...(withCost ? { values: sortBy(moveValue.filter((v) => v.type === type).map((v) => ({ currency: v.cur, valueMinor: money(v.value) })), (r) => r.currency) } : {}),
      })),
      byBranch: sortBy(
        moveQty.filter((r) => r.gb === 0).map((r) => ({ branchId: r.branchId!, type: r.type, units: r.units })),
        (r) => r.branchId,
        (r) => r.type,
      ),
      reasons,
    },
    transfers: {
      totals: {
        lostQty: tQty[0]?.lost ?? 0,
        damagedQty: tQty[0]?.damaged ?? 0,
        ...(withCost ? { values: sortBy(tValue.map((v) => ({ currency: v.cur, lostValueMinor: money(v.lost), damagedValueMinor: money(v.damaged) })), (r) => r.currency) } : {}),
      },
      byRoute: sortBy(
        tRoute.map((r) => ({ fromBranchId: r.f, toBranchId: r.t, lostQty: r.lost, damagedQty: r.damaged })),
        (r) => r.fromBranchId,
        (r) => r.toBranchId,
      ),
      byReason: sortBy(tReason.map((r) => ({ reason: r.reason, lostQty: r.lost })), (r) => r.reason),
    },
  };
}

// Transfers --------------------------------------------------------------------------------------------------------------

export interface TransferReportRow {
  id: string;
  number: string | null;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  status: (typeof TRANSFER_STATUSES)[number];
  requestedAt: string;
  sentAt: string | null;
  receivedAt: string | null;
  requestedQty: number;
  sentQty: number;
  receivedQty: number;
  lostQty: number;
  damagedQty: number;
}

export interface TransfersReport {
  from: string;
  to: string;
  /** Transfers requested in the range that touch the actor's branches. `byBranch` counts them by sending branch, so it adds up to `total`. */
  total: number;
  byStatus: Array<{ status: (typeof TRANSFER_STATUSES)[number]; count: number }>;
  byBranch: Array<{ branchId: string; count: number }>;
  byRoute: Array<{ fromBranchId: string; toBranchId: string; status: (typeof TRANSFER_STATUSES)[number]; count: number }>;
  /** Sent and not received, now (not limited to the range), in units. */
  inTransit: { units: number; transfers: number; byRoute: Array<{ fromBranchId: string; toBranchId: string; units: number }> };
  lost: { lostQty: number; damagedQty: number; byReason: Array<{ reason: 'LOST' | 'OTHER'; lostQty: number }> };
  /** Mean time from sent to received over the received ones; null when none. */
  avgTransitSeconds: number | null;
  rows: TransferReportRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

export async function transfersReport(scoped: ScopedClient, ph: PhActor, place: { branchId?: string | undefined }, input: z.infer<typeof transfersReportInput>): Promise<TransfersReport> {
  const scope = scopeOf(ph, place.branchId);
  const w = windowOf(input.from, input.to);
  const touches = Prisma.sql`(t."fromBranchId" = ANY(${scope.branchIds}::text[]) OR t."toBranchId" = ANY(${scope.branchIds}::text[]))`;
  const base = Prisma.sql`t."restaurantId" = ${scope.restaurantId} AND ${touches} AND t."requestedAt" >= ${stamp(w.start)} AND t."requestedAt" < ${stamp(w.endExclusive)}
    ${input.status ? Prisma.sql`AND t."status"::text = ${input.status}` : Prisma.empty}`;
  let after = Prisma.empty;
  if (input.cursor) {
    const at = await scoped.$queryRaw<Array<{ requestedAt: Date }>>(Prisma.sql`SELECT t."requestedAt" FROM "PhTransfer" t WHERE t."id" = ${input.cursor} AND t."restaurantId" = ${scope.restaurantId} AND ${touches}`);
    if (!at[0]) throw new StudioError('INVALID', 'Check the highlighted fields', { cursor: 'This page of results is no longer available' });
    after = Prisma.sql`AND (t."requestedAt" < ${stamp(at[0].requestedAt)} OR (t."requestedAt" = ${stamp(at[0].requestedAt)} AND t."id" < ${input.cursor}))`;
  }
  const sentLines = Prisma.sql`l."requestLineId" IS NOT NULL`;
  const [groups, rows, open, lost, lostReasons, avg] = await Promise.all([
    scoped.$queryRaw<Array<{ g: number; status: TransfersReport['byStatus'][number]['status'] | null; f: string | null; t: string | null; n: number }>>(Prisma.sql`
      SELECT GROUPING(t."status", t."fromBranchId", t."toBranchId")::int AS "g", t."status"::text AS "status", t."fromBranchId" AS "f", t."toBranchId" AS "t", COUNT(*)::int AS "n"
      FROM "PhTransfer" t WHERE ${base}
      GROUP BY GROUPING SETS ((), (t."status"), (t."fromBranchId"), (t."fromBranchId", t."toBranchId", t."status"))`),
    scoped.$queryRaw<Array<Omit<TransferReportRow, 'requestedAt' | 'sentAt' | 'receivedAt'> & { requestedAt: Date; sentAt: Date | null; receivedAt: Date | null }>>(Prisma.sql`
      SELECT t."id", t."number", t."fromBranchId", fb."name" AS "fromBranchName", t."toBranchId", tb."name" AS "toBranchName", t."status"::text AS "status",
             t."requestedAt", t."sentAt", t."receivedAt",
             COALESCE(SUM(l."requestedQty"), 0)::int AS "requestedQty", COALESCE(SUM(l."sentQty"), 0)::int AS "sentQty", COALESCE(SUM(l."receivedQty"), 0)::int AS "receivedQty",
             COALESCE(SUM(l."lostQty"), 0)::int AS "lostQty", COALESCE(SUM(l."damagedQty"), 0)::int AS "damagedQty"
      FROM "PhTransfer" t JOIN "Branch" fb ON fb."restaurantId" = t."restaurantId" AND fb."id" = t."fromBranchId" JOIN "Branch" tb ON tb."restaurantId" = t."restaurantId" AND tb."id" = t."toBranchId"
        LEFT JOIN "PhTransferLine" l ON l."restaurantId" = t."restaurantId" AND l."transferId" = t."id"
      WHERE ${base} ${after}
      GROUP BY t."id", fb."name", tb."name" ORDER BY t."requestedAt" DESC, t."id" DESC LIMIT ${input.take + 1}`),
    scoped.$queryRaw<Array<{ f: string; t: string; units: number; transfers: number }>>(Prisma.sql`
      SELECT t."fromBranchId" AS "f", t."toBranchId" AS "t", SUM(GREATEST(l."sentQty" - l."receivedQty" - l."damagedQty" - l."lostQty", 0))::int AS "units", COUNT(DISTINCT t."id")::int AS "transfers"
      FROM "PhTransferLine" l JOIN "PhTransfer" t ON t."restaurantId" = l."restaurantId" AND t."id" = l."transferId"
      WHERE t."restaurantId" = ${scope.restaurantId} AND ${touches} AND t."status" = 'SENT' AND ${sentLines} GROUP BY t."fromBranchId", t."toBranchId"`),
    scoped.$queryRaw<Array<{ lost: number; damaged: number }>>(Prisma.sql`
      SELECT COALESCE(SUM(l."lostQty"), 0)::int AS "lost", COALESCE(SUM(l."damagedQty"), 0)::int AS "damaged"
      FROM "PhTransferLine" l JOIN "PhTransfer" t ON t."restaurantId" = l."restaurantId" AND t."id" = l."transferId" WHERE ${base} AND ${sentLines}`),
    scoped.$queryRaw<Array<{ reason: 'LOST' | 'OTHER'; lost: number }>>(Prisma.sql`
      SELECT l."lostReason"::text AS "reason", SUM(l."lostQty")::int AS "lost"
      FROM "PhTransferLine" l JOIN "PhTransfer" t ON t."restaurantId" = l."restaurantId" AND t."id" = l."transferId" WHERE ${base} AND ${sentLines} AND l."lostQty" > 0 GROUP BY l."lostReason"`),
    scoped.$queryRaw<Array<{ secs: bigint | null }>>(Prisma.sql`
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (t."receivedAt" - t."sentAt"))))::bigint AS "secs"
      FROM "PhTransfer" t WHERE ${base} AND t."status"::text IN ('RECEIVED', 'PARTIAL') AND t."sentAt" IS NOT NULL AND t."receivedAt" IS NOT NULL`),
  ]);
  const more = rows.length > input.take;
  const page = more ? rows.slice(0, input.take) : rows;
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    from: input.from,
    to: input.to,
    total: groups.find((g) => g.g === 7)?.n ?? 0,
    byStatus: sortBy(
      groups.filter((g) => g.g === 3 && g.status !== null).map((g) => ({ status: g.status!, count: g.n })),
      (r) => r.status,
    ),
    byBranch: sortBy(
      groups.filter((g) => g.g === 5 && g.f !== null).map((g) => ({ branchId: g.f!, count: g.n })),
      (r) => r.branchId,
    ),
    byRoute: sortBy(
      groups.filter((g) => g.g === 0).map((g) => ({ fromBranchId: g.f!, toBranchId: g.t!, status: g.status!, count: g.n })),
      (r) => r.fromBranchId,
      (r) => r.toBranchId,
      (r) => r.status,
    ),
    inTransit: {
      units: open.reduce((s, r) => s + r.units, 0),
      transfers: open.reduce((s, r) => s + r.transfers, 0),
      byRoute: sortBy(open.map((r) => ({ fromBranchId: r.f, toBranchId: r.t, units: r.units })), (r) => r.fromBranchId, (r) => r.toBranchId),
    },
    lost: { lostQty: lost[0]?.lost ?? 0, damagedQty: lost[0]?.damaged ?? 0, byReason: sortBy(lostReasons.map((r) => ({ reason: r.reason, lostQty: r.lost })), (r) => r.reason) },
    avgTransitSeconds: avg[0]?.secs === null || avg[0]?.secs === undefined ? null : Number(avg[0].secs),
    rows: page.map((r) => ({ ...r, requestedAt: r.requestedAt.toISOString(), sentAt: iso(r.sentAt), receivedAt: iso(r.receivedAt) })),
    hasMore: more,
    nextCursor: more ? page[page.length - 1]!.id : null,
  };
}

// Low stock --------------------------------------------------------------------------------------------------------------

export interface LowStockRow {
  branchId: string;
  productId: string;
  tradeName: string;
  strength: string;
  form: string;
  minQty: number;
  /** What can be sold now: available in active, unexpired batches (the sale rule). */
  sellable: number;
  deficit: number;
  reorderQty: number;
}

export interface LowStockReport {
  total: number;
  byBranch: Array<{ branchId: string; count: number }>;
  rows: LowStockRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

function lowCursor(text: string): { tradeName: string; productId: string; branchId: string } {
  try {
    const v = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'string')) return { tradeName: v[0] as string, productId: v[1] as string, branchId: v[2] as string };
  } catch {
    // fall through
  }
  throw new StudioError('INVALID', 'The page marker is not valid', { cursor: 'The page marker is not valid' });
}

/** Products whose sellable stock in a branch is below that branch's minimum (`PhProductBranch.minQty`, the stock list's own rule), with the deficit and the reorder quantity. */
export async function lowStockReport(scoped: ScopedClient, ph: PhActor, place: { branchId?: string | undefined }, input: z.infer<typeof lowStockInput>): Promise<LowStockReport> {
  const scope = scopeOf(ph, place.branchId);
  const today = utcToday();
  const low = Prisma.sql`
    WITH low AS (
      SELECT pb."branchId", pb."productId", pb."minQty", pb."reorderQty", pr."tradeName", pr."strength", pr."form",
             COALESCE((SELECT SUM(sb."available") FROM "PhStockBalance" sb JOIN "PhBatch" b ON b."restaurantId" = sb."restaurantId" AND b."id" = sb."batchId"
                       WHERE sb."restaurantId" = pb."restaurantId" AND sb."branchId" = pb."branchId" AND sb."productId" = pb."productId"
                         AND b."status" = 'ACTIVE' AND b."expiryDate" >= ${today}::date), 0)::int AS "sellable"
      FROM "PhProductBranch" pb JOIN "PhProduct" pr ON pr."restaurantId" = pb."restaurantId" AND pr."id" = pb."productId"
      WHERE pb."restaurantId" = ${scope.restaurantId} AND pb."branchId" = ANY(${scope.branchIds}::text[]) AND pb."minQty" > 0 AND pr."active"
    )`;
  let after = Prisma.empty;
  if (input.cursor) {
    const c = lowCursor(input.cursor);
    after = Prisma.sql`AND ("tradeName" > ${c.tradeName} OR ("tradeName" = ${c.tradeName} AND ("productId" > ${c.productId} OR ("productId" = ${c.productId} AND "branchId" > ${c.branchId}))))`;
  }
  const [rows, counts] = await Promise.all([
    scoped.$queryRaw<Array<LowStockRow>>(Prisma.sql`
      ${low} SELECT "branchId", "productId", "tradeName", "strength", "form", "minQty", "sellable", ("minQty" - "sellable")::int AS "deficit", "reorderQty"
      FROM low WHERE "sellable" < "minQty" ${after} ORDER BY "tradeName", "productId", "branchId" LIMIT ${input.take + 1}`),
    scoped.$queryRaw<Array<{ g: number; branchId: string | null; n: number }>>(Prisma.sql`
      ${low} SELECT GROUPING("branchId")::int AS "g", "branchId", COUNT(*)::int AS "n" FROM low WHERE "sellable" < "minQty" GROUP BY GROUPING SETS ((), ("branchId"))`),
  ]);
  const more = rows.length > input.take;
  const page = more ? rows.slice(0, input.take) : rows;
  const last = page[page.length - 1];
  return {
    total: counts.find((c) => c.g === 1)?.n ?? 0,
    byBranch: sortBy(
      counts.filter((c) => c.g === 0).map((c) => ({ branchId: c.branchId!, count: c.n })),
      (r) => r.branchId,
    ),
    rows: page,
    hasMore: more,
    nextCursor: more && last ? Buffer.from(JSON.stringify([last.tradeName, last.productId, last.branchId])).toString('base64url') : null,
  };
}
