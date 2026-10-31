import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff, getReceipt, listReceipts, receiptListInput } from '@/server/pharmacy/receipts';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Reading receipts (`catalog.view`: every pharmacy role; a support actor reads none). Cost keys exist only in what a
 * role with `cost.view` receives.
 */

export const list = defineQuery({
  name: 'ph.stock.receipt.list',
  permission: null,
  ph: 'catalog.view',
  input: receiptListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listReceipts(scoped, input);
  },
});

export const get = defineQuery({
  name: 'ph.stock.receipt.get',
  permission: null,
  ph: 'catalog.view',
  input: phPlaceInput.extend({ receiptId: z.string().min(1).max(64) }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return getReceipt(scoped, ph, input.receiptId);
  },
});
