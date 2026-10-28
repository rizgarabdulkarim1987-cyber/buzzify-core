import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import {
  cancelPurchaseOrder,
  closePurchaseOrder,
  closeReason,
  createPurchaseOrder,
  placeOrder,
  poFields,
  updatePurchaseOrder,
  type PoChanged,
} from '@/server/pharmacy/purchase-orders';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Purchase orders (R4-2): all need `purchase.manage`. An order belongs to one branch: the validated place's, which is
 * required. The audit rows carry ids, status before and after, version, currency and line count: never the note, the
 * closing reason, or any name.
 */

const purchaseOrderId = z.string().min(1).max(64);
const clientKey = z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters');
const expectedVersion = z.number().int().min(1);

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

function branchOf(input: { branchId?: string }): string {
  if (!input.branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
  return input.branchId;
}

/** Up to 200 lines, a few writes each: more than the default transaction time on a slow day. */
const SLOW = { timeoutMs: 60_000 };

export const create = defineAction({
  name: 'ph.po.create',
  permission: null,
  ph: 'purchase.manage',
  input: poFields.extend(phPlaceInput.shape).extend({ clientKey }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    const branchId = branchOf(input);
    const attempt = () =>
      ctx.transaction(async (tx) => {
        const made = await createPurchaseOrder(tx, { restaurantId: ph.restaurantId, branchId, userId: ph.userId, clientKey: input.clientKey, input });
        if (!made.replayed) {
          ctx.audit({
            action: 'ph.po.create',
            entityType: 'PhPurchaseOrder',
            entityId: made.id,
            changes: {
              status: { before: null, after: 'DRAFT' },
              version: { before: null, after: made.version },
              branchId: { before: null, after: branchId },
              currency: { before: null, after: made.currency },
              lineCount: { before: null, after: made.lineCount },
            },
          });
        }
        return made;
      }, SLOW);
    try {
      return await attempt();
    } catch (error) {
      if (!isUnique(error)) throw error;
      // Two saves with one key at once: the database kept one. Run again: it is found, compared and returned.
      try {
        return await attempt();
      } catch (again) {
        if (!isUnique(again)) throw again;
        throw new StudioError('CONFLICT', 'This key was already used', { phCode: 'CLIENT_KEY_USED' });
      }
    }
  },
});

function changeAudit(changed: PoChanged, expected: number) {
  return {
    entityType: 'PhPurchaseOrder',
    entityId: changed.id,
    changes: {
      status: { before: changed.before, after: changed.status },
      version: { before: expected, after: changed.version },
      currency: { before: changed.currency, after: changed.currency },
      lineCount: { before: changed.lineCount, after: changed.lineCount },
    },
  };
}

const result = (changed: PoChanged) => ({ id: changed.id, version: changed.version, status: changed.status, number: changed.number });

export const update = defineAction({
  name: 'ph.po.update',
  permission: null,
  ph: 'purchase.manage',
  input: poFields.extend(phPlaceInput.shape).extend({ purchaseOrderId, expectedVersion }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    return ctx.transaction(async (tx) => {
      const saved = await updatePurchaseOrder(tx, { restaurantId: ph.restaurantId, purchaseOrderId: input.purchaseOrderId, expectedVersion: input.expectedVersion, input });
      ctx.audit({ action: 'ph.po.update', ...changeAudit(saved, input.expectedVersion) });
      return result(saved);
    }, SLOW);
  },
});

export const order = defineAction({
  name: 'ph.po.order',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ purchaseOrderId, expectedVersion }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    return ctx.transaction(async (tx) => {
      const placed = await placeOrder(tx, { restaurantId: ph.restaurantId, purchaseOrderId: input.purchaseOrderId, expectedVersion: input.expectedVersion, userId: ph.userId });
      ctx.audit({ action: 'ph.po.order', ...changeAudit(placed, input.expectedVersion) });
      return result(placed);
    });
  },
});

export const cancel = defineAction({
  name: 'ph.po.cancel',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ purchaseOrderId, expectedVersion }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    return ctx.transaction(async (tx) => {
      const cancelled = await cancelPurchaseOrder(tx, { restaurantId: ph.restaurantId, purchaseOrderId: input.purchaseOrderId, expectedVersion: input.expectedVersion });
      ctx.audit({ action: 'ph.po.cancel', ...changeAudit(cancelled, input.expectedVersion) });
      return result(cancelled);
    });
  },
});

export const close = defineAction({
  name: 'ph.po.close',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ purchaseOrderId, expectedVersion, reason: closeReason }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    return ctx.transaction(async (tx) => {
      const closed = await closePurchaseOrder(tx, { restaurantId: ph.restaurantId, purchaseOrderId: input.purchaseOrderId, expectedVersion: input.expectedVersion, userId: ph.userId, reason: input.reason });
      ctx.audit({ action: 'ph.po.close', ...changeAudit(closed, input.expectedVersion) });
      return result(closed);
    });
  },
});
