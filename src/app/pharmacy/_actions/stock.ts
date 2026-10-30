'use server';

import * as stock from '@/server/pharmacy/actions/stock';
import { invokePh, invokePhQuery } from '@/server/pharmacy/invoke';
import * as stockQueries from '@/server/pharmacy/queries/stock';

// The stock screens' Server Actions. `invokePh` puts in the place the person chose; the browser never names the pharmacy.

export async function stockBalances(input: unknown) {
  return invokePhQuery(stockQueries.balances, input);
}

export async function stockMovements(input: unknown) {
  return invokePhQuery(stockQueries.movements, input);
}

export async function adjustStock(input: unknown) {
  return invokePh(stock.adjust, input);
}

export async function damageStock(input: unknown) {
  return invokePh(stock.damage, input);
}

export async function releaseQuarantine(input: unknown) {
  return invokePh(stock.quarantineRelease, input);
}

export async function reverseMovement(input: unknown) {
  return invokePh(stock.reverse, input);
}
