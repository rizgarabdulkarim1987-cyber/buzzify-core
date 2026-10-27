import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { reprint, reprintInput } from '@/server/pharmacy/receipt-print';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Reprinting a receipt or return slip (phase 3). Every reprint writes one `PhReceiptReprint` row (who, when, width) and is
 * audited with ids only; a repeated `clientKey` returns the copy already logged. The sale or return is never touched.
 */

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

export const reprintReceipt = defineAction({
  name: 'ph.receipts.reprint',
  permission: null,
  ph: 'catalog.view',
  input: reprintInput.and(phPlaceInput),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    const attempt = () =>
      ctx.transaction(async (tx) => {
        const { result, audit } = await reprint(tx, ph, input);
        if (audit) {
          ctx.audit({
            action: 'ph.receipt.reprint',
            entityType: audit.documentType,
            entityId: audit.documentId,
            changes: {
              branchId: { before: null, after: audit.branchId },
              copyNumber: { before: null, after: audit.copyNumber },
              width: { before: null, after: audit.width },
            },
          });
        }
        return result;
      });
    // A parallel reprint took the same copy number (or the same key): run again, it gets the next number or finds its row.
    for (let tries = 0; ; tries += 1) {
      try {
        return await attempt();
      } catch (error) {
        if (!isUnique(error)) throw error;
        if (tries >= 3) throw new StudioError('CONFLICT', 'This key was already used', { phCode: 'CLIENT_KEY_USED' });
      }
    }
  },
});
