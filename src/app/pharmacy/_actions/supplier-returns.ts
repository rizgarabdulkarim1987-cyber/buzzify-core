'use server';

import * as returns from '@/server/pharmacy/actions/supplier-returns';
import { invokePh } from '@/server/pharmacy/invoke';

// Returning stock to a supplier. The branch is the one the person chose; the browser never names it.

export async function createSupplierReturn(input: unknown) {
  return invokePh(returns.create, input);
}
