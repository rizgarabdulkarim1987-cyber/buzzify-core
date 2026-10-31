'use server';

import { invokePh, invokePhQuery } from '@/server/pharmacy/invoke';
import * as orders from '@/server/pharmacy/actions/purchase-orders';
import * as orderQueries from '@/server/pharmacy/queries/purchase-orders';
import * as supplierQueries from '@/server/pharmacy/queries/suppliers';

// The purchase order screens' Server Actions. `invokePh` puts in the place the person chose; the browser never names the pharmacy.

export async function createOrder(input: unknown) {
  return invokePh(orders.create, input);
}

export async function updateOrder(input: unknown) {
  return invokePh(orders.update, input);
}

export async function placeOrder(input: unknown) {
  return invokePh(orders.order, input);
}

export async function cancelOrder(input: unknown) {
  return invokePh(orders.cancel, input);
}

export async function closeOrder(input: unknown) {
  return invokePh(orders.close, input);
}

/** Products below their minimum at the chosen branch (with a supplier: those it has delivered before). */
export async function suggestOrder(input: unknown) {
  return invokePhQuery(orderQueries.suggest, input);
}

/** Live suppliers for the order form's picker. */
export async function findSuppliers(input: unknown) {
  return invokePhQuery(supplierQueries.list, input);
}
