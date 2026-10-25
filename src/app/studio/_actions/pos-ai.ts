'use server';

import * as ai from '@/server/studio/actions/pos-ai';
import { invoke } from '@/server/studio/framework/invoke';

/** Server Actions for the AI screens: each forwards to the framework, which checks the person, the package and the till gate. */

export async function askPosAi(input: unknown) {
  return invoke(ai.askPosAi, input);
}

export async function phrasePosAiSummary(input: unknown) {
  return invoke(ai.phrasePosAiSummary, input);
}

export async function labelPosComplaints(input: unknown) {
  return invoke(ai.labelPosComplaints, input);
}

export async function setPosAiPackage(input: unknown) {
  return invoke(ai.setPosAiPackage, input);
}
