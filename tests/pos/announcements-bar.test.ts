import { describe, expect, it } from 'vitest';
import type { ActiveAnnouncement } from '@/lib/announcements';
import { dismissAnnouncement, readDismissed, restoreAnnouncements, storeAnnouncements, visibleAnnouncements } from '@/lib/announcement-state';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}
const note = (id: string, endsAt: string | null = null): ActiveAnnouncement => ({ id, title: `T${id}`, body: `B${id}`, endsAt });
const NOW = Date.parse('2026-10-27T12:00:00Z');

describe('visibleAnnouncements', () => {
  it('drops dismissed ones and ones past their end, keeps open-ended', () => {
    const list = [note('a'), note('b', '2026-10-27T11:00:00Z'), note('c', '2026-10-27T13:00:00Z'), note('d')];
    expect(visibleAnnouncements(list, ['d'], NOW).map((n) => n.id)).toEqual(['a', 'c']);
  });
});

describe('announcement cache', () => {
  it('restores a list only for the same person', () => {
    const store = memory();
    storeAnnouncements('u1', [note('a')], store);
    expect(restoreAnnouncements('u1', store)).toEqual([note('a')]);
    expect(restoreAnnouncements('u2', store)).toEqual([]);
  });
  it('ignores damaged storage', () => {
    const store = memory();
    store.setItem('buzzify.announcements', '{not json');
    expect(restoreAnnouncements('u1', store)).toEqual([]);
    store.setItem('buzzify.announcements', JSON.stringify({ userId: 'u1', list: [{ id: 1 }, note('ok')] }));
    expect(restoreAnnouncements('u1', store)).toEqual([note('ok')]);
  });
  it('keeps dismissals per person', () => {
    const store = memory();
    dismissAnnouncement('u1', 'a', store);
    dismissAnnouncement('u1', 'a', store);
    expect(readDismissed('u1', store)).toEqual(['a']);
    expect(readDismissed('u2', store)).toEqual([]);
  });
});

describe('the offline page', () => {
  it('shows what the last person here was shown, and nothing when nothing is stored', async () => {
    const { lastStoredAnnouncements } = await import('@/lib/announcement-state');
    const store = memory();
    expect(lastStoredAnnouncements(store)).toBeNull();
    storeAnnouncements('u9', [note('z')], store);
    expect(lastStoredAnnouncements(store)).toEqual({ userId: 'u9', list: [note('z')] });
  });
});
