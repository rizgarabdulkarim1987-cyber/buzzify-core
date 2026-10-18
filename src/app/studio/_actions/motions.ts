'use server';

import * as motions from '@/server/studio/actions/motions';
import { invoke } from '@/server/studio/framework/invoke';

export async function saveMotion(input: unknown) {
  return invoke(motions.save, input);
}

export async function removeMotion(input: unknown) {
  return invoke(motions.remove, input);
}
