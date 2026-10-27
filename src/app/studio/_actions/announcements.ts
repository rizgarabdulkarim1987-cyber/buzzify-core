'use server';

import * as announcements from '@/server/studio/actions/announcements';
import { invoke, invokeQuery } from '@/server/studio/framework/invoke';
import * as announcementQueries from '@/server/studio/queries/announcements';

export async function createAnnouncement(input: unknown) {
  return invoke(announcements.createAnnouncement, input);
}

export async function updateAnnouncement(input: unknown) {
  return invoke(announcements.updateAnnouncement, input);
}

export async function archiveAnnouncement(input: unknown) {
  return invoke(announcements.archiveAnnouncement, input);
}

/** What the till and Studio bars refresh from, every minute while online. */
export async function loadActiveAnnouncements(input: unknown) {
  return invokeQuery(announcementQueries.activeAnnouncements, input);
}
