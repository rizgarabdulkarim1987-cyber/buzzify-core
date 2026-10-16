import type { Palette } from '@/lib/brand';
import type { Locale } from '@/lib/locale';
import type { RailStyle } from '@/lib/rail';
import type { EngineConfig } from '@/server/domain/config';

export type { Palette };

export interface BrandView {
  logoText: string;
  theme: 'dark' | 'light';
  motionIntensity: 'none' | 'subtle' | 'expressive';
  /** How the category rail moves; the plain rail when the menu has turned motion off. */
  railStyle: RailStyle;
  tokens: { dark: Palette; light: Palette };
}

/**
 * A menu as guests get it: everything but `slug` and the ids comes from its live revision
 * (`src/server/data/public-menu.ts`).
 */
export interface TenantInfo {
  /** The menu's id. */
  id: string;
  restaurantId: string;
  /** The live revision everything else here, and the catalog, is read from. */
  revisionId: string;
  /** The menu's current slug. */
  slug: string;
  /** The name guests see: the restaurant's. */
  name: string;
  currency: string;
  defaultLocale: Locale;
  locales: Locale[];
  timeZone: string;
  numeralSystem: 'latn' | 'arab';
  engineConfig: EngineConfig;
  brand: BrandView;
}

export { getTenant } from './public-menu';
