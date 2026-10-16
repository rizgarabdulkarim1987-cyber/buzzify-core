'use server';

import { invokePublic } from '@/server/studio/framework/invoke';
import * as session from '@/server/studio/public-actions/session';

export async function signIn(input: unknown) {
  return invokePublic(session.signIn, input);
}

export async function verifyTwoFactor(input: unknown) {
  return invokePublic(session.verifyTwoFactor, input);
}

export async function requestPasswordReset(input: unknown) {
  return invokePublic(session.requestPasswordReset, input);
}

export async function resetPassword(input: unknown) {
  return invokePublic(session.resetPassword, input);
}

export async function signOut(input: unknown) {
  return invokePublic(session.signOut, input);
}
