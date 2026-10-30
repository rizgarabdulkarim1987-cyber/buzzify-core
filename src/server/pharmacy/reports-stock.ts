/* eslint-disable no-restricted-properties -- read-only aggregates: every statement below is bound to the actor's restaurantId and branch ids, and none of them writes */
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import type { ScopedClient } from '@/server/data/tenant-db';
import { expiryBand, utcToday, type ExpiryBand } from '@/server/domain/pharmacy/expiry';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { expiryInput, listExpiry, type ExpiryRow, type ExpiryTotals } from './expiry';
import { mayViewCost } from './products';
import { money, pagingShape, scopeOf, sortBy, type Currency, type Scope } from './reports-common';

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
export const expiryReportInput = z.object({ cursor: z.string().min(1).max(800).nullish(), take: z.number('Enter a whole number').int('Enter a whole number').min(1, 'Use 1 or more').max(100, 'Enter a smaller number').default(50) });
export type ExpiryReportInput = z.input<typeof expiryReportInput>;
export const lowStockInput = z.object({ cursor: z.string().min(1).max(400).nullish(), take: z.number('Enter a whole number').int('Enter a whole number').min(1, 'Use 1 or more').max(500, 'Enter a smaller number').default(100) });
export type LowStockInput = z.input<typeof lowStockInput>;

/** `n` units of a stock row's batch at its cost, floored (the sale snapshot's rule); needs the aliases `b` (batch) and `cu` (its cost unit). */
export const valueOf = (units: Prisma.Sql) => Prisma.sql`floor(b."unitCostMinor"::numeric * (${units}) / cu."baseQty")::bigint`;
export const HAS_COST = Prisma.sql`b."unitCostMinor" IS NOT NULL AND b."costCurrency" IS NOT NULL AND cu."baseQty" IS NOT NULL`;

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
  byBranch: Array<Buckets & { branchId: string; noCostRows?: number; valuationComplete?: boolean; values?: ValueView[] }>;
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
             (COUNT(*) FILTER (WHERE NOT (${HAS_COST})))::int AS "nocost"
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
        ...(withCost ? { noCostRows: q.nocost, valuationComplete: q.nocost === 0, values: valueViews(values.filter((v) => v.gb === 0 && v.gk === 1 && v.branchId === q.branchId)) } : {}),
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
  /** The phase 2 list's own counts, from `listExpiry` (the report's own stock-row counts per band when the list was too large to build). */
  listTotals: ExpiryTotals;
  /** True when the phase 2 list refused (too many batches in reach): the band totals above are complete, `items` is empty. Choose a branch to get the list. */
  listTruncated: boolean;
  items: ExpiryRow[];
  nextCursor: string | null;
}

/** The band totals of the expiry report, in total and per branch: one aggregate over the stock rows in reach, with no cap on the number of batches. */
export async function expiryBandTotals(scoped: ScopedClient, scope: Scope, withCost: boolean): Promise<{ totals: ExpiryBandTotals[]; byBranch: Array<{ branchId: string; bands: ExpiryBandTotals[] }> }> {
  const today = utcToday();
  const reach = new Date(new Date(`${today}T00:00:00.000Z`).getTime() + (90 + 31) * DAY_MS);
  const groups = await scoped.$queryRaw<Array<{ branchId: string; expiryDate: Date; precision: 'DAY' | 'MONTH'; rows: number; units: number; nocost: number; cur: Currency | null; value: bigint }>>(Prisma.sql`
      SELECT sb."branchId", b."expiryDate", b."expiryPrecision"::text AS "precision", COUNT(*)::int AS "rows", SUM(sb."available" + sb."reserved" + sb."quarantine")::int AS "units",
             (COUNT(*) FILTER (WHERE NOT (${HAS_COST})))::int AS "nocost", b."costCurrency"::text AS "cur",
             COALESCE(SUM(${valueOf(Prisma.sql`sb."available" + sb."reserved" + sb."quarantine"`)}) FILTER (WHERE ${HAS_COST}), 0)::bigint AS "value"
      FROM "PhStockBalance" sb
        JOIN "PhBatch" b ON b."restaurantId" = sb."restaurantId" AND b."id" = sb."batchId"
        LEFT JOIN "PhProductUnit" cu ON cu."productId" = b."productId" AND cu."id" = b."costUnitId"
      WHERE sb."restaurantId" = ${scope.restaurantId} AND sb."branchId" = ANY(${scope.branchIds}::text[])
        AND (sb."available" > 0 OR sb."reserved" > 0 OR sb."quarantine" > 0) AND b."expiryDate" <= ${reach.toISOString().slice(0, 10)}::date
      GROUP BY sb."branchId", b."expiryDate", b."expiryPrecision", b."costCurrency"`);

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
    totals: EXPIRY_REPORT_BANDS.map((band) => view(band, overall.get(band))),
    byBranch: sortBy(
      [...perBranch.entries()].map(([branchId, bands]) => ({ branchId, bands: EXPIRY_REPORT_BANDS.map((band) => view(band, bands.get(band))) })),
      (r) => r.branchId,
    ),
  };
}

export async function expiryReport(scoped: ScopedClient, ph: PhActor, place: { branchId?: string | undefined }, input: z.infer<typeof expiryReportInput>): Promise<ExpiryReport> {
  const scope = scopeOf(ph, place.branchId);
  const withCost = mayViewCost(ph);
  const [list, bands] = await Promise.all([
    // The list, its rows and its counts, are the phase 2 service's: not rebuilt here. On a chain too large for it (it refuses with
    // TOO_MANY) the band totals below still answer; only the list is dropped, and the answer says so.
    listExpiry(scoped, ph, { ...expiryInput.parse({ days: 90, includeExpired: true, pageSize: input.take, cursor: input.cursor ?? null }), ...(place.branchId ? { branchId: place.branchId } : {}) }).catch((error: unknown) => {
      if (error instanceof StudioError && error.code === 'CONFLICT' && error.fields?.phCode === 'TOO_MANY') return null;
      throw error;
    }),
    expiryBandTotals(scoped, scope, withCost),
  ]);
  const rowsIn = (band: ExpiryReportBand) => bands.totals.find((t) => t.band === band)?.rows ?? 0;
  return {
    days: 90,
    totals: bands.totals,
    byBranch: bands.byBranch,
    listTotals: list?.totals ?? { expired: rowsIn('expired'), d30: rowsIn('d30'), d60: rowsIn('d60'), d90: rowsIn('d90'), d180: 0 },
    listTruncated: list === null,
    items: list?.items ?? [],
    nextCursor: list?.nextCursor ?? null,
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
