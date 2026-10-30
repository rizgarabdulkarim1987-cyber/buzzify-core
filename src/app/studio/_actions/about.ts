'use server';

import * as about from '@/server/studio/actions/about';
import { invoke } from '@/server/studio/framework/invoke';

export async function setMenuAboutEnabled(input: unknown) {
  return invoke(about.setMenuAboutEnabled, input);
}

export async function saveAbout(input: unknown) {
  return invoke(about.saveAbout, input);
}

export async function saveAboutOffer(input: unknown) {
  return invoke(about.saveAboutOffer, input);
}

export async function reorderAboutOffers(input: unknown) {
  return invoke(about.reorderAboutOffers, input);
}

export async function deleteAboutOffer(input: unknown) {
  return invoke(about.deleteAboutOffer, input);
}
