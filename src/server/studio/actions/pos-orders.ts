import { z } from 'zod';
import { delegates } from '@/server/data/tenant-db';
import { canPos } from '@/server/domain/pos/permissions';
import { isUniqueViolation, refuse } from '@/server/pos/errors';
import { addLineIn, cancelLineIn, updateLineIn } from '@/server/pos/order-lines';
import { cancelOrderIn, moveToTableIn, openOrderIn, requestBillIn, setInvoiceDiscountIn } from '@/server/pos/orders';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { idField } from '@/server/studio/services/content';

/**
 * The cashier's orders and their lines. Every change names the version of the order it was made from (`expectedVersion`),
 * so two people changing one order never overwrite each other: the second is told to reload.
 */

const TILL = { kind: 'pos' } as const;
/** Adding a line reads the product from the restaurant's catalog menu, so it targets that menu. */
const CATALOG = { kind: 'pos', catalog: true } as const;

const INT32 = 2_147_483_647;
const expectedVersion = z.number().int().min(1).max(INT32);
const quantity = z.number().int().min(1).max(999);
const note = z.string().trim().max(300, 'Use at most 300 characters');
const reason = z.string().trim().max(300, 'Use at most 300 characters');
const discount = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('AMOUNT'), value: z.number().int().min(0).max(INT32) }),
  z.object({ kind: z.literal('PERCENT'), value: z.number().int().min(0).max(100) }),
]);

const OPEN_ATTEMPTS = 3;

function till(ctx: ActionContext) {
  if (ctx.pos === null || ctx.restaurantId === null) throw new Error('A till action ran without a till');
  return { pos: ctx.pos, restaurantId: ctx.restaurantId };
}

