import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
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
