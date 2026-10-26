'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * A dish name as words, for the Dancing Letters shape. Only words: Arabic and Kurdish letters join, so a name is never
 * split into letters, and the rows move word by word.
 */
export function dishWords(name: string): string[] {
  return name.split(/\s+/).filter(Boolean);
}

/**
 * The entrance of the Dancing Letters shape: each row's words rise and its price flips once, when the row first comes
 * into view. The hook sets `data-armed` on `root` (the CSS hides the not-yet-shown rows only then, so a page with no
 * script shows everything) and `data-in` on each `[data-row]` the first time it is seen, and never takes it away.
 * Shown dishes are remembered by their `data-id`, not by node: a row that scrolls out and in, survives a search, or is
 * mounted anew when a search is cleared does not play again. Rows already on the screen when the hook starts are shown
 * at once (before arming, in one read pass), so the server-drawn first screen never jumps. Rows that appear later are
 * added to the watch with a MutationObserver. The effect depends on `reduced` alone, so a new `categories` identity
 * never restarts it; with less motion it does nothing and every row is simply shown.
 */
export function useRowEntrance(root: RefObject<HTMLElement | null>, reduced: boolean) {
  const shown = useRef(new Set<string>());
  useEffect(() => {
    const host = root.current;
    if (!host || reduced) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const seen = shown.current;
    const show = (row: HTMLElement) => {
      row.setAttribute('data-in', '');
      if (row.dataset.id) seen.add(row.dataset.id);
    };
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          show(entry.target as HTMLElement);
          watcher.unobserve(entry.target);
        }
      },
      { threshold: 0.2 },
    );
    const watch = () =>
      host.querySelectorAll<HTMLElement>('[data-row]:not([data-in])').forEach((row) => {
        if (row.dataset.id && seen.has(row.dataset.id)) row.setAttribute('data-in', '');
        else watcher.observe(row);
      });
    // The rows on the screen now: all read first, then all shown (no layout read between writes).
    const rows = [...host.querySelectorAll<HTMLElement>('[data-row]:not([data-in])')];
    const onScreen = rows.filter((row) => {
      const box = row.getBoundingClientRect();
      return box.bottom > 0 && box.top < window.innerHeight;
    });
    onScreen.forEach(show);
    host.setAttribute('data-armed', '');
    watch();
    const changes = new MutationObserver(watch);
    changes.observe(host, { childList: true, subtree: true });
    return () => {
      watcher.disconnect();
      changes.disconnect();
      host.removeAttribute('data-armed');
    };
  }, [root, reduced]);
}
