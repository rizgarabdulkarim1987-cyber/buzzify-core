'use server';

import * as revisions from '@/server/studio/actions/revisions';
import { invoke } from '@/server/studio/framework/invoke';

export async function rollbackRevision(input: unknown) {
  return invoke(revisions.rollback, input);
}

export async function restoreRevision(input: unknown) {
  return invoke(revisions.restore, input);
}

export async function schedulePublish(input: unknown) {
  return invoke(revisions.schedule, input);
}

export async function cancelScheduledPublish(input: unknown) {
  return invoke(revisions.cancelSchedule, input);
}
