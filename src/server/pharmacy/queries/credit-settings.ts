import { getCreditSettings } from '@/server/pharmacy/credit-settings';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineQuery } from '@/server/studio/framework/query';

/** Whether credit sales are switched on (phase 7): every pharmacy role may read it, so a screen knows what to offer. */
export const get = defineQuery({
  name: 'ph.credit.settings.get',
  permission: null,
  ph: 'catalog.view',
  allowReadOnly: true,
  input: phPlaceInput,
  target: phTargetOf,
  run(ctx) {
    const { scoped } = pharmacyOf(ctx);
    return getCreditSettings(scoped);
  },
});
