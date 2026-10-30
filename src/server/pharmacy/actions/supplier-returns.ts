import { canPh } from '@/server/domain/pharmacy/permissions';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { createSupplierReturn, returnFields } from '@/server/pharmacy/supplier-returns';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Returning stock to a supplier (R4-7, R4-7a). It removes stock, so it needs `purchase.manage` AND `stock.adjust`: the owner,
 * a branch manager and the pharmacist in charge hold both; a stock clerk and an accountant do not. It works in the validated
 * place's branch, which is required. The audit row carries ids, the number, branch, bucket and quantity of each line, and
 * counts: never the reason or the note.
 */

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

/** Up to 100 lines, a few writes each: more than the default transaction time on a slow day. */
const SLOW = { timeoutMs: 60_000 };

export const create = defineAction({
  name: 'ph.supplierReturns.create',
  permission: null,
  ph: 'purchase.manage',
  input: returnFields.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    if (ph.role === null || !canPh(ph.role, 'stock.adjust')) throw new StudioError('FORBIDDEN');
    if (!input.branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose a branch' });
    const branchId = input.branchId;
    const attempt = () =>
      ctx.transaction(async (tx) => {
        const made = await createSupplierReturn(tx, { restaurantId: ph.restaurantId, branchId, userId: ph.userId, clientKey: input.clientKey, input });
        if (!made.replayed) {
          ctx.audit({
            action: 'ph.supplierReturn.create',
            entityType: 'PhSupplierReturn',
            entityId: made.id,
            changes: {
              number: { before: null, after: made.number },
              supplierId: { before: null, after: made.supplierId },
              branchId: { before: null, after: made.branchId },
              lineCount: { before: null, after: made.lines.length },
              lines: { before: null, after: made.lines.map((l) => `${l.batchId}:${l.bucket}:${l.qty}`) },
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
