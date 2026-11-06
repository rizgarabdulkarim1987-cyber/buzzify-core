import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { entryBranchOf, productHistoryInput, readProductHistory } from '@/server/pharmacy/fast-entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * One product's purchases, sales and returns in the place's branch, newest first, at most 50 of each (Task 13, under the
 * entry form). `catalog.view`, as reading receipts is (every role; a support actor reads none); a purchase's cost is
 * there only for `cost.view`, the permission that shows it on receipts, and its keys are absent otherwise.
 */

export const productHistory = defineQuery({
  name: 'ph.stock.history',
  permission: null,
  ph: 'catalog.view',
  input: productHistoryInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return readProductHistory(scoped, ph, { productId: input.productId, branchId: entryBranchOf(input) });
  },
});
