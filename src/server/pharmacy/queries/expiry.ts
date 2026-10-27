import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { expiryInput, listExpiry } from '@/server/pharmacy/expiry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * The expiry list: read by anyone who may view stock levels (`catalog.view`); cost keys exist only for `cost.view`. The
 * place's branch narrows it; without one a branch-limited actor still gets only their own branches.
 */
export const expiry = defineQuery({
  name: 'ph.stock.expiry',
  permission: null,
  ph: 'catalog.view',
  input: expiryInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listExpiry(scoped, ph, input);
  },
});
