'use client';

import { createContext, useContext } from 'react';
import type { MenuDesign } from '@/lib/templates/types';
import type { MenuProductView, MenuView } from '@/server/data/menu-view';

export type MenuCategory = MenuView['categories'][number];

/** What every part of a template menu reads: the design, the menu as filtered, and the guest's actions. */
export interface TemplateContextValue {
  design: MenuDesign;
  view: MenuView;
  /** Categories that have a product after search and filters, in menu order. */
  categories: MenuCategory[];
  byCategory: ReadonlyMap<string, MenuProductView[]>;
  /** Products picked for the hero: the business's featured slugs, else its featured products, else the first few. */
  featured: MenuProductView[];
  signature: MenuProductView | undefined;
  activeId: string | null;
  jumpTo(categoryId: string): void;
  openProduct(productId: string, variantId?: string | null): void;
  /** Whether guests can add to an order here (ordering on, not a Studio preview). */
  canOrder: boolean;
  quickAdd(product: MenuProductView): void;
  isFavorite(productId: string): boolean;
  toggleFavorite(product: MenuProductView): void;
  /** True when the visitor asked for less motion. */
  reduced: boolean;
}

export const TemplateContext = createContext<TemplateContextValue | null>(null);

export function useTemplate(): TemplateContextValue {
  const value = useContext(TemplateContext);
  if (!value) throw new Error('useTemplate must be used inside a template menu');
  return value;
}
