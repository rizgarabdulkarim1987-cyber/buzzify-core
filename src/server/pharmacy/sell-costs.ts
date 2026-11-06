import { z } from 'zod';
import type { ScopedClient } from '@/server/data/tenant-db';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { MAX_AMOUNT_MINOR } from '@/server/domain/pharmacy/sale';
import { allocateFefo, costOfBaseQty, sellableStock, toBase, type FefoBatch } from '@/server/domain/pharmacy/stock';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { MAX_SALE_LINES } from './sales';

/**
 * The cost and profit of the cashier's sale lines (`ph.sell.costs`), ENFORCED HERE, not only hidden in the screen:
 *  - who may call it is who may search at the sale screen (`shift.use` or `report.view`); the branch is the place's;
 *  - a role without `cost.view` gets `{ lines: [] }`: no cost or profit key at all, and nothing is read;
 *  - with `cost.view`, each line's cost is what the sale would take now: overrides first, then FEFO over this branch's sellable
 *    stock, lines of one product sharing the batches in order (as `createSale`), each allocation costed with `costOfBaseQty`
 *    (the sale snapshot's rule, floored). Unknown (null) when a batch has no cost, its cost is in another currency than the
 *    sale's (the USD rate is display-only, never converted), or the stock does not cover the line;
 *  - the profit (`profitMinor`) only with `profit.view` too (as the margin report): the line total after its own discount
 *    (unit price x qty - discount, the screen's "total after discount") minus the cost, negative when it is. Integers only.
 * The unit price and discount are the screen's: the answer is about the cart as shown, it prices nothing.
 */

const WHOLE = 'Enter a whole number';
const money = z.coerce.bigint('Enter an amount').min(0n, 'Use 0 or more').max(MAX_AMOUNT_MINOR, 'Enter a smaller amount');

export const sellCostsInput = z.object({
  currency: z.enum(['IQD', 'USD'], 'Choose IQD or USD'),
  lines: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        productId: z.string().min(1).max(64),
        unitId: z.string().min(1).max(64),
        qty: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(1_000_000, 'Enter a smaller number'),
        unitPriceMinor: money,
        discountMinor: money.default(0n),
        batchId: z.string().min(1).max(64).optional(),
      }),
    )
    .min(1, 'Add at least one line')
    .max(MAX_SALE_LINES, 'Use at most 200 lines'),
});

export interface LineCostAnswer {
  key: string;
  /** Minor units as text; null when it cannot be known (see above). */
  costMinor: string | null;
  /** Present only with `profit.view`: null when the cost is unknown. */
  profitMinor?: string | null;
}

export interface SellCosts {
  lines: LineCostAnswer[];
}

const expiryOf = (d: Date) => d.toISOString().slice(0, 10);

