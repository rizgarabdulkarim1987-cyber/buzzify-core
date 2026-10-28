import { z } from 'zod';
import { delegates } from '@/server/data/tenant-db';
import { POS_PAYMENT_METHODS } from '@/server/domain/pos/payment-methods';
import { payOrderIn } from '@/server/pos/payments';
import { reversePaymentIn } from '@/server/pos/refunds';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { idField } from '@/server/studio/services/content';

/** Taking the money for an order: cash, or a terminal method that is only recorded (never verified, online only). */

const TILL = { kind: 'pos' } as const;
const INT32 = 2_147_483_647;

const note = z
  .string()
  .trim()
  .max(100, 'Use at most 100 characters')
  .transform((value) => (value === '' ? undefined : value))
  .optional();

const leg = z.object({
  method: z.enum(POS_PAYMENT_METHODS),
  amount: z.number().int().min(1).max(INT32),
  tendered: z.number().int().min(0).max(INT32).optional(),
  reference: note,
});

function till(ctx: ActionContext) {
  if (ctx.pos === null || ctx.restaurantId === null) throw new Error('A till action ran without a till');
  return { pos: ctx.pos, restaurantId: ctx.restaurantId };
}

export const payPosOrder = defineAction({
  name: 'pos.payOrder',
  permission: null,
  pos: 'payment.take',
  input: z.object({
    orderId: idField,
    expectedVersion: z.number().int().min(1).max(INT32),
    expectedTotal: z.number().int().min(0).max(INT32),
    amountReceived: z.number().int().min(0).max(INT32).optional(),
    method: z.enum(POS_PAYMENT_METHODS).default('CASH'),
    reference: note,
    /** The bill paid with several methods; used instead of `method` and `amountReceived` when given. */
    legs: z.array(leg).min(1).max(POS_PAYMENT_METHODS.length).optional(),
    tip: z.object({ amount: z.number().int().min(0).max(INT32), method: z.enum(POS_PAYMENT_METHODS) }).optional(),
    /** Pay only these lines (one guest's share); without it, every line still unpaid. */
    lineIds: z.array(idField).min(1).max(200).optional(),
  }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await payOrderIn(delegates(tx), restaurantId, { ...input, userId: pos.userId });
      ctx.audit({
        action: 'pos.payment.take',
        entityType: 'PosPayment',
        entityId: done.paymentId,
        changes: {
          orderId: { before: null, after: done.orderId },
          total: { before: null, after: done.total },
          change: { before: null, after: done.change },
          method: { before: null, after: done.method },
          ...(input.legs === undefined ? {} : { legs: { before: null, after: input.legs.map((l) => ({ method: l.method, amount: l.amount })) } }),
          ...(done.tip > 0 ? { tip: { before: null, after: done.tip } } : {}),
          ...(input.reference === undefined ? {} : { reference: { before: null, after: input.reference } }),
          ...(done.part > 1 || !done.paid ? { part: { before: null, after: done.part } } : {}),
          status: { before: done.from, after: done.paid ? 'PAID' : done.from },
        },
      });
      if (done.consumed > 0) {
        ctx.audit({ action: 'pos.stock.consume', entityType: 'PosPayment', entityId: done.paymentId, changes: { movements: { before: null, after: done.consumed } } });
      }
      return { paymentId: done.paymentId, change: done.change, total: done.total };
    });
  },
});

/**
 * Reverses a paid order's payment in full, as a counter-entry under the reverser's name (a manager or owner with a shift
 * of their own). Online only: it is not one of the operations a device may queue.
 */
export const reversePosPayment = defineAction({
  name: 'pos.reversePayment',
  permission: null,
  pos: 'payment.refund',
  input: z.object({
    orderId: idField,
    /** The part to reverse when the bill was split. */
    paymentId: idField.optional(),
    expectedVersion: z.number().int().min(1).max(INT32),
    reason: z.string().trim().min(1, 'Enter a reason').max(300, 'Use at most 300 characters'),
    reference: z
      .string()
      .trim()
      .max(100, 'Use at most 100 characters')
      .transform((value) => (value === '' ? undefined : value))
      .optional(),
  }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await reversePaymentIn(delegates(tx), restaurantId, { ...input, userId: pos.userId });
      ctx.audit({
        action: 'pos.payment.reverse',
        entityType: 'PosPayment',
        entityId: done.paymentId,
        changes: {
          orderId: { before: null, after: done.orderId },
          method: { before: null, after: done.method },
          amount: { before: null, after: done.amount },
          reason: { before: null, after: input.reason },
          ...(input.reference === undefined ? {} : { reference: { before: null, after: input.reference } }),
        },
      });
      return { reversalId: done.reversalId, amount: done.amount, method: done.method, version: done.version };
    });
  },
});
