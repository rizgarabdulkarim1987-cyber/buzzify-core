'use server';

import * as design from '@/server/studio/actions/design';
import { invoke } from '@/server/studio/framework/invoke';

export async function applyDesign(input: unknown) {
  return invoke(design.apply, input);
}

export async function updateDesign(input: unknown) {
  return invoke(design.update, input);
}

export async function resetDesign(input: unknown) {
  return invoke(design.reset, input);
}

export async function saveDesign(input: unknown) {
  return invoke(design.save, input);
}

export async function deleteDesign(input: unknown) {
  return invoke(design.remove, input);
}

export async function setPoweredBy(input: unknown) {
  return invoke(design.poweredBy, input);
}
