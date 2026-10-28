import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { getSupplierReturn, listSupplierReturns, returnListInput } from '@/server/pharmacy/supplier-returns';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Reading supplier returns (`purchase.manage`, R4-9). A return belongs to a branch: the scoped client keeps a branch-limited
 * actor to their branches, so another branch's return is not found. Cost and value appear only for a role with `cost.view`.
 * A support actor reads none.
 */

export const list = defineQuery({
  name: 'ph.supplierReturns.list',
  permission: null,
  ph: 'purchase.manage',
  input: returnListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listSupplierReturns(scoped, ph, input);
  },
});

export const get = defineQuery({
  name: 'ph.supplierReturns.get',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ returnId: z.string().min(1).max(64) }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return getSupplierReturn(scoped, ph, input.returnId);
  },
});
