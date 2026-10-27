import type { Palette } from '@/lib/brand';
import type { FontPairId } from '@/lib/font-pairs';
import type { Locale } from '@/lib/locale';
import type { RailStyle } from '@/lib/rail';
import type { MenuDesign } from '@/lib/templates/types';
import type { EngineConfig } from '@/server/domain/config';
import type { SnapshotMotion } from '@/server/domain/menu-motions';
import type { GuestFeatures } from '@/server/domain/plan-choices';

export type { Palette };

/** A social preview image from the media library, resolved at publish. */
export interface SeoImage {
  assetId: string;
  url: string;
  width: number;
  height: number;
}

/** Search and sharing text by language, with an optional social preview image. */
export type SeoText = Partial<Record<Locale, { title: string; description: string; image?: SeoImage }>>;

/** A brand logo from the media library, resolved at publish. */
export interface BrandImage {
  assetId: string;
  url: string;
  width: number;
  height: number;
  svg: boolean;
  /** The storage key of a raster rendition, for drawing it on the server (social image, QR codes). */
  rasterKey: string;
}

/** The brand's favicon, as PNGs at the three sizes browsers ask for. */
export interface BrandFavicon {
  assetId: string;
  png32: string;
  png180: string;
  png512: string;
}

/**
 * The brand kit as guests get it. The optional fields arrived with the brand kit (2b) and are left out when unused, so
 * a menu that uses none of them hashes exactly as it did before.
 */
export interface BrandView {
  logoText: string;
  theme: 'dark' | 'light';
  motionIntensity: 'none' | 'subtle' | 'expressive';
  /** How the category rail moves; the plain rail when the menu has turned motion off. */
  railStyle: RailStyle;
  tokens: { dark: Palette; light: Palette };
  /** The font pair; absent means `classic`. */
  fontPairId?: FontPairId;
  /** The rail style the brand chose, kept only when turning motion off made `railStyle` plain and they differ. */
  railChoice?: RailStyle;
  logo?: BrandImage;
  /** The logo for a dark theme, when it has its own. */
  logoDark?: BrandImage;
  favicon?: BrandFavicon;
  /**
   * The template the menu is drawn with, resolved at publish (src/lib/templates). Absent for the classic menu, whose
   * snapshot therefore hashes exactly as before templates existed.
   */
  design?: MenuDesign;
}

/**
 * A menu as guests get it: everything but `slug` and the ids comes from its live revision
 * (`src/server/data/public-menu.ts`).
 */
export interface TenantInfo {
  /** The menu's id. */
  id: string;
  restaurantId: string;
  /** Whether guests get the complaints and suggestions box. Read live with the statuses, never part of a snapshot. */
  feedbackEnabled: boolean;
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
  /** The brand kit as the restaurant's plan shows it: a choice the plan does not include is replaced by its fallback. */
  brand: BrandView;
  /** Search and sharing text by language, as set on the menu; a language without an entry uses the name. */
  seo: SeoText;
  /** What the restaurant's plan lets the guest pages show. Read live, never part of a snapshot. */
  features: GuestFeatures;
  /** The motions placed on the menu, from its revision; none when the restaurant's plan leaves them out. */
  motions: SnapshotMotion[];
}

export { getTenant } from './public-menu';
