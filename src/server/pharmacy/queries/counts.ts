import { z } from 'zod';
import { assertStaff, countListInput, getCount, listCounts } from '@/server/pharmacy/counts';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Reading counts (`stock.count`: a cashier or pharmacist reads none; a support actor reads none). While a count is
 * blind and OPEN, expected quantities are absent from what anyone receives. Cost keys exist only for `cost.view`.
 */

export const list = defineQuery({
  name: 'ph.stock.count.list',
  permission: null,
  ph: 'stock.count',
  input: countListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listCounts(scoped, input);
  },
});

export const get = defineQuery({
  name: 'ph.stock.count.get',
  permission: null,
  ph: 'stock.count',
  input: phPlaceInput.extend({ countId: z.string().min(1).max(64) }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return getCount(scoped, ph, input.countId);
  },
});
