import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { DEFAULT_USD_RATE } from '@/server/pharmacy/exchange-rate';
import { pharmacyOf } from '@/server/pharmacy/products';
import { shiftLineOf } from '@/server/pharmacy/pulse-shift';
import { currentShift } from '@/server/pharmacy/shifts-reads';
import { expiringWhere, lowStockRows } from '@/server/pharmacy/stock-alerts';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * The cashier's header chips. The shift figures are the person's own open shift in the chosen branch (zeros without one):
 * net sales = everything sold (cash, card, transfer and credit) minus what was returned; receipts = sales counted in the
 * shift; drawer cash = the shift's expected cash, as the shift screen shows it. Near-expiry follows the Expiry screen's
 * 90 day window (`stock-alerts`). Low stock is exactly the navigation badge's rule (`lowStockRows`: a reorder level above 0 and sellable stock below it; a product without one never counts).
 * The first near-expiry product is the first by expiry date among the stock balances; the first low-stock product is the first alphabetically. `usdRate` is display only (IQD per 1 USD).
 */

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

    const [shift, settings, expiring, expiringCount, lowRows] = await Promise.all([
      currentShift(scoped, ph, input),
      scoped.phSettings.findFirst({ select: { usdRate: true } }),
      scoped.phStockBalance.findFirst({ where: expiringWhere(branch, now), orderBy: [{ batch: { expiryDate: 'asc' } }, { id: 'asc' }], select: { productId: true } }),
      scoped.phStockBalance.count({ where: expiringWhere(branch, now) }),
      lowStockRows(scoped, branch, now),
    ]);

    // The same rows as the navigation badge (`lowStockRows`): a product with a reorder level whose sellable stock is below it.
    const lowIds = [...new Set(lowRows.map((r) => r.productId))];
    const lowProducts = lowIds.length === 0 ? [] : await scoped.phProduct.findMany({ where: { id: { in: lowIds }, active: true }, select: { id: true, tradeName: true }, orderBy: [{ tradeName: 'asc' }, { id: 'asc' }] });
    const firstExpiring = expiring ? await scoped.phProduct.findFirst({ where: { id: expiring.productId }, select: { id: true, tradeName: true } }) : null;

    const totals = shift?.totals;
    return {
      shiftNetMinor: totals ? String(BigInt(totals.salesTotalMinor) - BigInt(totals.returns.refundMinor)) : '0',
      receiptsDone: totals?.salesCount ?? 0,
      drawerCashMinor: totals?.expectedMinor ?? '0',
      nearExpiry: expiringCount === 0 ? EMPTY : { count: expiringCount, firstProductName: firstExpiring?.tradeName ?? null, firstProductId: firstExpiring?.id ?? null },
      lowStock: { count: lowProducts.length, firstProductName: lowProducts[0]?.tradeName ?? null, firstProductId: lowProducts[0]?.id ?? null },
      usdRate: settings?.usdRate ?? DEFAULT_USD_RATE,
      // The footer line: cash, credit, card, transfer and returns of the shift with their counts (null without an open shift).
      shift: shiftLineOf(totals),
    };
  },
});
