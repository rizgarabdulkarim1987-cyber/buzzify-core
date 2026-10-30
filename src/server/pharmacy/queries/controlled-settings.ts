import { getControlledSettings } from '@/server/pharmacy/controlled-settings';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineQuery } from '@/server/studio/framework/query';

/** The controlled-drug settings (phase 7): every pharmacy role may read them, so a screen knows what to offer. */
export const get = defineQuery({
  name: 'ph.settings.controlled.get',
  permission: null,
  ph: 'catalog.view',
  allowReadOnly: true,
  input: phPlaceInput,
  target: phTargetOf,
  run(ctx) {
    const { scoped } = pharmacyOf(ctx);
    return getControlledSettings(scoped);
  },
});
