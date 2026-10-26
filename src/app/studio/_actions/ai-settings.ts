'use server';

import * as ai from '@/server/studio/actions/ai-settings';
import { invoke } from '@/server/studio/framework/invoke';

export async function saveAiSettings(input: unknown) {
  return invoke(ai.saveAiSettings, input);
}

export async function testAiProvider(input: unknown) {
  return invoke(ai.testAiProvider, input);
}
