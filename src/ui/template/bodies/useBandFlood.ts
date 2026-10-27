'use client';

import type { RefObject } from 'react';
import { useOnceInView } from './shared/useOnceInView';

/**
 * The flood of the Section Ink shape: a band's colour spreads out (a circle growing from its top corner, or from the
 * section chip that was tapped) when the band first scrolls into view. The "once, when first seen" part is the shared
 * `useOnceInView` on `[data-band]` (by `data-id`, the category; mark `data-in`), with its fallbacks: a rect sweep on
 * scroll and resize, a late pass after arming and keyboard focus, so a band is never left hidden when the observer
 * does not report (a background tab, an unpainted preview).
 *
 * The function it returns is for a tap on a section chip: if that band is off the screen it is reset to unflooded and
 * made to flood from the chip's place on the way in (from the chip's x on the band's top edge), so a tap always shows the
 * flood. A band in view is left as it is.
 */
export function useBandFlood(root: RefObject<HTMLElement | null>, reduced: boolean): (categoryId: string, chip: HTMLElement) => void {
  const control = useOnceInView(root, reduced, { item: 'data-band', id: 'data-id', mark: 'data-in', line: 0.88 });

  return (categoryId: string, chip: HTMLElement) => {
    const host = root.current;
    const api = control.current;
    if (!host || !api) return;
    const band = [...host.querySelectorAll<HTMLElement>('[data-band]')].find((candidate) => candidate.dataset.id === categoryId);
    if (!band) return;
    const box = band.getBoundingClientRect();
    if (box.bottom > 0 && box.top < window.innerHeight * 0.9) return;
    const at = chip.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((at.left + at.width / 2 - box.left) / (box.width || 1)) * 100));
    band.style.setProperty('--fx', `${x.toFixed(1)}%`);
    // Back to unflooded (instant: the band is off the screen) and forgotten, so it floods on the way in, not before.
    api.rearm(band);
  };
}
