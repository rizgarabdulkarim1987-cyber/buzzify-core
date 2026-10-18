'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether the gallery plays its previews: the viewer's own choice, remembered in this browser. Until they choose, it
 * follows the device: previews play, unless the device asks for reduced motion.
 */
const KEY = 'buzzify-studio:motion-previews';
const QUERY = '(prefers-reduced-motion: reduce)';
const listeners = new Set<() => void>();
/** The choice made on this page, which holds even where storage is blocked. */
let chosen: boolean | null = null;

function read(): boolean {
  if (chosen !== null) return chosen;
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored === 'on') return true;
    if (stored === 'off') return false;
  } catch {
    // Storage can be blocked; the device's preference decides.
  }
  return !window.matchMedia(QUERY).matches;
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', notify);
  return () => {
    listeners.delete(notify);
    media.removeEventListener('change', notify);
  };
}

export function usePlayPreference(): [playing: boolean, set: (value: boolean) => void] {
  const playing = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((value: boolean) => {
    chosen = value;
    try {
      window.localStorage.setItem(KEY, value ? 'on' : 'off');
    } catch {
      // Not remembered; it still applies to this page.
    }
    listeners.forEach((notify) => notify());
  }, []);
  return [playing, set];
}

/** Whether the device asks for reduced motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
