import type { ActiveAnnouncement } from '@/lib/announcements';

const LIST_KEY = 'buzzify.announcements';
const DISMISSED_KEY = 'buzzify.announcements.dismissed';

/** Only this much is kept on the device, so a long history never grows the store. */
const MAX_DISMISSED = 100;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const dismissedKey = (userId: string) => `${DISMISSED_KEY}.${userId}`;

function readJson(store: Store, key: string): unknown {
  try {
    const raw = store.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** The announcements still worth showing at `now`: one past its end is dropped, as are the ones this person dismissed. */
export function visibleAnnouncements(list: ActiveAnnouncement[], dismissed: string[], now: number): ActiveAnnouncement[] {
  const gone = new Set(dismissed);
  return list.filter((item) => !gone.has(item.id) && (item.endsAt === null || new Date(item.endsAt).getTime() > now));
}

export function storeAnnouncements(userId: string, list: ActiveAnnouncement[], store: Store): void {
  try {
    store.setItem(LIST_KEY, JSON.stringify({ userId, list }));
  } catch {
    // Storage is full or not reachable: the bar still works while online.
  }
}

/** The last list this person saw on this device; empty for anyone else's, or when nothing usable is stored. */
export function restoreAnnouncements(userId: string, store: Store): ActiveAnnouncement[] {
  const value = readJson(store, LIST_KEY) as { userId?: unknown; list?: unknown } | null;
  if (!value || value.userId !== userId || !Array.isArray(value.list)) return [];
  return value.list.filter(
    (item): item is ActiveAnnouncement =>
      !!item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.body === 'string' && (item.endsAt === null || typeof item.endsAt === 'string'),
  );
}

export function readDismissed(userId: string, store: Store): string[] {
  const value = readJson(store, dismissedKey(userId));
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

export function dismissAnnouncement(userId: string, id: string, store: Store): string[] {
  const next = [...readDismissed(userId, store).filter((other) => other !== id), id].slice(-MAX_DISMISSED);
  try {
    store.setItem(dismissedKey(userId), JSON.stringify(next));
  } catch {
    // Not stored: it comes back on the next visit, which is the safe way to fail.
  }
  return next;
}
