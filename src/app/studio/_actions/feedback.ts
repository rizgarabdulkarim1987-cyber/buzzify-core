'use server';

import * as feedback from '@/server/studio/actions/feedback';
import { invoke } from '@/server/studio/framework/invoke';

export async function setMenuFeedback(input: unknown) {
  return invoke(feedback.setMenuFeedback, input);
}
