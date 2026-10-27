'use client';

import { useMemo } from 'react';
import { useTemplate } from '../../context';

/**
 * A dish's place (0-based) in its section's FULL list of dishes, not in the filtered one a search leaves: what a shape's
 * per-dish colour, side or size is derived from, so a search never recolours, flips or resizes the dishes still shown
 * (the per-dish twin of `usePlaceOf`).
 */
export function useProductPlace(): (product: { id: string }) => number {
  const { view } = useTemplate();
  return useMemo(() => {
    const places = new Map<string, number>();
    const counts = new Map<string, number>();
    for (const product of view.products) {
      const at = counts.get(product.categoryId) ?? 0;
      places.set(product.id, at);
      counts.set(product.categoryId, at + 1);
    }
    return (product) => places.get(product.id) ?? 0;
  }, [view.products]);
}
