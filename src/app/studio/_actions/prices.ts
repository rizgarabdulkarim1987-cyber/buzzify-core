'use server';

import * as prices from '@/server/studio/actions/prices';
import { invoke, invokeQuery } from '@/server/studio/framework/invoke';
import * as priceQueries from '@/server/studio/queries/prices';

export async function setPrice(input: unknown) {
  return invoke(prices.set, input);
}

export async function previewBulkPrices(input: unknown) {
  return invokeQuery(priceQueries.previewBulk, input);
}

export async function applyBulkPrices(input: unknown) {
  return invoke(prices.applyBulk, input);
}
