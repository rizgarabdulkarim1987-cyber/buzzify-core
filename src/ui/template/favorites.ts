'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * A guest's favourites on one menu, kept in this browser only (nothing is sent anywhere). Storage can be blocked; the
 * favourites then last for the page view.
 */

const listeners = new Set<() => void>();
const memory = new Map<string, string>();

function read(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? '[]';
  } catch {
    return memory.get(key) ?? '[]';
  }
}

function write(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Kept in memory for this page view.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

function parse(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id.length <= 64).slice(0, 200) : [];
  } catch {
    return [];
  }
}

export function useFavorites(slug: string) {
  const key = `buzzify:favorites:${slug}`;
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => '[]',
  );
  const ids = useMemo(() => new Set(parse(raw)), [raw]);
  const has = useCallback((id: string) => ids.has(id), [ids]);
  const toggle = useCallback(
    (id: string) => {
      const next = new Set(parse(read(key)));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      write(key, JSON.stringify([...next]));
    },
    [key],
  );
  return useMemo(() => ({ has, toggle, count: ids.size }), [has, toggle, ids.size]);
}
