import { Layers, Pill, Shirt, ShoppingCart, Smartphone, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import type { SpaceId } from '@/studio/spaces';

/**
 * Each space's own drawing, the same wherever the space is named (its tile on the hub, its list in the sidebar, the
 * badge of one of its businesses): a cart for the Supermarket, a phone for Electronics, a shirt for Clothing.
 */
export const SPACE_ICONS: Record<SpaceId, LucideIcon> = {
  food: UtensilsCrossed,
  pharmacy: Pill,
  supermarket: ShoppingCart,
  electronics: Smartphone,
  clothing: Shirt,
  platform: Layers,
};
