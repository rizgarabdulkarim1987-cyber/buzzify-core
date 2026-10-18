import type { Palette } from '@/lib/brand';
import type { FontPairId } from '@/lib/font-pairs';
import type { Locale } from '@/lib/locale';
import type { WorkingHours } from '@/server/domain/restaurant-profile';

/**
 * The template presets' vocabulary (spec `2026-10-18-template-studio-design.md`, section 4): what a preset is, what a
 * business may override, and the resolved design a published menu is drawn from. Pure, shared by the Studio, the
 * snapshot and the public renderer.
 */

export const BUSINESS_TYPES = ['restaurant', 'cafe', 'bakery', 'icecream'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const STYLE_TAGS = ['light', 'dark', 'minimal', 'cinematic', 'playful'] as const;
export type StyleTag = (typeof STYLE_TAGS)[number];

/** The top of the menu, above the categories. Every kind leaves products and prices on the first screen. */
export const HERO_KINDS = [
  'editorial',
  'asymmetric',
  'arch',
  'chapters',
  'spotlight',
  'carousel',
  'pedestal',
  'collection',
  'daily',
  'occasion',
  'flavorWall',
  'catch',
  'compact',
] as const;
export type HeroKind = (typeof HERO_KINDS)[number];

/** The sticky category navigation. */
export const NAV_KINDS = ['underline', 'pills', 'chips', 'index', 'chapters', 'segmented', 'tiles', 'dock'] as const;
export type NavKind = (typeof NAV_KINDS)[number];

/** How one product is shown in its category. */
export const CARD_KINDS = [
  'row',
  'plate',
  'photo',
  'ingredient',
  'compact',
  'gallery',
  'isolated',
  'list',
  'flavor',
  'oversized',
  'cake',
  'drink',
] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** Where a product's details open. `steps` walks through its choices one group at a time (a sundae builder). */
export const DETAIL_KINDS = ['sheet', 'drawer', 'page', 'card', 'steps'] as const;
export type DetailKind = (typeof DETAIL_KINDS)[number];

/** How a product's sizes and options are offered in its details. */
export const OPTION_STYLES = ['list', 'chips', 'tiles'] as const;
export type OptionStyle = (typeof OPTION_STYLES)[number];

export const IMAGE_RATIOS = ['square', 'portrait', 'landscape', 'wide', 'circle', 'arch'] as const;
export type ImageRatio = (typeof IMAGE_RATIOS)[number];

export const DENSITIES = ['airy', 'comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export const CORNERS = ['none', 'soft', 'round', 'pill'] as const;
export type Corners = (typeof CORNERS)[number];

export const SHADOWS = ['none', 'soft', 'lifted'] as const;
export type Shadow = (typeof SHADOWS)[number];

/** How a category's heading is set. */
export const HEADING_STYLES = ['rule', 'numbered', 'arch', 'plain', 'seal', 'script', 'band', 'ornament', 'outline'] as const;
export type HeadingStyle = (typeof HEADING_STYLES)[number];

/** The three background modes every preset supports (spec 6). */
export const VISUAL_MODES = ['static', 'motion', '3d'] as const;
export type VisualMode = (typeof VISUAL_MODES)[number];

export const ORDERING_MODES = ['none', 'list'] as const;
/** `none`: a menu only, with no cart at all. `list`: the cart and order review guests show to staff. */
export type OrderingMode = (typeof ORDERING_MODES)[number];

/** The brand kit's eight colours and three more a template needs: the card behind a product, and the main button. */
export interface DesignPalette extends Palette {
  card: string;
  button: string;
  onButton: string;
}

export const DESIGN_PALETTE_KEYS = [
  'bg',
  'surface',
  'raised',
  'card',
  'text',
  'muted',
  'line',
  'accent',
  'onAccent',
  'button',
  'onButton',
] as const satisfies ReadonlyArray<keyof DesignPalette>;

export interface DesignType {
  fontPairId: FontPairId;
  /** Multiplies every size: 0.85 to 1.25. */
  scale: number;
  /** Latin display text in capitals (Arabic script has none, so it is untouched). */
  displayCase: 'normal' | 'upper';
  /** Letter spacing of Latin display text, in em: -0.04 to 0.2. */
  tracking: number;
}

export interface DesignLayout {
  hero: HeroKind;
  nav: NavKind;
  card: CardKind;
  detail: DetailKind;
  options: OptionStyle;
  imageRatio: ImageRatio;
  density: Density;
  corners: Corners;
  shadow: Shadow;
  heading: HeadingStyle;
}

export interface SceneSettings {
  /** The mode the business asks for; a device that cannot show it gets the next one down. */
  mode: VisualMode;
  /** How much of the scene shows and moves: 0 to 1. */
  intensity: number;
  /** Ambient speed: 0.25 to 2. */
  speed: number;
  /** Background movement while nobody touches the page. */
  ambient: boolean;
  /** A small reaction where the guest taps the background. */
  tap: boolean;
  /** The scene follows scroll progress, both ways. */
  scroll: boolean;
  /** 0.5 to 1.5. */
  brightness: number;
  /** Pixels, 0 to 12. */
  blur: number;
  /** 0 to 1. */
  opacity: number;
  /** How much the page colour veils the scene, 0 to 0.8, so text in front stays readable. */
  overlay: number;
}

export interface CuratedPalette {
  id: string;
  /** What the Studio calls it (an English name; the Studio shows it as is). */
  name: string;
  palette: DesignPalette;
}

export interface TemplatePreset {
  id: TemplateId;
  /** 1 to 30, the order of the brief. */
  number: number;
  name: string;
  business: BusinessType;
  tags: StyleTag[];
  /** Raised when the preset's defaults change, so the Studio can say a template moved on since a menu's last publish. */
  version: number;
  /** The default palette. Its theme (light or dark) follows from its background. */
  palette: DesignPalette;
  /** At least three alternatives the Studio offers beside manual editing. */
  palettes: CuratedPalette[];
  type: DesignType;
  layout: DesignLayout;
  scene: SceneSettings;
}

/** A text the business writes in each of its languages. */
export type LocalText = Partial<Record<Locale, string>>;

/** Which of the restaurant's details the menu shows (each only when the profile has it). */
export interface InfoVisibility {
  hours: boolean;
  address: boolean;
  map: boolean;
  phone: boolean;
  whatsapp: boolean;
  social: boolean;
}

export interface Promotion {
  title: LocalText;
  body: LocalText;
  /** The offer's conditions, shown with it. An offer is never shown without its terms. */
  terms: LocalText;
}

/** What a business changed from its template: only what it changed. Stored on `BrandConfig.design`. */
export interface DesignOverrides {
  /** One of the preset's curated palettes, before `colors`. */
  paletteId?: string;
  colors?: Partial<DesignPalette>;
  type?: Partial<DesignType>;
  layout?: Partial<DesignLayout>;
  scene?: Partial<SceneSettings>;
  /** Products to feature, by slug (ids change when a revision is restored or a menu duplicated; slugs do not). */
  featured?: { slugs: string[]; title?: LocalText };
  promo?: Promotion | null;
  info?: Partial<InfoVisibility>;
  ordering?: OrderingMode;
}

export interface SocialLinks {
  instagram?: string;
  facebook?: string;
  tiktok?: string;
  website?: string;
}

/** The restaurant's details as the menu shows them: only those shown and filled in. */
export interface BusinessInfo {
  hours?: WorkingHours;
  address?: string;
  mapUrl?: string;
  phone?: string;
  whatsapp?: string;
  social?: SocialLinks;
}

/** A published menu's design (`BrandView.design`): resolved, so later changes to a preset never alter it. */
export interface MenuDesign {
  templateId: TemplateId;
  theme: 'dark' | 'light';
  palette: DesignPalette;
  type: DesignType;
  layout: DesignLayout;
  scene: SceneSettings;
  featured: { slugs: string[]; title?: LocalText };
  promo?: Promotion;
  info: BusinessInfo;
  ordering: OrderingMode;
  poweredBy: boolean;
  /** What the draft stored, so restoring the revision writes exactly that back. */
  source: { templateVersion: number; customTemplateId?: string; overrides: DesignOverrides };
}

export const TEMPLATE_IDS = [
  'obsidian-gold',
  'ivory-marble',
  'emerald-palace',
  'royal-burgundy',
  'kyoto-ink',
  'mediterranean-riviera',
  'ember-grill',
  'botanical-table',
  'saffron-house',
  'ocean-pearl',
  'copper-roast',
  'cream-studio',
  'matcha-ritual',
  'midnight-espresso',
  'terra-cafe',
  'nordic-brew',
  'neon-noir',
  'gallery-blanc',
  'paris-maison',
  'butter-and-fold',
  'rose-patisserie',
  'cocoa-atelier',
  'artisan-crust',
  'pistachio-boutique',
  'celebration-house',
  'gelato-riviera',
  'sorbet-garden',
  'vanilla-cloud',
  'pop-gelato',
  'frozen-jewel',
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (TEMPLATE_IDS as readonly string[]).includes(value);
}
