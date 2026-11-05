/**
 * Restaurant stories (plan feature `guest.stories`): a picture and a caption that show on the menu until they end.
 * Pure rules for which are live; the rows are read per request by `server/data/stories`.
 */

/** A guest sees at most this many stories, the newest first. */
export const MAX_LIVE_STORIES = 12;

/** How long a story may run, in hours: a quarter day to a week. The Studio offers these; a day is the default. */
export const STORY_HOURS = [6, 24, 48, 168] as const;
export const DEFAULT_STORY_HOURS = 24;

export interface StoryRow {
  id: string;
  assetId: string;
  productId: string | null;
  captions: Partial<Record<'en' | 'ar' | 'ckb', string>>;
  expiresAt: Date;
  isActive: boolean;
  createdAt: Date;
}

export function storyExpiry(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

/** The stories to show at `now`: on, not yet ended, newest first (ties by id), at most `MAX_LIVE_STORIES`. */
export function liveStories<T extends Pick<StoryRow, 'id' | 'isActive' | 'expiresAt' | 'createdAt'>>(rows: readonly T[], now: Date): T[] {
  return rows
    .filter((story) => story.isActive && story.expiresAt.getTime() > now.getTime())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_LIVE_STORIES);
}
