/* eslint-disable no-restricted-properties -- read-only aggregates: every statement below is bound to the actor's restaurantId and branch ids, and none of them writes */
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import type { ScopedClient } from '@/server/data/tenant-db';
import { dashboardWindow, rankByNet } from '@/server/domain/pharmacy/chain-domain';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { mayViewCost } from './products';
import { salesReport, type MoneyTotals } from './reports';
import { money, periodShape, profitOf, scopeOf, sortBy, windowOf, type Currency, type Scope } from './reports-common';
import { marginReport, type MarginReport } from './reports-margin';
import { expiryBandTotals, lowStockReport, stockValuation, type Buckets, type ExpiryBandTotals, type ValueView } from './reports-stock';

/**
 * The chain dashboard (phase 6, task 5; R6-8, R6-10). One call gives the cards of the branches the person sees and the total of
 * THOSE branches. The total of every figure comes out of the same aggregate as the cards (the report functions' own GROUPING SETS
 * totals), never from a separate query, so total = sum of the cards holds by construction and the tests prove it with plain code.
 *
 * A transfer touches two branches. The cards show it under the destination as incoming and under the sender as outgoing; the total
 * counts it ONCE (a transfer touching at least one visible branch), so incoming plus outgoing over the cards can be twice the total.
 * Cost-derived keys (margin, values) are absent without the permissions, never zero.
 */

export const chainInput = z.object({
  from: periodShape.from.optional(),
  to: periodShape.to.optional(),
  currency: z.enum(['IQD', 'USD'], 'Choose IQD or USD').optional(),
});
export type ChainInput = z.input<typeof chainInput>;

export type Unavailable = { unavailable: true; reason: string };

export interface Flow {
  units: number;
  transfers: number;
}
export interface OpenCounts {
  requested: number;
  sent: number;
}
export type MarginFigures = Omit<MarginReport['byBranch'][number], 'branchId'>;

interface Common {
  sales: MoneyTotals[];
  margin?: MarginFigures[];
  stock: Buckets & { noCostRows?: number; valuationComplete?: boolean; values?: ValueView[] };
  expiry: { expired: ExpiryBandTotals; d30: ExpiryBandTotals } | Unavailable;
  lowStock: number;
}
export interface BranchCard extends Common {
  branchId: string;
  name: string;
  transit: { incoming: Flow; outgoing: Flow };
  openTransfers: { incoming: OpenCounts; outgoing: OpenCounts };
}
export interface ChainTotal extends Common {
  transit: Flow;
  openTransfers: OpenCounts;
}
export interface ComparisonRow {
  branchId: string;
  rank: number;
  count: number;
  netMinor: string;
  discountMinor: string;
  refundsMinor: string;
  marginBp?: number | null;
  stockValueMinor?: string;
}
export interface ChainDashboard {
  from: string;
  to: string;
  /** The total is the total of these branches, not necessarily of the whole business. */
  scope: { branchIds: string[]; isAllBranches: boolean };
  /** Present (true) only when margin figures are included. */
  estimatedMargin?: true;
  branches: BranchCard[];
  total: ChainTotal;
  comparison: Array<{ currency: Currency; rows: ComparisonRow[] }>;
}

/** Runs a read whose failure should cost the dashboard one figure and not the page: only the "too many batches" answer is turned into `unavailable`. */
export async function guard<T>(run: () => Promise<T>): Promise<T | Unavailable> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof StudioError && error.code === 'CONFLICT' && error.fields?.phCode === 'TOO_MANY') return { unavailable: true, reason: 'TOO_MANY' };
    throw error;
  }
}

interface FlowRow {
  f: string;
  t: string;
  status: 'REQUESTED' | 'SENT';
  n: number;
  units: number;
}

