'use client';

import { useEffect, useRef, type RefObject } from 'react';

export interface OnceInViewOptions {
  /** The attribute every watched item carries (`data-stage`, `data-band`, `data-row`). */
  item: string;
  /** The attribute that holds an item's id (the same as `item` when that one has a value). */
  id: string;
  /** The attribute set on an item the first time it is seen (`data-open`, `data-in`); never taken away by the hook. */
  mark: string;
  /** How far an item's top must come above the screen's foot (0 to 1 of its height) before it counts as seen. */
  line?: number;
}

/** What a body can ask of the hook once it runs (null before, and with less motion). */
export interface OnceInView {
  /** Takes the mark off `item` and forgets it was seen, so it plays its entrance again the next time it is seen. */
  rearm(item: HTMLElement): void;
}

/**
 * The shared "plays once, the first time it is seen" entrance of the shaped bodies (theatre's curtains, ink's flood,
 * kinetic's rising words). The hook sets `data-armed` on `root` (the CSS hides or draws over a not-yet-seen item only
 * then, so a page with no script shows everything) and `mark` on each `[item]` the first time it is seen.
 *
 * - The items already on the screen when it arms are marked in the same pass, before `data-armed` is set, so the
 *   first screen never flashes hidden.
 * - An item counts as seen once its top passes `line` (the observer has no threshold, so an item of any height is
 *   seen). The observer is not trusted alone: a rect check on scroll and resize (once a frame), and one pass about a
 *   second after arming, mark items too, so a page whose observer never reports (a background tab, an unpainted
 *   preview, a prerendered page) never keeps content hidden.
 * - Keyboard focus inside an item marks it for good.
 * - Items added later (a search cleared, a new `categories`) are watched through a MutationObserver; the ones seen
 *   before (remembered by `id`, not by node) come back marked at once, so an entrance never replays by accident.
 *
 * The effect depends on `reduced` alone; with less motion it does nothing and every item is simply shown.
 */
export function useOnceInView(root: RefObject<HTMLElement | null>, reduced: boolean, { item, id, mark, line = 0.85 }: OnceInViewOptions): RefObject<OnceInView | null> {
  const seenIds = useRef(new Set<string>());
  const control = useRef<OnceInView | null>(null);

  useEffect(() => {
    const host = root.current;
    const seen = seenIds.current;
    if (!host || reduced) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const waiting = () => host.querySelectorAll<HTMLElement>(`[${item}]:not([${mark}])`);
    const inView = (node: HTMLElement, at: number) => {
      const box = node.getBoundingClientRect();
      return box.height > 0 && box.bottom > 0 && box.top < window.innerHeight * at;
    };
    const show = (node: HTMLElement) => {
      node.setAttribute(mark, '');
      watcher.unobserve(node);
      const key = node.getAttribute(id);
      if (key) seen.add(key);
    };
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) show(entry.target as HTMLElement);
      },
      { threshold: 0, rootMargin: `0px 0px -${Math.round((1 - line) * 100)}% 0px` },
    );
    const watch = () =>
      waiting().forEach((node) => {
        if (seen.has(node.getAttribute(id) ?? '')) show(node);
        else watcher.observe(node);
      });
    // The fallback: a rect check of the items still waiting, at most once a frame.
    let frame = 0;
    const sweep = () => {
      frame = 0;
      waiting().forEach((node) => {
        if (inView(node, line)) show(node);
      });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(sweep);
    };
    const onFocus = (event: FocusEvent) => {
      const node = (event.target as Element | null)?.closest<HTMLElement>(`[${item}]`);
      if (node && host.contains(node) && !node.hasAttribute(mark)) show(node);
    };
    // The first screen: all read first, then all marked (no layout read between writes), before arming.
    const onScreen = [...waiting()].filter((node) => inView(node, 1));
    onScreen.forEach(show);
    host.setAttribute('data-armed', '');
    watch();
    const changes = new MutationObserver(watch);
    changes.observe(host, { childList: true, subtree: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    host.addEventListener('focusin', onFocus);
    const late = window.setTimeout(sweep, 1200);
    control.current = {
      rearm(node) {
        const key = node.getAttribute(id);
        if (key) seen.delete(key);
        node.removeAttribute(mark);
        watcher.observe(node);
      },
    };
    return () => {
      control.current = null;
      watcher.disconnect();
      changes.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      host.removeEventListener('focusin', onFocus);
      window.clearTimeout(late);
      if (frame) cancelAnimationFrame(frame);
      host.removeAttribute('data-armed');
    };
  }, [root, reduced, item, id, mark, line]);

  return control;
}
