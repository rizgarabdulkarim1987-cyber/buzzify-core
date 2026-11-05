'use server';

import * as doctor from '@/server/pharmacy/actions/doctor';
import { invokePhFiltered } from '@/server/pharmacy/invoke';

// The AI Doctor's Server Action. The business comes from the place the person chose; the branch is the one the screen asks for
// (an owner on "All branches" names one), and the action refuses a branch that is not the person's.

/** One question (a complaint, a medicine name or a photo): the result codes and the shop's own stock, never the key or the prompt. */
export async function askDoctor(input: unknown) {
  return invokePhFiltered(doctor.askAction, input);
}
