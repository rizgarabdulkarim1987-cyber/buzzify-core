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

export async function saveOffer(input: unknown) {
  return invoke(sales.saveOffer, input);
}

export async function deleteOffer(input: unknown) {
  return invoke(sales.deleteOffer, input);
}

export async function reorderOffers(input: unknown) {
  return invoke(sales.reorderOffers, input);
}

export async function saveOccasion(input: unknown) {
  return invoke(sales.saveOccasion, input);
}

export async function deleteOccasion(input: unknown) {
  return invoke(sales.deleteOccasion, input);
}

export async function saveShowcaseCard(input: unknown) {
  return invoke(sales.saveShowcaseCard, input);
}

export async function deleteShowcaseCard(input: unknown) {
  return invoke(sales.deleteShowcaseCard, input);
}

export async function reorderShowcaseCards(input: unknown) {
  return invoke(sales.reorderShowcaseCards, input);
}

export async function saveSalesSettings(input: unknown) {
  return invoke(sales.saveSettings, input);
}
