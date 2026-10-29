import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { approveBatch, approveInput, cancelBatch, cancelInput, retryable } from '@/server/pharmacy/intake/approve';
import { storageOrRefuse } from '@/server/pharmacy/intake/files';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Invoice intake, approval and cancel (R5-1, R5-10, R5-11, R5-14): both need `purchase.manage` and nothing more (the
 * framework checks it), in the validated place's branch. Approval makes a DRAFT receipt and never touches stock. The audit
 * rows carry ids, counts and flag codes only.
 */

/** A draft of up to 200 lines, its checks and its locks: more than the default transaction time on a slow day. */
const APPROVE_TIMEOUT_MS = 60_000;

function branchOf(input: { branchId?: string }): string {
  if (!input.branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
  return input.branchId;
}

export const approve = defineAction({
  name: 'ph.intake.approve',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend(approveInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertStaff(ph);
    const branchId = branchOf(input);
    try {
      return await ctx.transaction(
        (tx) =>
          approveBatch(tx, {
            restaurantId: ph.restaurantId,
            branchId,
            userId: ph.userId,
            batchId: input.batchId,
            clientKey: input.clientKey,
            expectedVersion: input.expectedVersion,
            verdictToken: input.verdictToken,
            now: new Date(),
            audit: (e) => ctx.audit(e),
          }),
        { timeoutMs: APPROVE_TIMEOUT_MS },
      );
    } catch (error) {
      throw retryable(error);
    }
  },
});

export const cancel = defineAction({
  name: 'ph.intake.cancel',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend(cancelInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertStaff(ph);
    const branchId = branchOf(input);
    const storage = storageOrRefuse();
    try {
      return await ctx.transaction((tx) => cancelBatch(tx, storage, { restaurantId: ph.restaurantId, branchId, batchId: input.batchId, reason: input.reason, now: new Date(), audit: (e) => ctx.audit(e) }), { timeoutMs: APPROVE_TIMEOUT_MS });
    } catch (error) {
      throw retryable(error);
    }
  },
});
