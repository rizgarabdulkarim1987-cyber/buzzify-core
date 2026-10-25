import { z } from 'zod';
import { delegates } from '@/server/data/tenant-db';
import { QR_LIMITS } from '@/server/domain/pos/customer-order-rules';
import { isUniqueViolation, refuse } from '@/server/pos/errors';
import { acceptRequestIn, rejectRequestIn, removeRequestLineIn, setRequestLineQuantityIn } from '@/server/pos/customer-orders';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { idField } from '@/server/studio/services/content';

/** What the cashier does with a guest's QR order: change a quantity, remove a line, accept it into an order or reject it. */

const TILL = { kind: 'pos' } as const;
/** Accepting reads the products' kitchen sections, so it targets the catalog menu. */
const CATALOG = { kind: 'pos', catalog: true } as const;
const INT32 = 2_147_483_647;
const ATTEMPTS = 3;

function till(ctx: ActionContext) {
  if (ctx.pos === null || ctx.restaurantId === null) throw new Error('A till action ran without a till');
  return { pos: ctx.pos, restaurantId: ctx.restaurantId };
}

export const setPosRequestLineQuantity = defineAction({
  name: 'pos.setRequestLineQuantity',
  permission: null,
  pos: 'order.handle',
  input: z.object({ lineId: idField, quantity: z.number().int().min(1).max(QR_LIMITS.maxQuantity) }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await setRequestLineQuantityIn(delegates(tx), restaurantId, input);
      ctx.audit({
        action: 'pos.request.edit',
        entityType: 'PosCustomerOrderLine',
        entityId: done.lineId,
        changes: { quantity: { before: done.before, after: done.after } },
      });
      return { requestId: done.requestId };
    });
  },
});

export const removePosRequestLine = defineAction({
  name: 'pos.removeRequestLine',
  permission: null,
  pos: 'order.handle',
  input: z.object({ lineId: idField }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await removeRequestLineIn(delegates(tx), restaurantId, input);
      ctx.audit({
        action: 'pos.request.edit',
        entityType: 'PosCustomerOrderLine',
        entityId: done.lineId,
        changes: { name: { before: done.name, after: null }, quantity: { before: done.quantity, after: null } },
      });
      return { requestId: done.requestId };
    });
  },
});

export const acceptPosRequest = defineAction({
  name: 'pos.acceptRequest',
  permission: null,
  pos: 'order.handle',
  input: z.object({ requestId: idField, expectedOrderVersion: z.number().int().min(1).max(INT32).optional() }),
  target: () => CATALOG,
  run: async (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    // Two people opening a table at once can pick the same next number or the same table: the database refuses the second,
    // and a failed transaction cannot go on, so the whole acceptance is tried again.
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        return await ctx.transaction(async (tx) => {
          const done = await acceptRequestIn(delegates(tx), restaurantId, { ...input, userId: pos.userId });
          ctx.audit({
            action: 'pos.request.accept',
            entityType: 'PosCustomerOrder',
            entityId: done.requestId,
            changes: {
              status: { before: 'PENDING', after: 'ACCEPTED' },
              orderId: { before: null, after: done.orderId },
              lines: { before: null, after: done.lineCount },
            },
          });
          return { orderId: done.orderId, created: done.created, version: done.version };
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw refuse('CONFLICT', 'Could not open the order. Try again.');
  },
});

export const rejectPosRequest = defineAction({
  name: 'pos.rejectRequest',
  permission: null,
  pos: 'order.handle',
  input: z.object({ requestId: idField, reason: z.string().trim().max(200, 'Use at most 200 characters') }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await rejectRequestIn(delegates(tx), restaurantId, { ...input, userId: pos.userId });
      ctx.audit({
        action: 'pos.request.reject',
        entityType: 'PosCustomerOrder',
        entityId: done.requestId,
        changes: { status: { before: 'PENDING', after: 'REJECTED' }, reason: { before: null, after: done.reason } },
      });
      return { requestId: done.requestId };
    });
  },
});
