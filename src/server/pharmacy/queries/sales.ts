import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { getSale, listSales, saleGetInput, saleListInput } from '@/server/pharmacy/sales-reads';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Reading sales. The framework needs one permission (`catalog.view`, every pharmacy role); the service then narrows:
 * `report.view` reads the branch, `shift.use` alone reads the person's own open shift, any other role reads none.
 */

export const list = defineQuery({
  name: 'ph.sales.list',
  permission: null,
  ph: 'catalog.view',
  input: saleListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return listSales(scoped, ph, input);
  },
});

export const get = defineQuery({
  name: 'ph.sales.get',
  permission: null,
  ph: 'catalog.view',
  input: saleGetInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return getSale(scoped, ph, input);
  },
});
