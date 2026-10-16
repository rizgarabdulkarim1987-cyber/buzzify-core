'use server';

import * as account from '@/server/studio/actions/account';
import { invoke, invokeQuery } from '@/server/studio/framework/invoke';
import * as accountQueries from '@/server/studio/queries/account';

export async function startTwoFactorSetup(input: unknown) {
  return invoke(account.startTwoFactorSetup, input);
}

export async function confirmTwoFactor(input: unknown) {
  return invoke(account.confirmTwoFactor, input);
}

export async function regenerateRecoveryCodes(input: unknown) {
  return invoke(account.regenerateRecoveryCodes, input);
}

export async function disableTwoFactor(input: unknown) {
  return invoke(account.disableTwoFactor, input);
}

export async function changePassword(input: unknown) {
  return invoke(account.changePassword, input);
}

export async function requestEmailChange(input: unknown) {
  return invoke(account.requestEmailChange, input);
}

export async function setStudioLanguage(input: unknown) {
  return invoke(account.setStudioLanguage, input);
}

export async function listMySessions(input: unknown) {
  return invokeQuery(accountQueries.listMySessions, input);
}

export async function endSession(input: unknown) {
  return invoke(account.endSession, input);
}

export async function endOtherSessions(input: unknown) {
  return invoke(account.endOtherSessions, input);
}
