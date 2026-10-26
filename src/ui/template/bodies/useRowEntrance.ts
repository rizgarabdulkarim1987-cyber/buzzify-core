'use client';

import { useEffect, type RefObject } from 'react';

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
 * script shows everything) and `data-in` on each `[data-row]` the first time it is seen, and never takes it away: a
 * row that scrolls out and in, or survives a search with its place in the list, does not play again. Rows that appear
 * later (a search showing dishes that were filtered out) are added to the watch with a MutationObserver. The effect
 * depends on `reduced` alone, so a new `categories` identity never restarts it; with less motion it does nothing and
 * every row is simply shown.
 */
export function useRowEntrance(root: RefObject<HTMLElement | null>, reduced: boolean) {
  useEffect(() => {
    const host = root.current;
    if (!host || reduced) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).setAttribute('data-in', '');
          watcher.unobserve(entry.target);
        }
      },
      { threshold: 0.2 },
    );
    const watch = () => host.querySelectorAll<HTMLElement>('[data-row]:not([data-in])').forEach((row) => watcher.observe(row));
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
