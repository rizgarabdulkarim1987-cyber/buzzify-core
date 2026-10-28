'use server';

import * as platform from '@/server/studio/actions/platform-intro';
import { invoke } from '@/server/studio/framework/invoke';

export async function savePlatformIntroDefault(input: unknown) {
  return invoke(platform.savePlatformIntroDefault, input);
}

export async function savePlatformAdvert(input: unknown) {
  return invoke(platform.savePlatformAdvert, input);
}

export async function reorderPlatformAdverts(input: unknown) {
  return invoke(platform.reorderPlatformAdverts, input);
}

export async function deletePlatformAdvert(input: unknown) {
  return invoke(platform.deletePlatformAdvert, input);
}
