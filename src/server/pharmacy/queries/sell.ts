import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { sellCosts, sellCostsInput } from '@/server/pharmacy/sell-costs';
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

/**
 * The cost and profit of the cart's lines, for the cashier's cost columns. Called like the search; the service then gives cost
 * only to a role with `cost.view` (profit only with `profit.view` too) and an empty answer to anyone else.
 */
export const costs = defineQuery({
  name: 'ph.sell.costs',
  permission: null,
  ph: 'catalog.view',
  input: sellCostsInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return sellCosts(scoped, ph, input);
  },
});
