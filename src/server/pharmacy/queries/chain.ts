import { chainDashboard, chainInput } from '@/server/pharmacy/chain';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * The chain dashboard (phase 6, task 5; R6-8): for `report.view`, open while the pharmacy is read-only. It covers every branch the
 * person works in (the place's branch does not narrow it: a one-branch view is the reports); a person with one branch is told so.
 */
export const dashboard = defineQuery({
  name: 'ph.chain.dashboard',
  permission: null,
  ph: 'report.view',
  allowReadOnly: true,
  input: chainInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return chainDashboard(scoped, ph, input);
  },
});
