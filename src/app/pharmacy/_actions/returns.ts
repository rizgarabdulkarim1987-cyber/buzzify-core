'use server';

import * as returns from '@/server/pharmacy/actions/returns';
import { invokePh, invokePhQuery } from '@/server/pharmacy/invoke';
import * as returnQueries from '@/server/pharmacy/queries/returns';

// The returns screens' Server Actions. `invokePh` puts in the place the person chose; the browser never names the pharmacy.

export async function createReturn(input: unknown) {
  return invokePh(returns.create, input);
}

export async function cancelSale(input: unknown) {
  return invokePh(returns.cancel, input);
}

export async function listReturns(input: unknown) {
  return invokePhQuery(returnQueries.list, input);
}

export async function getReturn(input: unknown) {
  return invokePhQuery(returnQueries.get, input);
}

export async function returnableLines(input: unknown) {
  return invokePhQuery(returnQueries.returnable, input);
}
