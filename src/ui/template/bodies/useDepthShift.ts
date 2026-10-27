'use client';

import { useEffect, type RefObject } from 'react';

/**
 * How far a frame has crossed the screen, from -1 (its top edge at the bottom of the screen, just entering) through 0
 * (centred) to +1 (its bottom edge at the top of the screen, just leaving): the same span as a CSS `view()` timeline.
 */
export function depthProgress(top: number, height: number, viewport: number): number {
  const crossed = (viewport - top) / (viewport + height);
  return Math.min(1, Math.max(0, crossed)) * 2 - 1;
}

/**
 * The scroll fallback of the Scroll Depth shape, for a browser with no CSS scroll-driven animations (those shift the
 * picture in `depth.css` with no script at all). It watches the frames (`[data-photo]` inside `root`) with an
 * IntersectionObserver and, on scroll, sets `--dp` (-1 to 1) on the ones in view only, once per animation frame; the CSS
 * turns that into the picture's shift. No React state, and nothing when the guest prefers less motion. The effect
 * depends on `reduced` alone, so a change of the categories (a search) never restarts it; a MutationObserver adds the
 * frames that appear later to the watch.
 */
export function useDepthShift(root: RefObject<HTMLElement | null>, reduced: boolean) {
  useEffect(() => {
    const host = root.current;
    if (!host || reduced) return;
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('animation-timeline: view()')) return;
    const inView = new Set<HTMLElement>();
    let queued = 0;
    const paint = () => {
      queued = 0;
      // Every frame's place is read first, then every shift written: no layout is forced between the writes.
      const height = window.innerHeight;
      const shifts: [HTMLElement, string][] = [];
      for (const frame of inView) {
        if (!frame.isConnected) {
          inView.delete(frame);
          continue;
        }
        const box = frame.getBoundingClientRect();
        shifts.push([frame, depthProgress(box.top, box.height, height).toFixed(3)]);
      }
      for (const [frame, shift] of shifts) frame.style.setProperty('--dp', shift);
    };
    const queue = () => {
      if (!queued) queued = requestAnimationFrame(paint);
    };
    const watcher = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) inView.add(entry.target as HTMLElement);
        else inView.delete(entry.target as HTMLElement);
      }
      queue();
    });
    const watch = () => host.querySelectorAll<HTMLElement>('[data-photo], [data-band]').forEach((frame) => watcher.observe(frame));
    watch();
    const changes = new MutationObserver(watch);
    changes.observe(host, { childList: true, subtree: true });
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    return () => {
      if (queued) cancelAnimationFrame(queued);
      watcher.disconnect();
      changes.disconnect();
      window.removeEventListener('scroll', queue);
      window.removeEventListener('resize', queue);
    };
  }, [root, reduced]);
}
