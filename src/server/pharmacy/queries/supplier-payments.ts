import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { getPayment, listPayments, paymentListInput } from '@/server/pharmacy/supplier-payments';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Reading supplier payments (`purchase.manage`, R4-9). Payments belong to the business, so any branch of it sees them all.
 * Money appears only for a role with `cost.view`. A support actor reads none.
 */

export const list = defineQuery({
  name: 'ph.supplierPayments.list',
  permission: null,
  ph: 'purchase.manage',
  input: paymentListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listPayments(scoped, ph, input);
  },
});

export const get = defineQuery({
  name: 'ph.supplierPayments.get',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ paymentId: z.string().min(1).max(64) }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return getPayment(scoped, ph, input.paymentId);
  },
});