/** Open transfers (requested or sent) that touch the branches, by route and status, with the units still on the road: one scan for both figures. */
async function openFlows(scoped: ScopedClient, scope: Scope): Promise<FlowRow[]> {
  return scoped.$queryRaw<FlowRow[]>(Prisma.sql`
    SELECT t."fromBranchId" AS "f", t."toBranchId" AS "t", t."status"::text AS "status", COUNT(DISTINCT t."id")::int AS "n",
           COALESCE(SUM(GREATEST(l."sentQty" - l."receivedQty" - l."damagedQty" - l."lostQty", 0)) FILTER (WHERE l."requestLineId" IS NOT NULL), 0)::int AS "units"
    FROM "PhTransfer" t LEFT JOIN "PhTransferLine" l ON l."restaurantId" = t."restaurantId" AND l."transferId" = t."id"
    WHERE t."restaurantId" = ${scope.restaurantId} AND t."status"::text IN ('REQUESTED', 'SENT')
      AND (t."fromBranchId" = ANY(${scope.branchIds}::text[]) OR t."toBranchId" = ANY(${scope.branchIds}::text[]))
    GROUP BY t."fromBranchId", t."toBranchId", t."status"`);
}

/** A per-branch row without its branch id (the card carries it once). */
const withoutBranch = <T extends { branchId: string }>(row: T): Omit<T, 'branchId'> => {
  const { branchId: _branchId, ...rest } = row;
  void _branchId;
  return rest;
};

const sumFlow = (rows: FlowRow[]): Flow => ({ units: rows.reduce((n, r) => n + r.units, 0), transfers: rows.reduce((n, r) => n + r.n, 0) });
const countOf = (rows: FlowRow[], status: 'REQUESTED' | 'SENT') => rows.filter((r) => r.status === status).reduce((n, r) => n + r.n, 0);

