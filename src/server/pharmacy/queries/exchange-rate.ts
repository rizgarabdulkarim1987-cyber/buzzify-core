import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { getExchangeRate } from '@/server/pharmacy/exchange-rate';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineQuery } from '@/server/studio/framework/query';

/** The display-only USD exchange rate: every pharmacy role may read it. */
export const get = defineQuery({
  name: 'ph.exchangeRate.get',
  permission: null,
  ph: 'catalog.view',
  allowReadOnly: true,
  input: phPlaceInput,
  target: phTargetOf,
  run(ctx) {
    const { scoped } = pharmacyOf(ctx);
    return getExchangeRate(scoped);
  },
});
