'use client';

import { useEffect, type RefObject } from 'react';

/**
 * The curtain-open entrance of the Curtain and Spotlight shape: each stage's two curtains start drawn and part once,
 * the first time the stage comes into view. The hook sets `data-armed` on `root` (the CSS draws the curtains only then,
 * so a page with no script shows every stage open) and `data-open` on each `[data-stage]` the first time it is seen,
 * and never takes it away. `seen` remembers the stages that have opened (by their `data-stage` id), so a stage that is
 * mounted again (a search that hid it and brought it back, a new `categories` identity) comes back already open and
 * the curtains never replay. The effect depends on `reduced` alone; with less motion it does nothing and every stage
 * is simply open.
 */
export function useStageOpen(root: RefObject<HTMLElement | null>, seen: RefObject<Set<string>>, reduced: boolean) {
  useEffect(() => {
    const host = root.current;
    const opened = seen.current;
    if (!host || !opened || reduced) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const open = (stage: HTMLElement) => {
      stage.setAttribute('data-open', '');
      const id = stage.getAttribute('data-stage');
      if (id) opened.add(id);
    };
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          open(entry.target as HTMLElement);
          watcher.unobserve(entry.target);
        }
      },
      { threshold: 0.1 },
    );
    const watch = () =>
      host.querySelectorAll<HTMLElement>('[data-stage]:not([data-open])').forEach((stage) => {
        if (opened.has(stage.getAttribute('data-stage') ?? '')) open(stage);
        else watcher.observe(stage);
      });
    host.setAttribute('data-armed', '');
    watch();
    const changes = new MutationObserver(watch);
    changes.observe(host, { childList: true, subtree: true });
    return () => {
      watcher.disconnect();
      changes.disconnect();
      host.removeAttribute('data-armed');
    };
  }, [root, seen, reduced]);
}
