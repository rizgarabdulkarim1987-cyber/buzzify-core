'use server';

import * as printActions from '@/server/pharmacy/actions/receipt-print';
import * as receipts from '@/server/pharmacy/actions/receipts';
import { invokePh, invokePhQuery } from '@/server/pharmacy/invoke';
import * as printQueries from '@/server/pharmacy/queries/receipt-print';
import * as productQueries from '@/server/pharmacy/queries/products';

// The receiving screens' Server Actions. `invokePh` puts in the place the person chose; the browser never names the pharmacy.

export async function createReceipt(input: unknown) {
  return invokePh(receipts.create, input);
}

export async function updateReceipt(input: unknown) {
  return invokePh(receipts.update, input);
}

export async function confirmReceipt(input: unknown) {
  return invokePh(receipts.confirm, input);
}

export async function voidReceipt(input: unknown) {
  return invokePh(receipts.voidReceipt, input);
}

/** A product's pack ladder, for the unit choice of a line just added. */
export async function receiptProduct(input: unknown) {
  return invokePhQuery(productQueries.get, input);
}

/** A sale's printable receipt, rendered by the server from the stored sale (never from the screen). */
export async function saleReceipt(input: unknown) {
  return invokePhQuery(printQueries.get, input);
}

export async function returnSlip(input: unknown) {
  return invokePhQuery(printQueries.returnReceipt, input);
}

/** A reprint: marked COPY and logged. */
export async function reprintReceipt(input: unknown) {
  return invokePh(printActions.reprintReceipt, input);
}
