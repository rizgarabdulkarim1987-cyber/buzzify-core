'use client';

import { useMemo } from 'react';
import { useTemplate } from '../../context';

/**
 * A section's place (0-based) in the menu's FULL list of sections, not in the filtered `categories`: what a shape's
 * per-section colour, roof, drop or numeral is derived from, so a search that hides some sections never renumbers or
 * recolours the ones still shown.
 */
export function usePlaceOf(): (category: { id: string }) => number {
  const { view } = useTemplate();
  return useMemo(() => {
    const places = new Map(view.categories.map((category, at) => [category.id, at]));
    return (category) => places.get(category.id) ?? 0;
  }, [view.categories]);
}
