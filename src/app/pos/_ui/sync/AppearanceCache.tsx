'use client';

import { useEffect } from 'react';
import { toneOf, type Shape } from '@/lib/appearance';
import { restoreAppearance, storeAppearance } from './appearance-cache';

/** Online till pages: remembers this person's look on the device for the offline till. Renders nothing. */
export function AppearanceCache({ userId, vars, shape }: { userId: string; vars: Record<string, string>; shape: Shape | null }) {
  const key = JSON.stringify({ vars, shape });
  useEffect(() => {
    try {
      storeAppearance(userId, vars, shape, window.localStorage);
    } catch {
      // localStorage is not reachable here.
    }
    // `key` stands for `vars` and `shape`, which are new objects on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, key]);
  return null;
}

/** The offline page: puts the look of whoever used the till last on the page. Renders nothing. */
export function OfflineAppearance() {
  useEffect(() => {
    try {
      const cached = restoreAppearance(null, window.localStorage);
      if (!cached) return;
      const root = document.documentElement;
      for (const [name, value] of Object.entries(cached.vars)) root.style.setProperty(name, value);
      if (cached.shape) root.dataset.shape = cached.shape;
      root.dataset.tone = toneOf(cached.vars['--s-bg'] ?? '#ffffff');
    } catch {
      // localStorage is not reachable here.
    }
  }, []);
  return null;
}
