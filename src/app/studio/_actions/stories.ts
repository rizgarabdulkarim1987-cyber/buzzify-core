'use server';

import { invoke } from '@/server/studio/framework/invoke';
import * as stories from '@/server/studio/actions/stories';

export async function saveStory(input: unknown) {
  return invoke(stories.saveStory, input);
}

export async function deleteStory(input: unknown) {
  return invoke(stories.deleteStory, input);
}
