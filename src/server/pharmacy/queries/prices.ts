import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { priceHistory, priceHistoryInput } from '@/server/pharmacy/prices';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * A product's price history (`catalog.view`: every pharmacy role, and support with a `catalog.read` grant, each read
 * audited by the framework), newest first. A branch-limited person sees their branches' rows and the business-wide ones.
 */
export const history = defineQuery({
  name: 'ph.prices.history',
  permission: null,
  ph: 'catalog.view',
  input: priceHistoryInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return priceHistory(scoped, ph, input);
  },
});
