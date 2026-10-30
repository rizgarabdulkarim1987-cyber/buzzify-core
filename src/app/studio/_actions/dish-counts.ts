'use server';

import * as dishCounts from '@/server/studio/actions/dish-counts';
import { invoke } from '@/server/studio/framework/invoke';

export async function setMenuDishCountsEnabled(input: unknown) {
  return invoke(dishCounts.setMenuDishCountsEnabled, input);
}
