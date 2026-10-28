'use server';

import * as captain from '@/server/studio/actions/pos-captain';
import { invoke } from '@/server/studio/framework/invoke';

/** Server Action for the Super Admin's captain approval switch. */
export async function setPosCaptainApproval(input: unknown) {
  return invoke(captain.setPosCaptainApproval, input);
}
