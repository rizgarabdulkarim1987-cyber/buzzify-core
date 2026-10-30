import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { cancelInput, createReturn, RETURN_TIMEOUT_MS, returnInput, type ReturnAudit, type ReturnResult } from '@/server/pharmacy/returns';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Returns and cancels (phase 3). Both need `return.approve` (a cashier cannot): the actor IS the approver and the refund
 * lands on their own open shift. The place names the ONE branch the sale was made in. Idempotent by `clientKey`.
 * Audit entries carry ids, number, quantities, amounts and whether a reason was given (the text stays on the return); never a customer field or a cost.
 */

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

function auditOf(ctx: ActionContext, result: ReturnResult, a: ReturnAudit) {
  const common = {
    number: { before: null, after: a.number },
    saleId: { before: null, after: a.saleId },
    saleNumber: { before: null, after: a.saleNumber },
    branchId: { before: null, after: a.branchId },
    currency: { before: null, after: a.currency },
    refundMinor: { before: null, after: a.refundMinor },
    refundMethod: { before: null, after: a.refundMethod },
    ...(a.creditMinor === '0' ? {} : { creditMinor: { before: null, after: a.creditMinor } }),
    lineCount: { before: null, after: a.lineCount },
    baseQty: { before: null, after: a.baseQty },
    hasReason: { before: null, after: a.reason.trim() !== '' },
    status: { before: a.statusBefore, after: a.statusAfter },
  };
  if (a.kind === 'cancel') ctx.audit({ action: 'ph.sale.cancel', entityType: 'PhSale', entityId: a.saleId, changes: { ...common, returnId: { before: null, after: result.id } } });
  else ctx.audit({ action: 'ph.return.create', entityType: 'PhReturn', entityId: result.id, changes: common });
}

async function run(ctx: ActionContext, branch: string | undefined, request: Parameters<typeof createReturn>[1]['request']): Promise<ReturnResult> {
  const { ph } = pharmacyOf(ctx);
  if (!branch) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
  try {
    return await ctx.transaction(
      async (tx) => {
        const { result, audit } = await createReturn(tx, { ph, branchId: branch, request });
        if (audit) auditOf(ctx, result, audit);
        return result;
      },
      { timeoutMs: RETURN_TIMEOUT_MS },
    );
  } catch (error) {
    // The shift closed between the check and the insert: the database trigger (pharmacy_shift_closed_guard) refused it.
    if (String((error as { message?: unknown } | null)?.message ?? '').includes('PH_SHIFT_CLOSED')) {
      throw new StudioError('CONFLICT', 'Open a shift before refunding', { phCode: 'NO_OPEN_SHIFT' });
    }
    if (isUnique(error)) {
      const where = JSON.stringify((error as { meta?: unknown }).meta ?? {}) + String((error as { message?: unknown }).message ?? '');
      if (/PhReturn/.test(where) && /clientKey/.test(where)) throw new StudioError('CONFLICT', 'This key was already used', { phCode: 'CLIENT_KEY_USED' });
    }
    throw error;
  }
}

export const create = defineAction({
  name: 'ph.returns.create',
  permission: null,
  ph: 'return.approve',
  input: returnInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run: (ctx, input) => run(ctx, input.branchId, { kind: 'return', input }),
});

/** Cancelling a sale is a full return of everything that remains, by an approver; nothing is deleted or edited. */
export const cancel = defineAction({
  name: 'ph.sales.cancel',
  permission: null,
  ph: 'return.approve',
  input: cancelInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run: (ctx, input) => run(ctx, input.branchId, { kind: 'cancel', input }),
});
