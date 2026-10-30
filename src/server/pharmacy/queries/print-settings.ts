import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { getPrintSettings } from '@/server/pharmacy/print-settings';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineQuery } from '@/server/studio/framework/query';

/** The printing settings (phase 7): every pharmacy role reads them, so a print screen knows its paper and margins, read-only mode included. */
export const get = defineQuery({
  name: 'ph.print.settings.get',
  permission: null,
  ph: 'catalog.view',
  allowReadOnly: true,
  input: phPlaceInput,
  target: phTargetOf,
  run(ctx) {
    const { scoped } = pharmacyOf(ctx);
    return getPrintSettings(scoped);
  },
});
