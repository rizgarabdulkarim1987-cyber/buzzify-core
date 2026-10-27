'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Keeps the Living Steam shape's effects (steam wisps, sweat drips) running only on the dishes that are on screen or
 * just about to be: a row that carries `data-fx` gets `data-live` while it is within a screen's height of the viewport,
 * and loses it when it leaves (the CSS runs the animations only under `[data-live]`). Rows added later (a search
 * cleared, a filter changed) are picked up by a MutationObserver. The hook sets `data-armed` on `root` in the same pass
 * as the first read, so a page with no script, or before the hook ran, shows the effects still instead of paused.
 * Depends on `reduced` alone, so a new `categories` identity never restarts it; with less motion it does nothing and
 * the CSS draws the effects without moving.
 */
export function useSteamLive(root: RefObject<HTMLElement | null>, reduced: boolean) {
  useEffect(() => {
    const host = root.current;
    if (!host || reduced || typeof IntersectionObserver === 'undefined') return;
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) (entry.target as HTMLElement).toggleAttribute('data-live', entry.isIntersecting);
        host.setAttribute('data-armed', '');
      },
      { rootMargin: '50% 0px' },
    );
    const watching = new WeakSet<Element>();
    const watch = () =>
      host.querySelectorAll<HTMLElement>('[data-fx]').forEach((row) => {
        if (watching.has(row)) return;
        watching.add(row);
        watcher.observe(row);
      });
    // Rows a search removed are no longer watched (the observer would keep the detached nodes until cleanup).
    const forget = (records: MutationRecord[]) => {
      for (const record of records)
        record.removedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          const gone = node.matches('[data-fx]') ? [node, ...node.querySelectorAll('[data-fx]')] : [...node.querySelectorAll('[data-fx]')];
          for (const row of gone) {
            if (row.isConnected) continue;
            watcher.unobserve(row);
            watching.delete(row);
          }
        });
    };
    watch();
    const mutations = new MutationObserver((records) => {
      forget(records);
      watch();
    });
    mutations.observe(host, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
      watcher.disconnect();
      host.removeAttribute('data-armed');
      host.querySelectorAll('[data-live]').forEach((row) => row.removeAttribute('data-live'));
    };
  }, [root, reduced]);
}
