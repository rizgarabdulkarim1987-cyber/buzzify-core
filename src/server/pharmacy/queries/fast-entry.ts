import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { entryBranchOf, entryDraftView, entryLookup as lookup, entryLookupInput } from '@/server/pharmacy/fast-entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * The fast entry screen's reads (Task 13), for the receiving permission (`purchase.manage`) in the place's branch: what a
 * scan or a name is (`entryLookup`, with the pre-fill of the last purchase; its cost only for `cost.view`), and the
 * person's open entry with its lines (`entryDraft`, for the "entered now" list after a reload).
 */

export const entryLookup = defineQuery({
  name: 'ph.stock.entry.lookup',
  permission: null,
  ph: 'purchase.manage',
  input: entryLookupInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return lookup(scoped, ph, { branchId: entryBranchOf(input), ...(input.q !== undefined ? { q: input.q } : {}), ...(input.productId ? { productId: input.productId } : {}), now: new Date() });
  },
});

export const entryDraft = defineQuery({
  name: 'ph.stock.entry.draft',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput,
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return entryDraftView(scoped, ph, { branchId: entryBranchOf(input), now: new Date() });
  },
});