export async function chainDashboard(scoped: ScopedClient, ph: PhActor, input: z.infer<typeof chainInput>, now: Date = new Date()): Promise<ChainDashboard> {
  const scope = scopeOf(ph, undefined);
  if (scope.branchIds.length < 2) {
    throw new StudioError('INVALID', 'The chain view needs more than one branch', { phCode: 'CHAIN_NEEDS_MANY_BRANCHES' });
  }
  const defaults = dashboardWindow(now);
  const to = input.to ?? defaults.to;
  // With only an end date given, the start is 30 days before it.
  const from = input.from ?? (input.to ? dashboardWindow(new Date(`${to}T09:00:00.000Z`)).from : defaults.from);
  windowOf(from, to);
  const withCost = mayViewCost(ph);
  const withMargin = withCost && profitOf(ph);
  const currency = input.currency ? { currency: input.currency } : {};

  const [branchRows, sales, margin, valuation, expiry, low, flows] = await Promise.all([
    scoped.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }] }),
    salesReport(scoped, ph, {}, { from, to, groupBy: 'branch', ...currency, take: 1, cursor: null }),
    withMargin ? marginReport(scoped, ph, {}, { from, to, groupBy: 'branch', ...currency, take: 1, cursor: null }) : Promise.resolve(null),
    stockValuation(scoped, ph, {}, { groupBy: 'branch', take: 1, cursor: null }),
    guard(() => expiryBandTotals(scoped, scope, withCost)),
    lowStockReport(scoped, ph, {}, { take: 1, cursor: null }),
    openFlows(scoped, scope),
  ]);

  const zeroBuckets: Buckets = { available: 0, reserved: 0, quarantine: 0, damaged: 0 };
  const stockOf = (v: (Buckets & { noCostRows?: number; valuationComplete?: boolean; values?: ValueView[] }) | undefined): Common['stock'] => {
    const base = v ?? { ...zeroBuckets, ...(withCost ? { noCostRows: 0, valuationComplete: true, values: [] } : {}) };
    return {
      available: base.available,
      reserved: base.reserved,
      quarantine: base.quarantine,
      damaged: base.damaged,
      ...(withCost ? { noCostRows: base.noCostRows ?? 0, valuationComplete: base.valuationComplete ?? true, values: base.values ?? [] } : {}),
    };
  };
  const emptyBand = (band: ExpiryBandTotals['band']): ExpiryBandTotals => ({ band, rows: 0, units: 0, ...(withCost ? { noCostRows: 0, values: [] } : {}) });
  const expiryOf = (bands: ExpiryBandTotals[] | undefined): Common['expiry'] =>
    'unavailable' in expiry ? expiry : { expired: bands?.find((b) => b.band === 'expired') ?? emptyBand('expired'), d30: bands?.find((b) => b.band === 'd30') ?? emptyBand('d30') };

  const marginRows = (branchId: string): MarginFigures[] | undefined =>
    margin ? margin.byBranch.filter((m) => m.branchId === branchId).map(withoutBranch) : undefined;
  // The total's margin rows: the report's own totals, with the left-out counts of the branches added per currency (a currency in which
  // no line had a complete cost has no total row, but its branches still show their counts).
  const marginTotal = (): MarginFigures[] | undefined => {
    if (!margin) return undefined;
    const currencies = [...new Set([...margin.totals.map((t) => t.currency), ...margin.byBranch.map((b) => b.currency)])].sort();
    return currencies.map((cur) => {
      const t = margin.totals.find((x) => x.currency === cur) ?? { currency: cur, netMinor: '0', costMinor: '0', marginMinor: '0', marginBp: null };
      const rows = margin.byBranch.filter((b) => b.currency === cur);
      return { ...t, incompleteCostRows: rows.reduce((n, b) => n + b.incompleteCostRows, 0), mixedCurrencyRows: rows.reduce((n, b) => n + b.mixedCurrencyRows, 0) };
    });
  };

  const expiryBands = (branchId: string | null) => {
    if ('unavailable' in expiry) return undefined;
    return branchId === null ? expiry.totals : expiry.byBranch.find((e) => e.branchId === branchId)?.bands;
  };

  const branches: BranchCard[] = branchRows.map((b) => {
    const margins = marginRows(b.id);
    const incoming = flows.filter((r) => r.t === b.id);
    const outgoing = flows.filter((r) => r.f === b.id);
    return {
      branchId: b.id,
      name: b.name,
      sales: sales.byBranch.filter((s) => s.branchId === b.id).map(withoutBranch),
      ...(margins ? { margin: margins } : {}),
      stock: stockOf(valuation.byBranch.find((v) => v.branchId === b.id)),
      expiry: expiryOf(expiryBands(b.id)),
      lowStock: low.byBranch.find((c) => c.branchId === b.id)?.count ?? 0,
      transit: { incoming: sumFlow(incoming.filter((r) => r.status === 'SENT')), outgoing: sumFlow(outgoing.filter((r) => r.status === 'SENT')) },
      openTransfers: {
        incoming: { requested: countOf(incoming, 'REQUESTED'), sent: countOf(incoming, 'SENT') },
        outgoing: { requested: countOf(outgoing, 'REQUESTED'), sent: countOf(outgoing, 'SENT') },
      },
    };
  });

  const totalMargin = marginTotal();
  const total: ChainTotal = {
    sales: sales.totals,
    ...(totalMargin ? { margin: totalMargin } : {}),
    stock: stockOf(valuation.totals),
    expiry: expiryOf(expiryBands(null)),
    lowStock: low.total,
    transit: sumFlow(flows.filter((r) => r.status === 'SENT')),
    openTransfers: { requested: countOf(flows, 'REQUESTED'), sent: countOf(flows, 'SENT') },
  };

  const comparison = sales.totals.map((t) => {
    const ranked = rankByNet(branches.map((b) => ({ key: b.branchId, net: BigInt(b.sales.find((s) => s.currency === t.currency)?.netMinor ?? '0') })));
    const rows: ComparisonRow[] = ranked.map((r) => {
      const card = branches.find((b) => b.branchId === r.key)!;
      const s = card.sales.find((x) => x.currency === t.currency);
      const m = card.margin?.find((x) => x.currency === t.currency);
      return {
        branchId: r.key,
        rank: r.rank,
        count: s?.count ?? 0,
        netMinor: money(r.net),
        discountMinor: s?.discountMinor ?? '0',
        refundsMinor: s?.refundsMinor ?? '0',
        ...(card.margin ? { marginBp: m?.marginBp ?? null } : {}),
        ...(withCost ? { stockValueMinor: card.stock.values?.find((v) => v.currency === t.currency)?.valueMinor ?? '0' } : {}),
      };
    });
    return { currency: t.currency, rows: sortBy(rows, (r) => String(r.rank).padStart(6, '0'), (r) => r.branchId) };
  });

  return {
    from,
    to,
    scope: { branchIds: [...scope.branchIds], isAllBranches: ph.allBranches },
    ...(withMargin ? { estimatedMargin: true as const } : {}),
    branches,
    total,
    comparison,
  };
}
