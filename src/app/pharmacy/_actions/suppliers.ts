'use server';

import { invokePh } from '@/server/pharmacy/invoke';
import * as suppliers from '@/server/pharmacy/actions/suppliers';

// The supplier screens' Server Actions. `invokePh` puts in the place the person chose; the browser never names the pharmacy.

export async function createSupplier(input: unknown) {
  return invokePh(suppliers.create, input);
}

export async function updateSupplier(input: unknown) {
  return invokePh(suppliers.update, input);
}

export async function archiveSupplier(input: unknown) {
  return invokePh(suppliers.archive, input);
}
