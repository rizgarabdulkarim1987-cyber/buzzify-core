import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { getReturn, listReturns, previewReturn, returnableInput, returnableOf, returnGetInput, returnListInput, returnPreviewInput } from '@/server/pharmacy/returns-reads';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Reading returns. The framework needs one permission (`catalog.view`, every pharmacy role); the service then narrows to
 * the holders of `report.view` or `return.approve`. No cost is ever returned.
 */

export const list = defineQuery({
  name: 'ph.returns.list',
  permission: null,
  ph: 'catalog.view',
  input: returnListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return listReturns(scoped, ph, input);
  },
});

export const get = defineQuery({
  name: 'ph.returns.get',
  permission: null,
  ph: 'catalog.view',
  input: returnGetInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return getReturn(scoped, ph, input);
  },
});

export const returnable = defineQuery({
  name: 'ph.returns.returnable',
  permission: null,
  ph: 'catalog.view',
  input: returnableInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return returnableOf(scoped, ph, input);
  },
});

/** What a return of the chosen quantities would refund now (read-only; the return judges again). */
export const preview = defineQuery({
  name: 'ph.returns.preview',
  permission: null,
  ph: 'catalog.view',
  input: returnPreviewInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return previewReturn(scoped, ph, input);
  },
});
