'use server';

import * as brand from '@/server/studio/actions/brand';
import { invoke, invokeQuery } from '@/server/studio/framework/invoke';
import * as brandQueries from '@/server/studio/queries/brand';

export async function updateBrand(input: unknown) {
  return invoke(brand.update, input);
}

export async function suggestPalettes(input: unknown) {
  return invokeQuery(brandQueries.suggestFromLogo, input);
}
