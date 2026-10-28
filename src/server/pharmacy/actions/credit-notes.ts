import { canPh } from '@/server/domain/pharmacy/permissions';
import { creditFields, recordCreditNote } from '@/server/pharmacy/credit-notes';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Recording a supplier's credit note (R4-7, R4-9a). It is money: it needs `purchase.manage` AND `report.view` (owner, branch
 * manager, pharmacist in charge, accountant). The note belongs to the business, so the place's branch plays no part. The audit
 * row carries ids, currency, amount and date: never the note text or the supplier's number.
 */

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

export const record = defineAction({
  name: 'ph.credits.record',
  permission: null,
  ph: 'purchase.manage',
  input: creditFields.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    if (ph.role === null || !canPh(ph.role, 'report.view')) throw new StudioError('FORBIDDEN');
    const attempt = () =>
      ctx.transaction(async (tx) => {
        const made = await recordCreditNote(tx, { restaurantId: ph.restaurantId, userId: ph.userId, clientKey: input.clientKey, input });
        if (!made.replayed) {
          ctx.audit({
            action: 'ph.credit.record',
            entityType: 'PhCreditNote',
            entityId: made.id,
            changes: {
              supplierId: { before: null, after: made.supplierId },
              currency: { before: null, after: made.currency },
              amountMinor: { before: null, after: made.amountMinor },
              noteDate: { before: null, after: made.noteDate },
              supplierReturnId: { before: null, after: made.supplierReturnId },
            },
          });
        }
        return made;
      });
    try {
      return await attempt();
    } catch (error) {
      if (!isUnique(error)) throw error;
      // Two saves at once (one key, or two keys with one number): the database kept one. Run again: it is found and answered.
      try {
        return await attempt();
      } catch (again) {
        if (!isUnique(again)) throw again;
        throw new StudioError('CONFLICT', 'This key was already used', { phCode: 'CLIENT_KEY_USED' });
      }
    }
  },
});
