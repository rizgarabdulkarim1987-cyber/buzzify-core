import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { getSupplier, listSuppliers, supplierListInput } from '@/server/pharmacy/suppliers';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Reading suppliers (`purchase.manage`, R4-9: the people who may buy are the people who may see who they buy from). A
 * supplier belongs to the business, so any branch of it sees every supplier. A support actor reads none.
 */

export const list = defineQuery({
  name: 'ph.suppliers.list',
  permission: null,
  ph: 'purchase.manage',
  input: supplierListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listSuppliers(scoped, input);
  },
});

export const get = defineQuery({
  name: 'ph.suppliers.get',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ supplierId: z.string().min(1).max(64) }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return getSupplier(scoped, input.supplierId);
  },
});
