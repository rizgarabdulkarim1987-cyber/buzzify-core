import { z } from 'zod';
import { delegates } from '@/server/data/tenant-db';
import { acknowledgeCancellationsIn, markLinesReadyIn, QUEUE_LIMIT, sendToKitchenIn } from '@/server/pos/kitchen';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { idField } from '@/server/studio/services/content';

/** The kitchen: sending a round, marking food ready and seeing a cancellation. */

const TILL = { kind: 'pos' } as const;
const INT32 = 2_147_483_647;
const lineIds = z
  .array(idField)
  .min(1)
  .max(QUEUE_LIMIT)
  .transform((ids) => [...new Set(ids)]);

function till(ctx: ActionContext) {
  if (ctx.pos === null || ctx.restaurantId === null) throw new Error('A till action ran without a till');
  return { pos: ctx.pos, restaurantId: ctx.restaurantId };
}

export const sendPosToKitchen = defineAction({
  name: 'pos.sendToKitchen',
  permission: null,
  pos: 'order.handle',
  input: z.object({ orderId: idField, expectedVersion: z.number().int().min(1).max(INT32) }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await sendToKitchenIn(delegates(tx), restaurantId, input);
      ctx.audit({
        action: 'pos.order.kitchen.send',
        entityType: 'PosOrder',
        entityId: done.orderId,
        changes: { batch: { before: null, after: done.batch }, lineCount: { before: null, after: done.lineCount } },
      });
      return { batch: done.batch, lineCount: done.lineCount, version: done.version };
    });
  },
});

export const markPosLinesReady = defineAction({
  name: 'pos.markReady',
  permission: null,
  pos: 'kitchen.view',
  input: z.object({ lineIds }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await markLinesReadyIn(delegates(tx), restaurantId, { lineIds: input.lineIds, actor: { userId: pos.userId, role: pos.role } });
      for (const line of done.marked) ctx.audit({ action: 'pos.order.kitchen.ready', entityType: 'PosOrderLine', entityId: line.lineId, changes: { orderId: { before: null, after: line.orderId } } });
      for (const order of done.readied) ctx.audit({ action: 'pos.order.ready', entityType: 'PosOrder', entityId: order.orderId, changes: { status: { before: 'OPEN', after: 'READY' } } });
      return { ready: done.ready };
    });
  },
});

export const acknowledgePosCancellations = defineAction({
  name: 'pos.acknowledgeCancellations',
  permission: null,
  pos: 'kitchen.view',
  input: z.object({ lineIds }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await acknowledgeCancellationsIn(delegates(tx), restaurantId, { lineIds: input.lineIds, actor: { userId: pos.userId, role: pos.role } });
      for (const line of done.lines) ctx.audit({ action: 'pos.order.kitchen.ack', entityType: 'PosOrderLine', entityId: line.lineId, changes: { orderId: { before: null, after: line.orderId } } });
      return { acknowledged: done.acknowledged };
    });
  },
});
