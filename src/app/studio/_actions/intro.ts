'use server';

import * as intro from '@/server/studio/actions/intro';
import { invoke } from '@/server/studio/framework/invoke';

export async function setMenuIntroEnabled(input: unknown) {
  return invoke(intro.setMenuIntroEnabled, input);
}

export async function saveMenuIntro(input: unknown) {
  return invoke(intro.saveMenuIntro, input);
}
