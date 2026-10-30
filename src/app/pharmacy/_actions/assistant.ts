'use server';

import * as assistant from '@/server/pharmacy/actions/assistant';
import { invokePh, invokePhFiltered, invokePhQuery } from '@/server/pharmacy/invoke';
import * as assistantQueries from '@/server/pharmacy/queries/assistant';

// The assistant screens' Server Actions. `invokePh` puts in the place the person chose; the browser never names the pharmacy.

/** A question: the tables, and prose only when it was checked against them. Nothing of the question is kept. The branch is the person's own filter (the action checks it). */
export async function askAssistant(input: unknown) {
  return invokePhFiltered(assistant.askAction, input);
}

export async function listProposals(input: unknown) {
  return invokePhQuery(assistantQueries.proposals, input);
}

export async function createProposal(input: unknown) {
  return invokePhFiltered(assistant.proposalCreate, input);
}

/** Marks the proposal accepted and returns the data that pre-fills the existing draft; creates nothing else. */
export async function acceptProposal(input: unknown) {
  return invokePh(assistant.proposalAccept, input);
}

export async function dismissProposal(input: unknown) {
  return invokePh(assistant.proposalDismiss, input);
}
