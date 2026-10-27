import { z } from 'zod';
import { adjustShape, adjustStock, checkAdjust, checkQuantity, damageShape, damageStock, releaseQuarantine, releaseShape, reverseShape, reverseStock, type MovementDone } from '@/server/pharmacy/adjustments';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Manual stock changes (R2-3, R2-5, R2-6): adjust, damage, release from quarantine, and reverse. All need
 * `stock.adjust` (OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE) and work in the validated place's branch, which is
 * required: a branch-limited actor can only name their own (the framework refuses any other).
 */

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';
const isShort = (error: unknown) => error instanceof StudioError && error.fields?.phCode === 'INSUFFICIENT_STOCK';

function branchOf(input: { branchId?: string | undefined }): string {
  if (!input.branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose a branch' });
  return input.branchId;
}

/**
 * Runs a change once more when it lost a race with the same client key: the database kept one movement (unique
 * violation) or the winner took the stock first. The second run finds the winner's movement and returns it.
 */
async function withKey<T>(clientKey: string | undefined, attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (clientKey === undefined || !(isUnique(error) || isShort(error))) throw error;
    return attempt();
  }
}

const changes = (done: MovementDone, reason: string) => ({
  batchId: { before: null, after: done.batchId },
  type: { before: null, after: done.type },
  baseQty: { before: null, after: done.baseQty },
  bucketFrom: { before: null, after: done.from },
  bucketTo: { before: null, after: done.to },
  reason: { before: null, after: reason.slice(0, 300) },
});

const answer = (done: MovementDone) => ({ id: done.id, replayed: done.replayed, reversed: done.reversed });

export const adjust = defineAction({
  name: 'ph.stock.adjust',
  permission: null,
  ph: 'stock.adjust',
  input: z.object({ ...adjustShape, ...phPlaceInput.shape }).superRefine(checkAdjust),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    const branchId = branchOf(input);
    return withKey(input.clientKey, () =>
      ctx.transaction(async (tx) => {
        const done = await adjustStock(tx, { restaurantId: ph.restaurantId, branchId, userId: ph.userId }, input);
        if (!done.replayed) ctx.audit({ action: 'ph.stock.adjust', entityType: 'PhStockMovement', entityId: done.id, changes: changes(done, input.reason) });
        return answer(done);
      }),
    );
  },
});

export const damage = defineAction({
  name: 'ph.stock.damage',
  permission: null,
  ph: 'stock.adjust',
  input: z.object({ ...damageShape, ...phPlaceInput.shape }).superRefine(checkQuantity),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    const branchId = branchOf(input);
    return withKey(input.clientKey, () =>
      ctx.transaction(async (tx) => {
        const done = await damageStock(tx, { restaurantId: ph.restaurantId, branchId, userId: ph.userId }, input);
        if (!done.replayed) ctx.audit({ action: 'ph.stock.damage', entityType: 'PhStockMovement', entityId: done.id, changes: changes(done, input.reason) });
        return answer(done);
      }),
    );
  },
});

export const quarantineRelease = defineAction({
  name: 'ph.stock.quarantineRelease',
  permission: null,
  ph: 'stock.adjust',
  input: z.object({ ...releaseShape, ...phPlaceInput.shape }).superRefine(checkQuantity),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    const branchId = branchOf(input);
    return withKey(input.clientKey, () =>
      ctx.transaction(async (tx) => {
        const done = await releaseQuarantine(tx, { restaurantId: ph.restaurantId, branchId, userId: ph.userId }, input);
        if (!done.replayed) {
          ctx.audit({
            action: 'ph.stock.quarantine.release',
            entityType: 'PhStockMovement',
            entityId: done.id,
            changes: { ...changes(done, input.reason), decision: { before: null, after: input.decision } },
          });
        }
        return answer(done);
      }),
    );
  },
});

export const reverse = defineAction({
  name: 'ph.stock.reverse',
  permission: null,
  ph: 'stock.adjust',
  input: z.object({ ...reverseShape, ...phPlaceInput.shape }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    const branchId = branchOf(input);
    return ctx.transaction(async (tx) => {
      const done = await reverseStock(tx, { restaurantId: ph.restaurantId, branchId, userId: ph.userId }, input);
      ctx.audit({
        action: 'ph.stock.reverse',
        entityType: 'PhStockMovement',
        entityId: done.id,
        changes: {
          reversesId: { before: null, after: done.reversesId },
          type: { before: null, after: done.type },
          batchId: { before: null, after: done.batchId },
          reason: { before: null, after: input.reason.slice(0, 300) },
        },
      });
      return { id: done.id, reversesId: done.reversesId };
    });
  },
});
