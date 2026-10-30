'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { cleanWorkstation } from './print-logic';

/**
 * Which workstation this browser is: the name the person gave this counter or computer, kept on this device only (a convenience, like a
 * remembered tab). It is a label for printing settings, not a person's data. Every read and write is guarded: private windows and blocked
 * storage give "none", never an error.
 */
const KEY = 'ph.print.workstation';
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return cleanWorkstation(window.localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export function useWorkstation(): [string | null, (name: string | null) => void] {
  const name = useSyncExternalStore(subscribe, read, () => null);
  const set = useCallback((next: string | null) => {
    try {
      const clean = cleanWorkstation(next);
      if (clean === null) window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, clean);
    } catch {
      // Storage is blocked: the choice lasts until the page is left, which is all a convenience needs.
    }
    for (const listener of listeners) listener();
  }, []);
  return [name, set];
}
