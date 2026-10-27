'use server';

import * as receipts from '@/server/pharmacy/actions/receipts';
import { invokePh, invokePhQuery } from '@/server/pharmacy/invoke';
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
