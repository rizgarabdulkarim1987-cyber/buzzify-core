'use client';

import { useEffect, type RefObject } from 'react';

/** How far a stage's top must come above the screen's foot before it opens (the observer's and the fallback's line). */
const OPEN_LINE = 0.85;

/**
 * The curtain-open entrance of the Curtain and Spotlight shape: each stage's two curtains start drawn and part once,
 * the first time the stage comes into view. The hook sets `data-armed` on `root` (the CSS draws the curtains only then,
 * so a page with no script shows every stage open) and `data-open` on each `[data-stage]` the first time it is seen,
 * and never takes it away.
 *
 * - The stages already on the screen when the hook arms are opened in the same pass, before `data-armed` is set, so
 *   the first screen is never seen with its curtains shut (the curtains play only for stages scrolled into).
 * - The observer has no threshold (a stage of any height opens once its top passes the line), and a rect check on
 *   scroll and resize, plus one pass after arming, opens stages too: a page whose observer never reports (a
 *   background tab, an unpainted preview) still opens them.
 * - Keyboard focus inside a stage opens it for good.
 *
 * `seen` remembers the stages that have opened (by their `data-stage` id), so a stage that is mounted again (a search
 * that hid it and brought it back, a new `categories` identity) comes back already open and the curtains never replay.
 * The effect depends on `reduced` alone; with less motion it does nothing and every stage is simply open.
 */
export function useStageOpen(root: RefObject<HTMLElement | null>, seen: RefObject<Set<string>>, reduced: boolean) {
  useEffect(() => {
    const host = root.current;
    const opened = seen.current;
    if (!host || !opened || reduced) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const waiting = () => host.querySelectorAll<HTMLElement>('[data-stage]:not([data-open])');
    const inView = (stage: HTMLElement, line: number) => {
      const box = stage.getBoundingClientRect();
      return box.height > 0 && box.bottom > 0 && box.top < window.innerHeight * line;
    };
    const open = (stage: HTMLElement) => {
      stage.setAttribute('data-open', '');
      watcher.unobserve(stage);
      const id = stage.getAttribute('data-stage');
      if (id) opened.add(id);
    };
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) open(entry.target as HTMLElement);
      },
      { threshold: 0, rootMargin: `0px 0px -${Math.round((1 - OPEN_LINE) * 100)}% 0px` },
    );
    const watch = () =>
      waiting().forEach((stage) => {
        if (opened.has(stage.getAttribute('data-stage') ?? '')) open(stage);
        else watcher.observe(stage);
      });
    // The fallback: a rect check of the stages still waiting, at most once a frame.
    let frame = 0;
    const sweep = () => {
      frame = 0;
      waiting().forEach((stage) => {
        if (inView(stage, OPEN_LINE)) open(stage);
      });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(sweep);
    };
    const onFocus = (event: FocusEvent) => {
      const stage = (event.target as Element | null)?.closest<HTMLElement>('[data-stage]');
      if (stage && host.contains(stage) && !stage.hasAttribute('data-open')) open(stage);
    };
    // The first screen: open in the same pass as arming, so no frame paints these stages shut.
    waiting().forEach((stage) => {
      if (inView(stage, 1)) open(stage);
    });
    host.setAttribute('data-armed', '');
    watch();
    const changes = new MutationObserver(watch);
    changes.observe(host, { childList: true, subtree: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    host.addEventListener('focusin', onFocus);
    const late = window.setTimeout(sweep, 1200);
    return () => {
      watcher.disconnect();
      changes.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      host.removeEventListener('focusin', onFocus);
      window.clearTimeout(late);
      if (frame) cancelAnimationFrame(frame);
      host.removeAttribute('data-armed');
    };
  }, [root, seen, reduced]);
}
