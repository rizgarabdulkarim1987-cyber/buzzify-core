import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { receiptGetInput, receiptOfReturn, receiptOfSale, returnReceiptInput } from '@/server/pharmacy/receipt-print';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * The first print of a sale or a return slip (phase 3). Read-only and unlogged; the service narrows to the holders of
 * `shift.use` or `report.view`. Output: `{ html, text, model }` rendered from the stored rows.
 */

export const get = defineQuery({
  name: 'ph.receipts.get',
  permission: null,
  ph: 'catalog.view',
  input: receiptGetInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return receiptOfSale(scoped, ph, input);
  },
});

export const returnReceipt = defineQuery({
  name: 'ph.receipts.returnReceipt',
  permission: null,
  ph: 'catalog.view',
  input: returnReceiptInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return receiptOfReturn(scoped, ph, input);
  },
});
