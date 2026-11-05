import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { expiringWhere, lowStockCount, lowStockRows } from '@/server/pharmacy/stock-alerts';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * The two counters on the navigation: products below their minimum, and batches expiring soon. Both follow the Stock and
 * Expiry screens exactly, so a badge never disagrees with the list behind it; the rules are in `stock-alerts.ts`, which the
 * home dashboard shares. Read by anyone who may view stock levels (`catalog.view`). Grouped and count queries only: no batch
 * or product row is loaded.
 */
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
    const [low, expiring] = await Promise.all([lowStockRows(scoped, branch, input.now), scoped.phStockBalance.count({ where: expiringWhere(branch, input.now) })]);
    return { lowStock: lowStockCount(low), expiring };
  },
});
