import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { getPurchaseOrder, listOrderReceipts, listPurchaseOrders, poListInput, poSuggestInput, suggestOrders } from '@/server/pharmacy/purchase-orders';
import { assertStaff } from '@/server/pharmacy/receipts';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Reading purchase orders (`purchase.manage`, R4-9). An order belongs to a branch: the scoped client keeps a branch-limited
 * actor to their branches, so another branch's order is not found. Money appears only for a role with `cost.view`. A
 * support actor reads none.
 */

export const list = defineQuery({
  name: 'ph.po.list',
  permission: null,
  ph: 'purchase.manage',
  input: poListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listPurchaseOrders(scoped, ph, input);
  },
});

export const get = defineQuery({
  name: 'ph.po.get',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ purchaseOrderId: z.string().min(1).max(64) }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return getPurchaseOrder(scoped, ph, input.purchaseOrderId);
  },
});

export const receipts = defineQuery({
  name: 'ph.po.receipts',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ purchaseOrderId: z.string().min(1).max(64) }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listOrderReceipts(scoped, input.purchaseOrderId);
  },
});

export const suggest = defineQuery({
  name: 'ph.po.suggest',
  permission: null,
  ph: 'purchase.manage',
  input: poSuggestInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    if (!input.branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
    return suggestOrders(scoped, { branchId: input.branchId, supplierId: input.supplierId });
  },
});
