'use client';

import { useEffect, type RefObject } from 'react';

/** Scrolls a sideways-scrolling rail so its active link sits in the middle, smoothly unless motion is reduced. */
export function useCentreActive(rail: RefObject<HTMLElement | null>, activeId: string | null, reduced: boolean): void {
  useEffect(() => {
    const nav = rail.current;
    const link = nav?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!nav || !link || typeof nav.scrollBy !== 'function') return;
    const box = link.getBoundingClientRect();
    const frame = nav.getBoundingClientRect();
    // Measured on screen, so the same sum works whichever way the rail runs.
    const off = box.left + box.width / 2 - (frame.left + frame.width / 2);
    if (Math.abs(off) > 1) nav.scrollBy({ left: off, behavior: reduced ? 'auto' : 'smooth' });
  }, [rail, activeId, reduced]);
}
