'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Pieces the `coverflow` and `pedestal` families share (spec 2026-10-28-menu-styles-77-addendum.md): the neon hues of
 * the space styles' sections, and the hook that tells a section's endless motion when it may run.
 */

/** The space styles' section hues (degrees, oklch): grill red, amber, green, pink, blue, violet, then again. */
export const NEON_HUES = [25, 70, 150, 350, 245, 300] as const;

/**
 * Marks every `[data-live-zone]` under `root` with `data-live` while it is on screen, and with `data-hold` while a
 * finger (or the mouse button) is down on it, so the CSS runs a zone's endless motion (a spinning record, a bobbing
 * card) only when it is seen and not being touched. Does nothing with less motion: the CSS keeps everything still then.
 * `deps` re-reads the zones when the sections change (a search, a filter).
 */
export function useLiveZones(root: RefObject<HTMLElement | null>, reduced: boolean, deps: unknown): void {
  useEffect(() => {
    const host = root.current;
    if (!host || reduced || typeof IntersectionObserver === 'undefined') return;
    const zones = [...host.querySelectorAll<HTMLElement>('[data-live-zone]')];
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) (entry.target as HTMLElement).toggleAttribute('data-live', entry.isIntersecting);
      },
      { rootMargin: '64px 0px' },
    );
    const down = (event: PointerEvent) => (event.currentTarget as HTMLElement).setAttribute('data-hold', '');
    const up = (event: PointerEvent) => (event.currentTarget as HTMLElement).removeAttribute('data-hold');
    for (const zone of zones) {
      watcher.observe(zone);
      zone.addEventListener('pointerdown', down, { passive: true });
      for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) zone.addEventListener(type, up, { passive: true });
    }
    return () => {
      watcher.disconnect();
      for (const zone of zones) {
        zone.removeEventListener('pointerdown', down);
        for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) zone.removeEventListener(type, up);
        zone.removeAttribute('data-live');
        zone.removeAttribute('data-hold');
      }
    };
  }, [root, reduced, deps]);
}
