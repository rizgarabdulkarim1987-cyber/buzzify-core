import { z } from 'zod';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * The two counters on the navigation: products below their minimum, and batches expiring soon. Both follow the Stock and
 * Expiry screens exactly, so a badge never disagrees with the list behind it:
 *  - low stock is the stock screen's `lowStock` filter: a product with a minimum above 0 whose sellable stock (`available`
 *    of an ACTIVE, unexpired batch) in a branch shown is below that minimum; one product counts once however many branches.
 *  - expiring is the expiry screen's 30, 60 and 90 day totals at its default 90 day horizon: (batch, branch) rows holding
 *    stock in available, reserved or quarantine whose band is d30, d60 or d90. Expired rows are the screen's own "expired"
 *    total and are not counted here; a MONTH batch counts from the start of its last month, as `expiryBand` says.
 * Read by anyone who may view stock levels (`catalog.view`). Grouped and count queries only: no batch or product row is loaded.
 */

const DAY_MS = 86_400_000;
const NAV_EXPIRY_DAYS = 90;
const WITH_STOCK = [{ available: { gt: 0 } }, { reserved: { gt: 0 } }, { quarantine: { gt: 0 } }];

const utcDay = (text: string, addDays = 0) => new Date(new Date(`${text}T00:00:00.000Z`).getTime() + addDays * DAY_MS);

export const navCounts = defineQuery({
  name: 'ph.nav.counts',
  permission: null,
  ph: 'catalog.view',
  input: phPlaceInput.extend({ now: z.date() }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    const branch = input.branchId ? { branchId: input.branchId } : {};
    const today = utcDay(utcToday(input.now));
    const horizon = utcDay(utcToday(input.now), NAV_EXPIRY_DAYS);
    // A MONTH batch (stored as its last day) alerts from its first day: it is in once its month starts by the horizon.
    const horizonMonthEnd = new Date(Date.UTC(horizon.getUTCFullYear(), horizon.getUTCMonth() + 1, 0));

    const [sellable, minimums, expiring] = await Promise.all([
      scoped.phStockBalance.groupBy({
        by: ['productId', 'branchId'],
        where: { ...branch, batch: { status: 'ACTIVE', expiryDate: { gte: today } } },
        _sum: { available: true },
      }),
      scoped.phProductBranch.findMany({ where: { ...branch, minQty: { gt: 0 } }, select: { productId: true, branchId: true, minQty: true } }),
      scoped.phStockBalance.count({
        where: {
          ...branch,
          OR: WITH_STOCK,
          batch: {
            OR: [
              { expiryPrecision: 'DAY', expiryDate: { gte: today, lte: horizon } },
              { expiryPrecision: 'MONTH', expiryDate: { gte: today, lte: horizonMonthEnd } },
            ],
          },
        },
      }),
    ]);
    const availableAt = new Map(sellable.map((s) => [`${s.productId}|${s.branchId}`, s._sum.available ?? 0]));
    const low = new Set(minimums.filter((m) => (availableAt.get(`${m.productId}|${m.branchId}`) ?? 0) < m.minQty).map((m) => m.productId));
    return { lowStock: low.size, expiring };
  },
});
