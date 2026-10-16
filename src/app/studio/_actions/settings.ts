'use server';

import * as settings from '@/server/studio/actions/settings';
import { invoke } from '@/server/studio/framework/invoke';

export async function updatePlatformSettings(input: unknown) {
  return invoke(settings.updatePlatformSettings, input);
}
