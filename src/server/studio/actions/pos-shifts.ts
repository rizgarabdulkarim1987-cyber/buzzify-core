import { z } from 'zod';
import { delegates } from '@/server/data/tenant-db';
import { isUniqueViolation, refuse } from '@/server/pos/errors';
import { addExpenseIn, closeShiftIn, openShiftIn } from '@/server/pos/shifts';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { idField } from '@/server/studio/services/content';

/** A cashier's shift: the float counted in, cash taken out, and the count at the end. */

const TILL = { kind: 'pos' } as const;
const INT32 = 2_147_483_647;
const money = z.number().int().min(0).max(INT32);

function till(ctx: ActionContext) {
  if (ctx.pos === null || ctx.restaurantId === null) throw new Error('A till action ran without a till');
  return { pos: ctx.pos, restaurantId: ctx.restaurantId };
}

export const openPosShift = defineAction({
  name: 'pos.openShift',
  permission: null,
  pos: 'shift.use',
  input: z.object({ openingFloat: money }),
  target: () => TILL,
  run: async (ctx, { openingFloat }) => {
    const { pos, restaurantId } = till(ctx);
    try {
      return await ctx.transaction(async (tx) => {
        const { shiftId } = await openShiftIn(delegates(tx), restaurantId, { userId: pos.userId, openingFloat });
        ctx.audit({ action: 'pos.shift.open', entityType: 'PosShift', entityId: shiftId, changes: { openingFloat: { before: null, after: openingFloat } } });
        return { shiftId };
      });
    } catch (error) {
      // Two opens at once: the database lets only one through, so the other one has a shift already.
      if (isUniqueViolation(error)) throw refuse('CONFLICT', 'You already have an open shift');
      throw error;
    }
  },
});

export const addPosExpense = defineAction({
  name: 'pos.addExpense',
  permission: null,
  pos: 'shift.use',
  input: z.object({ shiftId: idField, amount: money.min(1), reason: z.string().trim().min(1, 'Enter a reason').max(200, 'Use at most 200 characters') }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await addExpenseIn(delegates(tx), restaurantId, { ...input, actor: { userId: pos.userId, role: pos.role } });
      ctx.audit({
        action: 'pos.shift.expense',
        entityType: 'PosCashExpense',
        entityId: done.expenseId,
        changes: { amount: { before: null, after: input.amount }, reason: { before: null, after: input.reason }, shiftId: { before: null, after: input.shiftId } },
      });
      return { expenseId: done.expenseId };
    });
  },
});

export const closePosShift = defineAction({
  name: 'pos.closeShift',
  permission: null,
  pos: 'shift.use',
  input: z.object({ shiftId: idField, countedCash: money, note: z.string().trim().max(300, 'Use at most 300 characters') }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await closeShiftIn(delegates(tx), restaurantId, { ...input, actor: { userId: pos.userId, role: pos.role } });
      ctx.audit({
        action: 'pos.shift.close',
        entityType: 'PosShift',
        entityId: done.shiftId,
        changes: { expected: { before: null, after: done.expected }, counted: { before: null, after: done.counted }, difference: { before: null, after: done.difference } },
      });
      return { shiftId: done.shiftId, expected: done.expected, counted: done.counted, difference: done.difference };
    });
  },
});
