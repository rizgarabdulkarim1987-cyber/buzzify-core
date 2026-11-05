'use server';

import * as retail from '@/server/studio/actions/retail';
import { invoke } from '@/server/studio/framework/invoke';

export async function setRetailAiIntake(input: unknown) {
  return invoke(retail.setAiIntake, input);
}

export async function resyncRetail(input: unknown) {
  return invoke(retail.resync, input);
}
