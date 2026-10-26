'use server';

import * as plans from '@/server/studio/actions/plans';
import { invoke } from '@/server/studio/framework/invoke';

export async function setRestaurantPlan(input: unknown) {
  return invoke(plans.setRestaurantPlan, input);
}

export async function updatePlans(input: unknown) {
  return invoke(plans.updatePlans, input);
}
