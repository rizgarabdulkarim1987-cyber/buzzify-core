import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { reprint, reprintInput } from '@/server/pharmacy/receipt-print';
import { defineAction } from '@/server/studio/framework/action';

/**
 * Reprinting a receipt or return slip (phase 3). Every reprint writes one `PhReceiptReprint` row (who, when, width) and is
 * audited with ids only; a repeated `clientKey` returns the copy already logged. The sale or return is never touched.
 */

export const reprintReceipt = defineAction({
  name: 'ph.receipts.reprint',
  permission: null,
  ph: 'catalog.view',
  input: reprintInput.and(phPlaceInput),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    // The service takes advisory locks (key, then document), so parallel reprints queue instead of colliding.
    return ctx.transaction(async (tx) => {
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
  },
});