export const openPosOrder = defineAction({
  name: 'pos.openOrder',
  permission: null,
  pos: 'order.handle',
  input: z.object({ tableId: idField }),
  target: () => TILL,
  run: async (ctx, { tableId }) => {
    const { restaurantId } = till(ctx);
    // Two people opening at once can pick the same next number or the same table: the database refuses the second, and a
    // failed transaction cannot go on, so the whole thing is tried again (a taken table then answers with a conflict).
    for (let attempt = 1; attempt <= OPEN_ATTEMPTS; attempt++) {
      try {
        return await ctx.transaction(async (tx) => {
          const opened = await openOrderIn(delegates(tx), restaurantId, tableId);
          ctx.audit({ action: 'pos.order.open', entityType: 'PosOrder', entityId: opened.orderId, changes: { number: { before: null, after: opened.number }, tableId: { before: null, after: tableId } } });
          return opened;
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw refuse('CONFLICT', 'Could not open the order. Try again.');
  },
});

export const addPosLine = defineAction({
  name: 'pos.addLine',
  permission: null,
  pos: 'order.handle',
  input: z.object({
    orderId: idField,
    productId: idField,
    quantity,
    note,
    variantId: idField.optional(),
    optionIds: z.array(idField).max(50),
    expectedVersion,
    /** A till device's own time for the tap, when it replays a line added offline. */
    clientAt: z.iso.datetime().optional(),
  }),
  target: () => CATALOG,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    if (ctx.menuId === null) throw new StudioError('NOT_FOUND');
    const menuId = ctx.menuId;
    return ctx.transaction(async (tx) => {
      const { clientAt, ...line } = input;
      const added = await addLineIn(delegates(tx), restaurantId, menuId, { ...line, ...(clientAt ? { clientAt: new Date(clientAt) } : {}) });
      ctx.audit({
        action: 'pos.order.line.add',
        entityType: 'PosOrderLine',
        entityId: added.lineId,
        changes: { name: { before: null, after: added.name }, quantity: { before: null, after: added.quantity }, orderId: { before: null, after: added.orderId } },
      });
      return { orderId: added.orderId, lineId: added.lineId, version: added.version };
    });
  },
});

export const updatePosLine = defineAction({
  name: 'pos.updateLine',
  permission: null,
  pos: 'order.handle',
  input: z
    .object({ lineId: idField, expectedVersion, quantity: quantity.optional(), note: note.optional(), discount: discount.nullable().optional() })
    .refine((v) => v.quantity !== undefined || v.note !== undefined || v.discount !== undefined, { message: 'Nothing to change', path: ['quantity'] }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    // A discount is a permission of its own on top of handling orders.
    if (input.discount !== undefined && !canPos(pos.role, 'order.discount')) throw new StudioError('FORBIDDEN');
    return ctx.transaction(async (tx) => {
      const done = await updateLineIn(delegates(tx), restaurantId, input);
      ctx.audit({ action: 'pos.order.line.update', entityType: 'PosOrderLine', entityId: done.lineId, changes: done.changes });
      return { orderId: done.orderId, lineId: done.lineId, version: done.version };
    });
  },
});

export const cancelPosLine = defineAction({
  name: 'pos.cancelLine',
  permission: null,
  pos: 'order.cancel',
  input: z.object({ lineId: idField, expectedVersion, reason: reason.min(1, 'Enter a reason') }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await cancelLineIn(delegates(tx), restaurantId, input);
      ctx.audit({
        action: 'pos.order.line.cancel',
        entityType: 'PosOrderLine',
        entityId: done.lineId,
        changes: { name: { before: done.name, after: null }, quantity: { before: done.quantity, after: null }, reason: { before: null, after: input.reason }, sent: { before: done.sent, after: done.sent } },
      });
      return { orderId: done.orderId, lineId: done.lineId, version: done.version };
    });
  },
});

export const setPosInvoiceDiscount = defineAction({
  name: 'pos.setInvoiceDiscount',
  permission: null,
  pos: 'order.discount',
  input: z.object({ orderId: idField, expectedVersion, discount: discount.nullable() }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await setInvoiceDiscountIn(delegates(tx), restaurantId, input);
      ctx.audit({ action: 'pos.order.discount.invoice', entityType: 'PosOrder', entityId: done.orderId, changes: { discount: { before: done.before, after: done.after } } });
      return { orderId: done.orderId, version: done.version };
    });
  },
});

export const requestPosBill = defineAction({
  name: 'pos.requestBill',
  permission: null,
  pos: 'order.handle',
  input: z.object({ orderId: idField, expectedVersion }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await requestBillIn(delegates(tx), restaurantId, input);
      ctx.audit({ action: 'pos.order.bill.request', entityType: 'PosOrder', entityId: done.orderId, changes: { status: { before: done.from, after: 'BILL_REQUESTED' } } });
      return { orderId: done.orderId, version: done.version };
    });
  },
});

export const cancelPosOrder = defineAction({
  name: 'pos.cancelOrder',
  permission: null,
  pos: 'order.cancel',
  input: z.object({ orderId: idField, expectedVersion, reason }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await cancelOrderIn(delegates(tx), restaurantId, input);
      ctx.audit({
        action: 'pos.order.cancel',
        entityType: 'PosOrder',
        entityId: done.orderId,
        changes: { status: { before: done.from, after: 'CANCELLED' }, reason: { before: null, after: done.reason }, lines: { before: done.liveLines, after: 0 } },
      });
      return { orderId: done.orderId, version: done.version };
    });
  },
});

export const movePosOrderToTable = defineAction({
  name: 'pos.moveOrderToTable',
  permission: null,
  pos: 'order.handle',
  input: z.object({ orderId: idField, tableId: idField, expectedVersion }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await moveToTableIn(delegates(tx), restaurantId, input);
      ctx.audit({ action: 'pos.order.table.move', entityType: 'PosOrder', entityId: done.orderId, changes: { tableId: { before: done.from, after: done.to } } });
      return { orderId: done.orderId, version: done.version };
    });
  },
});
