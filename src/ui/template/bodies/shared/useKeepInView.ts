'use client';

import { useEffect, type RefObject } from 'react';

type Box = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>;

/**
 * How far a strip must scroll along `axis` to show `item` wholly, with `margin` to spare: 0 when it already shows,
 * negative towards the strip's start, positive towards its end.
 */
export function keepInViewDelta(box: Box, item: Box, axis: 'x' | 'y', margin: number): number {
  const [start, end] = axis === 'x' ? (['left', 'right'] as const) : (['top', 'bottom'] as const);
  if (item[start] < box[start] + margin) return item[start] - box[start] - margin;
  if (item[end] > box[end] - margin) return item[end] - box[end] + margin;
  return 0;
}

/**
 * Keeps the lit entry of a shape's section strip in view, moving only the strip (never the page). The entry is the
 * element inside `strip` with `data-category` equal to `activeId`. Keyed on the lit section only, so a search or a
 * filter (a new `categories`) never moves anything; with less motion the strip jumps instead of gliding.
 */
export function useKeepInView(strip: RefObject<HTMLElement | null>, activeId: string | null, axis: 'x' | 'y', reduced: boolean, margin = 16) {
  useEffect(() => {
    const container = strip.current;
    const active = activeId ? container?.querySelector<HTMLElement>(`[data-category="${CSS.escape(activeId)}"]`) : null;
    if (!container || !active) return;
    const delta = keepInViewDelta(container.getBoundingClientRect(), active.getBoundingClientRect(), axis, margin);
    if (delta !== 0) container.scrollBy({ [axis === 'x' ? 'left' : 'top']: delta, behavior: reduced ? 'auto' : 'smooth' });
  }, [strip, activeId, axis, reduced, margin]);
}
