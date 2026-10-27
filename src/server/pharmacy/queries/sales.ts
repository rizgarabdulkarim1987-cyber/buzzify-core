import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { holdListInput, listHolds } from '@/server/pharmacy/holds';
import { pharmacyOf } from '@/server/pharmacy/products';
import { getSale, listSales, saleGetInput, saleListInput } from '@/server/pharmacy/sales-reads';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';

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

/** The branch's live held carts (any seller of the branch sees them: holds are branch-level). */
export const holds = defineQuery({
  name: 'ph.sales.holds',
  permission: null,
  ph: 'shift.use',
  input: holdListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    if (!input.branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
    return listHolds(scoped, ph, { branchId: input.branchId });
  },
});
