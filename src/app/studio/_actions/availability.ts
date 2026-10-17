'use server';

import * as availability from '@/server/studio/actions/availability';
import { invoke } from '@/server/studio/framework/invoke';

export async function setProductAvailability(input: unknown) {
  return invoke(availability.setProduct, input);
}

export async function setOptionAvailability(input: unknown) {
  return invoke(availability.setOption, input);
}
