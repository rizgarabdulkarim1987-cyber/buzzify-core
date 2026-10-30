import { prisma } from './fixture';

/** Plain-code figures read straight from rows (no report code, no SQL aggregate): the independent side of the chain tests. */
const SOLD = ['COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL'] as const;
type Cur = 'IQD' | 'USD';

export const instantsOf = (from: string, to: string) => ({
  start: new Date(new Date(`${from}T00:00:00.000Z`).getTime() - 3 * 3_600_000),
  end: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 21 * 3_600_000),
});

export interface SalesFigures {
  count: number;
  gross: bigint;
  discount: bigint;
  sales: bigint;
  refunds: bigint;
  refundCount: number;
}
const zero = (): SalesFigures => ({ count: 0, gross: 0n, discount: 0n, sales: 0n, refunds: 0n, refundCount: 0 });

/** Per `branchId|currency`. */
export async function salesTruth(restaurantId: string, branchIds: string[], from: string, to: string): Promise<Map<string, SalesFigures>> {
  const { start, end } = instantsOf(from, to);
  const out = new Map<string, SalesFigures>();
  const at = (k: string) => out.get(k) ?? out.set(k, zero()).get(k)!;
  for (const s of await prisma().phSale.findMany({ where: { restaurantId, branchId: { in: branchIds }, status: { in: [...SOLD] }, completedAt: { gte: start, lt: end } } })) {
    const f = at(`${s.branchId}|${s.currency}`);
    f.count += 1;
    f.gross += s.subtotalMinor;
    f.discount += s.discountMinor;
    f.sales += s.totalMinor;
  }
  for (const r of await prisma().phReturn.findMany({ where: { restaurantId, branchId: { in: branchIds }, createdAt: { gte: start, lt: end } } })) {
    const f = at(`${r.branchId}|${r.currency}`);
    f.refunds += r.refundMinor;
    f.refundCount += 1;
  }
  return out;
}

export interface StockFigures {
  available: number;
  reserved: number;
  quarantine: number;
  damaged: number;
  values: Map<Cur, bigint>;
  noCost: number;
}
/** Per branch: the buckets and the value (available + reserved + quarantine) at batch cost, floored per stock row. */
export async function stockTruth(restaurantId: string, branchIds: string[]): Promise<Map<string, StockFigures>> {
  const out = new Map<string, StockFigures>();
  const rows = await prisma().phStockBalance.findMany({ where: { restaurantId, branchId: { in: branchIds } }, include: { batch: true } });
  const units = await prisma().phProductUnit.findMany({ where: { restaurantId } });
  const baseOf = new Map(units.map((u) => [u.id, u.baseQty]));
  for (const r of rows) {
    if (r.available + r.reserved + r.quarantine + r.damaged <= 0) continue;
    const f = out.get(r.branchId) ?? out.set(r.branchId, { available: 0, reserved: 0, quarantine: 0, damaged: 0, values: new Map(), noCost: 0 }).get(r.branchId)!;
    f.available += r.available;
    f.reserved += r.reserved;
    f.quarantine += r.quarantine;
    f.damaged += r.damaged;
    const b = r.batch;
    const per = b.costUnitId ? baseOf.get(b.costUnitId) : undefined;
    if (b.unitCostMinor === null || b.costCurrency === null || per === undefined) {
      f.noCost += 1;
    } else {
      const v = (b.unitCostMinor * BigInt(r.available + r.reserved + r.quarantine)) / BigInt(per);
      f.values.set(b.costCurrency, (f.values.get(b.costCurrency) ?? 0n) + v);
    }
  }
  return out;
}

/** Units on the road: the sent lines of SENT transfers, `sent - received - damaged - lost`, per transfer. */
export async function openTransfersTruth(restaurantId: string) {
  const open = await prisma().phTransfer.findMany({ where: { restaurantId, status: { in: ['REQUESTED', 'SENT'] } }, include: { lines: true } });
  return open.map((t) => ({
    id: t.id,
    from: t.fromBranchId,
    to: t.toBranchId,
    status: t.status as 'REQUESTED' | 'SENT',
    units: t.lines.filter((l) => l.requestLineId !== null).reduce((n, l) => n + Math.max(l.sentQty - l.receivedQty - l.damagedQty - l.lostQty, 0), 0),
  }));
}

/** Products below their branch minimum, by sellable stock (available in ACTIVE, unexpired batches), per branch. */
export async function lowStockTruth(restaurantId: string, branchIds: string[], today: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const mins = await prisma().phProductBranch.findMany({ where: { restaurantId, branchId: { in: branchIds }, minQty: { gt: 0 }, product: { active: true } } });
  const balances = await prisma().phStockBalance.findMany({ where: { restaurantId, branchId: { in: branchIds } }, include: { batch: true } });
  for (const m of mins) {
    const sellable = balances
      .filter((b) => b.branchId === m.branchId && b.productId === m.productId && b.batch.status === 'ACTIVE' && b.batch.expiryDate.toISOString().slice(0, 10) >= today)
      .reduce((n, b) => n + b.available, 0);
    if (sellable < m.minQty) out.set(m.branchId, (out.get(m.branchId) ?? 0) + 1);
  }
  return out;
}

/** Units (available + reserved + quarantine) of stock rows whose batch is expired, or expires within 30 days (DAY precision), per branch. */
export async function expiryTruth(restaurantId: string, branchIds: string[], today: string) {
  const out = new Map<string, { expired: number; d30: number }>();
  const day = (iso: string) => Math.round((new Date(`${iso}T00:00:00.000Z`).getTime() - new Date(`${today}T00:00:00.000Z`).getTime()) / 86_400_000);
  for (const r of await prisma().phStockBalance.findMany({ where: { restaurantId, branchId: { in: branchIds } }, include: { batch: true } })) {
    const units = r.available + r.reserved + r.quarantine;
    if (units <= 0) continue;
    const d = day(r.batch.expiryDate.toISOString().slice(0, 10));
    const f = out.get(r.branchId) ?? out.set(r.branchId, { expired: 0, d30: 0 }).get(r.branchId)!;
    if (d < 0) f.expired += units;
    else if (d <= 30) f.d30 += units;
  }
  return out;
}
