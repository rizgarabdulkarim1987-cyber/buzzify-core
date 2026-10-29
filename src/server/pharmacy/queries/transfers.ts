import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { getTransfer, inTransit as inTransitOf, inTransitInput, listTransfers, transferListInput } from '@/server/pharmacy/transfers';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Reading transfers (`transfer.manage`). A branch-limited actor sees only transfers that touch one of their branches (the
 * scoped client); a support actor reads none. No cost is shown here.
 */

export const list = defineQuery({
  name: 'ph.transfers.list',
  permission: null,
  ph: 'transfer.manage',
  input: transferListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listTransfers(scoped, ph, input);
  },
});

export const get = defineQuery({
  name: 'ph.transfers.get',
  permission: null,
  ph: 'transfer.manage',
  input: phPlaceInput.extend({ transferId: z.string().min(1).max(64) }),
  target: phTargetOf,
  run(ctx, input) {
    const { scoped, ph } = pharmacyOf(ctx);
    assertStaff(ph);
    return getTransfer(scoped, input.transferId);
  },
});

export const inTransit = defineQuery({
  name: 'ph.transfers.inTransit',
  permission: null,
  ph: 'transfer.manage',
  input: inTransitInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return inTransitOf(scoped, input);
  },
});
