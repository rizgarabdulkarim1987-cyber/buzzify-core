import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { cashMoveInput, type CashMoveInput, closeInput, closeShift, moveCash, openInput, openShift } from '@/server/pharmacy/shifts';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Shifts and cash (phase 3). Open, paid in and paid out need `shift.use` and name the ONE branch in the place; closing
 * is open to every pharmacy role at the framework and judged by the service (the owner of the shift, or `report.view`
 * with a reason). Audit entries carry ids, amounts, the variance and whether a reason was given (the text stays on its row); never a customer field.
 */

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';
const needBranch = (branchId: string | undefined): string => {
  if (!branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
  return branchId;
};

export const open = defineAction({
  name: 'ph.shifts.open',
  permission: null,
  ph: 'shift.use',
  input: openInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    const branchId = needBranch(input.branchId);
    try {
      return await ctx.transaction(async (tx) => {
        const { result, audit } = await openShift(tx, { ph, branchId, input });
        if (audit) {
          ctx.audit({
            action: 'ph.shift.open',
            entityType: 'PhShift',
            entityId: result.id,
            changes: {
              status: { before: null, after: 'OPEN' },
              branchId: { before: null, after: audit.branchId },
              currency: { before: null, after: audit.currency },
              openingFloatMinor: { before: null, after: audit.openingFloatMinor },
            },
          });
        }
        return result;
      });
    } catch (error) {
      // The partial unique index (one open shift per person and branch) or the key's unique index refused a write.
      if (isUnique(error)) throw new StudioError('CONFLICT', 'You already have an open shift here', { phCode: 'SHIFT_ALREADY_OPEN' });
      throw error;
    }
  },
});

type CashCtx = ActionContext;

async function runCash(ctx: CashCtx, input: CashMoveInput & { branchId?: string }, type: 'PAID_IN' | 'PAID_OUT', auditAction: string) {
  const { ph } = pharmacyOf(ctx);
  const branchId = needBranch(input.branchId);
  try {
    return await ctx.transaction(async (tx) => {
      const { result, audit } = await moveCash(tx, { ph, branchId, type, input });
      if (audit) {
        ctx.audit({
          action: auditAction,
          entityType: 'PhCashMovement',
          entityId: result.id,
          changes: {
            shiftId: { before: null, after: audit.shiftId },
            branchId: { before: null, after: audit.branchId },
            amountMinor: { before: null, after: audit.amountMinor },
            currency: { before: null, after: audit.currency },
            hasReason: { before: null, after: audit.reason.trim() !== '' },
          },
        });
      }
      return result;
    });
  } catch (error) {
    if (isUnique(error)) throw new StudioError('CONFLICT', 'This key was already used', { phCode: 'CLIENT_KEY_USED' });
    throw error;
  }
}

export const paidIn = defineAction({
  name: 'ph.cash.paidIn',
  permission: null,
  ph: 'shift.use',
  input: cashMoveInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run: (ctx, input) => runCash(ctx, input, 'PAID_IN', 'ph.shift.paidIn'),
});

export const paidOut = defineAction({
  name: 'ph.cash.paidOut',
  permission: null,
  ph: 'shift.use',
  input: cashMoveInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run: (ctx, input) => runCash(ctx, input, 'PAID_OUT', 'ph.shift.paidOut'),
});

export const close = defineAction({
  name: 'ph.shifts.close',
  permission: null,
  ph: 'catalog.view',
  input: closeInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    return ctx.transaction(async (tx) => {
      const { result, audit } = await closeShift(tx, { ph, input, branchId: input.branchId });
      ctx.audit({
        action: 'ph.shift.close',
        entityType: 'PhShift',
        entityId: result.id,
        changes: {
          status: { before: 'OPEN', after: 'CLOSED' },
          branchId: { before: null, after: audit.branchId },
          currency: { before: null, after: audit.currency },
          ownerUserId: { before: null, after: audit.ownerUserId },
          closedForOther: { before: null, after: audit.closedForOther },
          expectedMinor: { before: null, after: audit.expectedMinor },
          countedMinor: { before: null, after: audit.countedMinor },
          varianceMinor: { before: null, after: audit.varianceMinor },
          hasReason: { before: null, after: audit.reason.trim() !== '' },
          approvedById: { before: null, after: audit.approvedById },
          closedById: { before: null, after: audit.closedById },
        },
      });
      return result;
    });
  },
});
