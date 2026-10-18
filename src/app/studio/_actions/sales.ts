'use server';

import * as sales from '@/server/studio/actions/sales';
import { invoke } from '@/server/studio/framework/invoke';

export async function saveUpgrade(input: unknown) {
  return invoke(sales.saveUpgrade, input);
}

export async function deleteUpgrade(input: unknown) {
  return invoke(sales.deleteUpgrade, input);
}

export async function savePairing(input: unknown) {
  return invoke(sales.savePairing, input);
}

export async function deletePairing(input: unknown) {
  return invoke(sales.deletePairing, input);
}

export async function saveSet(input: unknown) {
  return invoke(sales.saveSet, input);
}

export async function deleteSet(input: unknown) {
  return invoke(sales.deleteSet, input);
}
