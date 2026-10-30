import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { setExpiryStatus, setStatusInput } from '@/server/pharmacy/expiry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Expiry follow-up status of a batch in the place's branch (required). Needs `stock.adjust` because DISPOSED may write
 * the rest of the stock off. MOVED and RETURNED are labels only in phase 2.
 */
export const setStatus = defineAction({
  name: 'ph.stock.expiry.setStatus',
  permission: null,
  ph: 'stock.adjust',
  input: setStatusInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    if (!input.branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose a branch' });
    const branchId = input.branchId;
    return ctx.transaction(async (tx) => {
      const done = await setExpiryStatus(tx, { restaurantId: ph.restaurantId, branchId, userId: ph.userId }, input);
      if (done.changed) {
        ctx.audit({
          action: 'ph.expiry.setStatus',
          entityType: 'PhExpiryAction',
          entityId: done.id,
          changes: {
            batchId: { before: null, after: input.batchId },
            status: { before: null, after: done.status },
            assigneeId: { before: null, after: done.assigneeId },
            noteLength: { before: null, after: input.note === undefined ? null : input.note.length },
            disposedQty: { before: null, after: done.disposedQty },
          },
        });
      }
      return done;
    });
  },
});
