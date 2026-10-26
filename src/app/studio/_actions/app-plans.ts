'use server';

import * as appPlans from '@/server/studio/actions/app-plans';
import { invoke } from '@/server/studio/framework/invoke';

export async function upsertAppPlan(input: unknown) {
  return invoke(appPlans.upsert, input);
}

export async function deactivateAppPlan(input: unknown) {
  return invoke(appPlans.deactivate, input);
}
