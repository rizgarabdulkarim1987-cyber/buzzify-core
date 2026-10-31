'use server';

import * as invoices from '@/server/pharmacy/actions/supplier-invoices';
import { invokePh } from '@/server/pharmacy/invoke';

// The supplier invoice screens' Server Actions. `invokePh` puts in the place the person chose; the browser never names the pharmacy.

export async function createInvoice(input: unknown) {
  return invokePh(invoices.create, input);
}

export async function voidInvoice(input: unknown) {
  return invokePh(invoices.voidInvoice, input);
}
