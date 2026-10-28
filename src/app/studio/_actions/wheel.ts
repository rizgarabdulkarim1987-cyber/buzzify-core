'use server';

import * as wheel from '@/server/studio/actions/wheel';
import { invoke } from '@/server/studio/framework/invoke';

export async function setMenuWheelEnabled(input: unknown) {
  return invoke(wheel.setMenuWheelEnabled, input);
}

export async function saveWheel(input: unknown) {
  return invoke(wheel.saveWheel, input);
}
