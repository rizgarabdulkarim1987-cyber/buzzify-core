import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { exportInput, exportProducts } from '@/server/pharmacy/exports';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Exports (`catalog.view`), open while the pharmacy is read-only and closed once it is archived, like every pharmacy
 * query. A support actor with a `catalog.read` grant may export too: the framework audits that read like any other.
 */

export const products = defineQuery({
  name: 'ph.exports.products',
  permission: null,
  ph: 'catalog.view',
  allowReadOnly: true,
  input: exportInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    // The place's branch, when chosen, is the one whose minimum quantities are shown (the framework checked it is theirs).
    if (input.branchId !== undefined && !ph.branchIds.includes(input.branchId)) throw new StudioError('FORBIDDEN');
    return exportProducts(scoped, ph, input, { visibleBranchIds: input.branchId !== undefined ? [input.branchId] : ph.branchIds });
  },
});
