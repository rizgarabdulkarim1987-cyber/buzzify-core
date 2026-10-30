'use server';

import * as captain from '@/server/studio/actions/pos-captain';
import { invoke } from '@/server/studio/framework/invoke';

/** Server Action for the Super Admin's captain approval switch. */
export async function setPosCaptainApproval(input: unknown) {
  return invoke(captain.setPosCaptainApproval, input);
}

/** The captain's order for a table, taken by mouth. */
export async function placeCaptainOrder(input: unknown) {
  return invoke(captain.placeCaptainOrder, input);
}

/** A guest's call for the bill, marked seen by the captain or the cashier. */
export async function markBillCallSeen(input: unknown) {
  return invoke(captain.markBillCallSeen, input);
}
