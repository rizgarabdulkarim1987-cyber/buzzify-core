'use server';

import * as staff from '@/server/pharmacy/actions/staff';
import { invokePh } from '@/server/pharmacy/invoke';

// The staff screen's Server Action. `invokePh` puts in the place the person chose; the action lets the owner only.

/** One person's AI Doctor switch, on or off. */
export async function setStaffDoctor(input: unknown) {
  return invokePh(staff.setDoctor, input);
}
