import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { sellInfo, sellInfoInput } from '@/server/pharmacy/sell-info';
import { sellSearch, sellSearchInput } from '@/server/pharmacy/sell-search';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * The sale screen's search. The framework needs one permission (`catalog.view`, every pharmacy role); the service then
 * narrows it to `shift.use` or `report.view`. The branch is the place's.
 */
export const search = defineQuery({
  name: 'ph.sell.search',
  permission: null,
  ph: 'catalog.view',
  input: sellSearchInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return sellSearch(scoped, ph, input);
  },
});

/** One product beside the sale: its batches here (expired marked), its details (no cost) and its substitutes by active ingredient. */
export const info = defineQuery({
  name: 'ph.sell.info',
  permission: null,
  ph: 'catalog.view',
  input: sellInfoInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return sellInfo(scoped, ph, input);
  },
});