export async function sellCosts(scoped: ScopedClient, ph: PhActor, input: z.infer<typeof sellCostsInput> & { branchId?: string }, now: Date = new Date()): Promise<SellCosts> {
  if (ph.role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  if (!canPh(ph.role, 'shift.use') && !canPh(ph.role, 'report.view')) throw new StudioError('FORBIDDEN');
  const branchId = input.branchId;
  if (!branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
  if (!ph.branchIds.includes(branchId)) throw new StudioError('FORBIDDEN');
  // No cost.view: nothing is read and no cost or profit key is in the answer.
  if (!canPh(ph.role, 'cost.view')) return { lines: [] };
  const withProfit = canPh(ph.role, 'profit.view');

  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const unitIds = [...new Set(input.lines.map((l) => l.unitId))];
  const [products, units, balances] = await Promise.all([
    scoped.phProduct.findMany({ where: { id: { in: productIds } }, select: { id: true } }),
    scoped.phProductUnit.findMany({ where: { id: { in: unitIds }, productId: { in: productIds } }, select: { id: true, productId: true, baseQty: true } }),
    scoped.phStockBalance.findMany({
      where: { branchId, productId: { in: productIds }, available: { gt: 0 } },
      select: { batchId: true, productId: true, available: true, batch: { select: { lot: true, status: true, expiryDate: true, expiryPrecision: true, unitCostMinor: true, costCurrency: true, costUnitId: true } } },
    }),
  ]);
  const known = new Set(products.map((p) => p.id));
  const unitById = new Map(units.map((u) => [u.id, u]));
  for (const line of input.lines) {
    const unit = unitById.get(line.unitId);
    if (!known.has(line.productId) || !unit || unit.productId !== line.productId) throw new StudioError('NOT_FOUND');
  }

  const costUnitIds = [...new Set(balances.flatMap((b) => (b.batch.costUnitId ? [b.batch.costUnitId] : [])))];
  const costUnits = costUnitIds.length > 0 ? await scoped.phProductUnit.findMany({ where: { id: { in: costUnitIds } }, select: { id: true, baseQty: true } }) : [];
  const costUnitBase = new Map(costUnits.map((u) => [u.id, u.baseQty]));

  const today = utcToday(now);
  const left = new Map<string, number>();
  for (const b of balances) left.set(b.batchId, sellableStock({ available: b.available, reserved: 0, quarantine: 0, damaged: 0 }, { status: b.batch.status, expiryDate: expiryOf(b.batch.expiryDate) }, today));
  const batchById = new Map(balances.map((b) => [b.batchId, b]));

  /** The cost of `qty` base units of a batch in the sale currency, or null when it has none in that currency. */
  const costOf = (batchId: string, qty: number): bigint | null => {
    const { batch } = batchById.get(batchId)!;
    const per = batch.costUnitId ? costUnitBase.get(batch.costUnitId) : undefined;
    if (batch.unitCostMinor === null || batch.costCurrency !== input.currency || per === undefined) return null;
    return costOfBaseQty(batch.unitCostMinor, qty, per);
  };

  const costs = new Map<number, bigint | null>();
  const indexed = input.lines.map((line, index) => ({ line, index, baseQty: toBase(line.qty, unitById.get(line.unitId)!.baseQty) }));
  // Overrides take their chosen batch first, then FEFO, in the order of the cart (as the sale does).
  const ordered = [...indexed.filter((l) => l.line.batchId !== undefined), ...indexed.filter((l) => l.line.batchId === undefined)];
  for (const { line, index, baseQty } of ordered) {
    let taken: { batchId: string; qty: number }[] | null;
    if (line.batchId !== undefined) {
      const chosen = batchById.get(line.batchId);
      const have = left.get(line.batchId) ?? 0;
      taken = chosen && chosen.productId === line.productId && have >= baseQty ? [{ batchId: line.batchId, qty: baseQty }] : null;
    } else {
      const candidates: (FefoBatch & { sellable: number })[] = balances
        .filter((b) => b.productId === line.productId)
        .map((b) => ({ id: b.batchId, lot: b.batch.lot, expiryDate: expiryOf(b.batch.expiryDate), expiryPrecision: b.batch.expiryPrecision, sellable: left.get(b.batchId) ?? 0 }));
      const fefo = allocateFefo(candidates, baseQty);
      taken = fefo.ok ? fefo.allocations : null;
    }
    if (taken === null) {
      costs.set(index, null);
      continue;
    }
    let total: bigint | null = 0n;
    for (const a of taken) {
      left.set(a.batchId, (left.get(a.batchId) ?? 0) - a.qty);
      const part = costOf(a.batchId, a.qty);
      total = total === null || part === null ? null : total + part;
    }
    costs.set(index, total);
  }

  return {
    lines: input.lines.map((line, index) => {
      const cost = costs.get(index) ?? null;
      const answer: LineCostAnswer = { key: line.key, costMinor: cost === null ? null : String(cost) };
      if (withProfit) answer.profitMinor = cost === null ? null : String(line.unitPriceMinor * BigInt(line.qty) - line.discountMinor - cost);
      return answer;
    }),
  };
}
