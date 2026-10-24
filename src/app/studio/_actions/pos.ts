'use server';

import * as pos from '@/server/studio/actions/pos';
import { invoke } from '@/server/studio/framework/invoke';

export async function updatePosSettings(input: unknown) {
  return invoke(pos.updatePosSettings, input);
}

export async function createPosStaff(input: unknown) {
  return invoke(pos.createPosStaff, input);
}

export async function changePosStaffRole(input: unknown) {
  return invoke(pos.changePosStaffRole, input);
}

export async function setPosStaffActive(input: unknown) {
  return invoke(pos.setPosStaffActive, input);
}
