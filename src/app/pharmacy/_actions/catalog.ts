'use server';

import * as imports from '@/server/pharmacy/actions/imports';
import * as prices from '@/server/pharmacy/actions/prices';
import * as products from '@/server/pharmacy/actions/products';
import { invokePh, invokePhQuery } from '@/server/pharmacy/invoke';
import * as priceQueries from '@/server/pharmacy/queries/prices';
import * as productQueries from '@/server/pharmacy/queries/products';

// The catalog screens' Server Actions. `invokePh` puts in the place the person chose; the browser never names the pharmacy.

export async function searchProducts(input: unknown) {
  return invokePhQuery(productQueries.search, input);
}

export async function listProducts(input: unknown) {
  return invokePhQuery(productQueries.list, input);
}

export async function createProduct(input: unknown) {
  return invokePh(products.create, input);
}

export async function updateProduct(input: unknown) {
  return invokePh(products.update, input);
}

export async function archiveProduct(input: unknown) {
  return invokePh(products.archive, input);
}

export async function setPrice(input: unknown) {
  return invokePh(prices.set, input);
}

export async function priceHistory(input: unknown) {
  return invokePhQuery(priceQueries.history, input);
}

export async function applyImport(input: unknown) {
  return invokePh(imports.apply, input);
}
