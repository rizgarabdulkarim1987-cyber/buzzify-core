'use server';

import * as sales from '@/server/pharmacy/actions/sales';
import { invokePh, invokePhQuery } from '@/server/pharmacy/invoke';
import * as saleQueries from '@/server/pharmacy/queries/sales';
import * as sellQueries from '@/server/pharmacy/queries/sell';

// The sale screen's Server Actions. `invokePh` puts in the place the person chose; the browser never names the pharmacy.

export async function sellSearch(input: unknown) {
  return invokePhQuery(sellQueries.search, input);
}

export async function createSale(input: unknown) {
  return invokePh(sales.create, input);
}

export async function holdSale(input: unknown) {
  return invokePh(sales.hold, input);
}

export async function resumeHold(input: unknown) {
  return invokePh(sales.resume, input);
}

export async function discardHold(input: unknown) {
  return invokePh(sales.discardHold, input);
}

export async function listHolds(input: unknown) {
  return invokePhQuery(saleQueries.holds, input);
}

export async function listSales(input: unknown) {
  return invokePhQuery(saleQueries.list, input);
}

export async function getSale(input: unknown) {
  return invokePhQuery(saleQueries.get, input);
}
