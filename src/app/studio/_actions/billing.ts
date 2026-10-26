'use server';

import * as billing from '@/server/studio/actions/billing';
import { invoke } from '@/server/studio/framework/invoke';

export async function setApplication(input: unknown) {
  return invoke(billing.setApplication, input);
}

export async function setPrices(input: unknown) {
  return invoke(billing.setPrices, input);
}

export async function startTrial(input: unknown) {
  return invoke(billing.startTrial, input);
}

export async function changePlan(input: unknown) {
  return invoke(billing.changePlan, input);
}

export async function cancelSubscription(input: unknown) {
  return invoke(billing.cancel, input);
}

export async function reactivateSubscription(input: unknown) {
  return invoke(billing.reactivate, input);
}

export async function recordPayment(input: unknown) {
  return invoke(billing.recordPayment, input);
}
