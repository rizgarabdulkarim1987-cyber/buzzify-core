'use client';

import { useEffect, type RefObject } from 'react';

/**
 * The `lens` family's engine (spec 2026-10-28-menu-styles-77-addendum.md): every dish's size and tilt follow its
 * distance from the middle of the screen. One rAF, run on scroll and resize, writes one CSS variable (`--lv`) on each
 * item on screen; the motif's CSS turns it into a scale, a fold or a pull, each clamped so a dish on screen stays
 * readable and tappable. Items off screen are not read or written.
 */

/**
 * Where an item sits against the screen's middle: its centre's signed distance from the middle, in half-screens, held
 * to [-1, 1] (-1 at the top edge or above it, 0 in the middle, 1 at the foot or below), to three decimals.
 */
export function lensOffset(top: number, height: number, viewport: number): number {
  if (!(viewport > 0)) return 0;
  const middle = viewport / 2;
  const offset = (top + height / 2 - middle) / middle;
  const held = Math.min(1, Math.max(-1, offset));
  return Math.round(held * 1000) / 1000 || 0;
}

/**
 * The scale the lens gives a dish at `offset`: full size in the middle, easing down to `least` at the edges, never below
 * it (the CSS writes the same curve: `1 - (1 - least) * t * t`).
 */
export function lensScale(offset: number, least: number): number {
  const t = Math.min(1, Math.abs(offset));
  return 1 - (1 - least) * t * t;
}

/** The dishes of a section in rows of `size` (the stamp album's strips, three stamps each). */
export function inRows<T>(items: readonly T[], size: number): T[][] {
  const width = Math.max(1, Math.floor(size));
  const rows: T[][] = [];
  for (let at = 0; at < items.length; at += width) rows.push(items.slice(at, at + width));
  return rows;
}

/**
 * Runs the lens on every `selector` inside `root` while `active` (not with less motion: the CSS shows every dish flat
 * then, since it bends only under `[data-lens]` on the root). The items measured must not be the ones transformed (the
 * CSS moves a child), so a scale never feeds back into the next reading. Items added later (a search cleared) are
 * watched through a MutationObserver.
 */
export function useLensDepth(root: RefObject<HTMLElement | null>, active: boolean, selector: string): void {
  useEffect(() => {
    const host = root.current;
    if (!host || !active || typeof IntersectionObserver === 'undefined') return;
    const shown = new Set<HTMLElement>();
    let frame = 0;
    const run = () => {
      frame = 0;
      const viewport = window.innerHeight;
      const items = [...shown];
      // All read first, then all written: no layout read between writes.
      const offsets = items.map((item) => {
        const box = item.getBoundingClientRect();
        return lensOffset(box.top, box.height, viewport);
      });
      items.forEach((item, at) => item.style.setProperty('--lv', String(offsets[at])));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const item = entry.target as HTMLElement;
          if (entry.isIntersecting) shown.add(item);
          else shown.delete(item);
        }
        schedule();
      },
      { threshold: 0, rootMargin: '48px 0px' },
    );
    const watched = new Set<Element>();
    const watch = () =>
      host.querySelectorAll(selector).forEach((node) => {
        if (watched.has(node)) return;
        watched.add(node);
        watcher.observe(node);
      });
    watch();
    const changes = new MutationObserver(() => {
      for (const node of watched)
        if (!node.isConnected) {
          watched.delete(node);
          shown.delete(node as HTMLElement);
          watcher.unobserve(node);
        }
      watch();
    });
    changes.observe(host, { childList: true, subtree: true });
    host.setAttribute('data-lens', '');
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      watcher.disconnect();
      changes.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
      host.removeAttribute('data-lens');
      host.querySelectorAll<HTMLElement>(selector).forEach((node) => node.style.removeProperty('--lv'));
    };
  }, [root, active, selector]);
}

/**
 * Marks every `selector` inside `root` with `data-live` while it is on screen, and `root` with `data-hold` while a finger
 * (or a mouse button) is down on it, so the CSS runs endless motion (streaks, rings, a disc, chasing bulbs, a sunburst)
 * only where it is seen and never under a finger. Nothing runs when `active` is false.
 */
export function useLiveMarks(root: RefObject<HTMLElement | null>, active: boolean, selector: string): void {
  useEffect(() => {
    const host = root.current;
    if (!host || !active) return;
    const down = () => host.setAttribute('data-hold', '');
    const up = () => host.removeAttribute('data-hold');
    host.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
    let watcher: IntersectionObserver | null = null;
    let changes: MutationObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      const live = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) entry.target.toggleAttribute('data-live', entry.isIntersecting);
        },
        { threshold: 0 },
      );
      watcher = live;
      const watched = new Set<Element>();
      const watch = () =>
        host.querySelectorAll(selector).forEach((node) => {
          if (watched.has(node)) return;
          watched.add(node);
          live.observe(node);
        });
      watch();
      changes = new MutationObserver(() => {
        for (const node of watched) if (!node.isConnected) { watched.delete(node); live.unobserve(node); }
        watch();
      });
      changes.observe(host, { childList: true, subtree: true });
    }
    return () => {
      host.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      watcher?.disconnect();
      changes?.disconnect();
      up();
      host.querySelectorAll('[data-live]').forEach((node) => node.removeAttribute('data-live'));
    };
  }, [root, active, selector]);
}
