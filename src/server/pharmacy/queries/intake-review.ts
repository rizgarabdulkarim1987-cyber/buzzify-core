import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { batchListInput, getBatch, listBatches } from '@/server/pharmacy/intake/batches';
import { mayViewCost, pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Invoice intake, reading batches (R5-14: `purchase.manage`; a support actor reads none). Flags, matches and the approval verdict
 * are derived at read time from what is stored; money keys exist only for a role with `cost.view`.
 */

export const batchList = defineQuery({
  name: 'ph.intake.batch.list',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend(batchListInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listBatches(scoped, input, mayViewCost(ph));
  },
});

export const batchGet = defineQuery({
  name: 'ph.intake.batch.get',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ batchId: z.string().min(1).max(64) }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return getBatch(scoped, input.batchId, input.branchId, mayViewCost(ph), new Date());
  },
});
