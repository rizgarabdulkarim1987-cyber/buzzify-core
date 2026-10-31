import { describe, expect, it } from 'vitest';
import { liveStories, MAX_LIVE_STORIES, storyExpiry, STORY_HOURS, type StoryRow } from '@/server/domain/stories';

const now = new Date('2027-03-10T12:00:00Z');
const row = (id: string, overrides: Partial<StoryRow> = {}): StoryRow => ({
  id,
  assetId: `a-${id}`,
  productId: null,
  captions: {},
  expiresAt: new Date('2027-03-11T12:00:00Z'),
  isActive: true,
  createdAt: new Date('2027-03-10T08:00:00Z'),
  ...overrides,
});

describe('storyExpiry', () => {
  it('ends the given number of hours after now', () => {
    expect(storyExpiry(now, 24).toISOString()).toBe('2027-03-11T12:00:00.000Z');
    expect(storyExpiry(now, 6).toISOString()).toBe('2027-03-10T18:00:00.000Z');
  });

  it('offers a day by default and never more than a week', () => {
    expect(STORY_HOURS).toContain(24);
    expect(Math.max(...STORY_HOURS)).toBeLessThanOrEqual(168);
  });
});

describe('liveStories', () => {
  it('keeps the stories that are on and have not ended, newest first', () => {
    const rows = [row('old', { createdAt: new Date('2027-03-09T20:00:00Z') }), row('new'), row('ended', { expiresAt: new Date('2027-03-10T11:59:59Z') }), row('off', { isActive: false })];
    expect(liveStories(rows, now).map((story) => story.id)).toEqual(['new', 'old']);
  });

  it('treats the end moment itself as ended', () => {
    expect(liveStories([row('edge', { expiresAt: now })], now)).toEqual([]);
  });

  it('shows no more than the cap, keeping the newest', () => {
    const many = Array.from({ length: MAX_LIVE_STORIES + 3 }, (_, i) => row(`s${i}`, { createdAt: new Date(2027, 2, 10, 0, i) }));
    const shown = liveStories(many, now);
    expect(shown).toHaveLength(MAX_LIVE_STORIES);
    expect(shown[0]?.id).toBe(`s${MAX_LIVE_STORIES + 2}`);
  });

  it('orders equal times by id so the answer is stable', () => {
    const same = new Date('2027-03-10T08:00:00Z');
    expect(liveStories([row('b', { createdAt: same }), row('a', { createdAt: same })], now).map((story) => story.id)).toEqual(['a', 'b']);
  });
});
