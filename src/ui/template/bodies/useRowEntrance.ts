'use client';

import type { RefObject } from 'react';
import { useOnceInView } from './shared/useOnceInView';

/**
 * A dish name as words, for the Dancing Letters shape. Only words: Arabic and Kurdish letters join, so a name is never
 * split into letters, and the rows move word by word.
 */
export function dishWords(name: string): string[] {
  return name.split(/\s+/).filter(Boolean);
}

/**
 * The entrance of the Dancing Letters shape: each row's words rise and its price flips once, when the row first comes
 * into view. It is the shared `useOnceInView` on `[data-row]` (by `data-id`, the dish; mark `data-in`), with its
 * fallbacks (a rect sweep on scroll and resize, a late pass after arming, keyboard focus), so a row is never left
 * hidden when the observer does not report. With less motion it does nothing and every row is simply shown.
 */
export function useRowEntrance(root: RefObject<HTMLElement | null>, reduced: boolean) {
  useOnceInView(root, reduced, { item: 'data-row', id: 'data-id', mark: 'data-in', line: 0.92 });
}
