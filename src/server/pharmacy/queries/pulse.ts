import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { DEFAULT_USD_RATE } from '@/server/pharmacy/exchange-rate';
import { pharmacyOf } from '@/server/pharmacy/products';
import { currentShift } from '@/server/pharmacy/shifts-reads';
import { expiringWhere, expiryToday } from '@/server/pharmacy/stock-alerts';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * The cashier's header chips. The shift figures are the person's own open shift in the chosen branch (zeros without one):
 * net sales = everything sold (cash, card, transfer and credit) minus what was returned; receipts = sales counted in the
 * shift; drawer cash = the shift's expected cash, as the shift screen shows it. Near-expiry follows the Expiry screen's
 * 90 day window (`stock-alerts`). Low stock: a product whose sellable stock in the branch is at or below its reorder level
 * (`minQty`), or at or below 5 base units when it has none. `usdRate` is display only (IQD per 1 USD).
 */

const LOW_FALLBACK = 5;

interface Chip {
  count: number;
  firstProductName: string | null;
  firstProductId: string | null;
}
const EMPTY: Chip = { count: 0, firstProductName: null, firstProductId: null };

export const pulse = defineQuery({
  name: 'ph.pulse',
  permission: null,
  ph: 'shift.use',
  input: phPlaceInput,
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    const branch = input.branchId ? { branchId: input.branchId } : {};
    const now = new Date();

    const [shift, settings, expiring, expiringCount, sellable, minimums] = await Promise.all([
      currentShift(scoped, ph, input),
      scoped.phSettings.findFirst({ select: { usdRate: true } }),
      scoped.phStockBalance.findFirst({ where: expiringWhere(branch, now), orderBy: [{ batch: { expiryDate: 'asc' } }, { id: 'asc' }], select: { productId: true } }),
      scoped.phStockBalance.count({ where: expiringWhere(branch, now) }),
      scoped.phStockBalance.groupBy({
        by: ['productId'],
        where: { ...branch, batch: { status: 'ACTIVE', expiryDate: { gte: expiryToday(now) } } },
        _sum: { available: true },
      }),
      scoped.phProductBranch.findMany({ where: { ...branch, minQty: { gt: 0 } }, select: { productId: true, minQty: true } }),
    ]);

    // One product counts once however many branches: sum its sellable stock and its reorder level over the branches shown.
    const minOf = new Map<string, number>();
    for (const m of minimums) minOf.set(m.productId, (minOf.get(m.productId) ?? 0) + m.minQty);
    const lowIds = new Set<string>();
    for (const s of sellable) {
      const threshold = minOf.get(s.productId) ?? LOW_FALLBACK;
      if ((s._sum.available ?? 0) <= threshold) lowIds.add(s.productId);
    }
    for (const id of minOf.keys()) if (!sellable.some((s) => s.productId === id)) lowIds.add(id);
    const lowProducts = lowIds.size === 0 ? [] : await scoped.phProduct.findMany({ where: { id: { in: [...lowIds] }, active: true }, select: { id: true, tradeName: true }, orderBy: [{ tradeName: 'asc' }, { id: 'asc' }] });
    const firstExpiring = expiring ? await scoped.phProduct.findFirst({ where: { id: expiring.productId }, select: { id: true, tradeName: true } }) : null;

    const totals = shift?.totals;
    return {
      shiftNetMinor: totals ? String(BigInt(totals.salesTotalMinor) - BigInt(totals.returns.refundMinor)) : '0',
      receiptsDone: totals?.salesCount ?? 0,
      drawerCashMinor: totals?.expectedMinor ?? '0',
      nearExpiry: expiringCount === 0 ? EMPTY : { count: expiringCount, firstProductName: firstExpiring?.tradeName ?? null, firstProductId: firstExpiring?.id ?? null },
      lowStock: { count: lowProducts.length, firstProductName: lowProducts[0]?.tradeName ?? null, firstProductId: lowProducts[0]?.id ?? null },
      usdRate: settings?.usdRate ?? DEFAULT_USD_RATE,
    };
  },
});
