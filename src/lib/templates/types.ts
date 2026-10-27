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

/**
 * How guests browse the menu: `scroll` is the long page every template has always had; the others are shapes that
 * replace some of the structural knobs (see `SHAPE_SETS`).
 */
export const BODY_KINDS = ['scroll', 'book', 'magazine', 'board', 'elevator', 'periodic', 'metro', 'cabinet', 'shelves', 'tickets', 'tabletop', 'comics', 'homescreen', 'treasure', 'levels', 'fridge', 'bento', 'mailboxes', 'depth', 'kinetic', 'theatre', 'stacked', 'morph', 'fly', 'ink', 'steam', 'citadel', 'lanterns', 'carpet'] as const;
export type BodyKind = (typeof BODY_KINDS)[number];

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
  /** Absent means `scroll`: a design stored before shapes existed, and every scroll template, carries no body. */
  body?: BodyKind;
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

/** The layout knobs a body sets itself. Customize hides these while that body is chosen. */
export const SHAPE_SETS: Record<BodyKind, ReadonlyArray<keyof DesignLayout>> = {
  scroll: [],
  book: ['hero', 'nav'],
  magazine: ['hero'],
  board: ['hero', 'nav', 'card', 'heading'],
  elevator: ['hero', 'nav', 'card', 'heading'],
  periodic: ['hero', 'nav', 'card', 'heading', 'imageRatio'],
  metro: ['hero', 'nav', 'card', 'heading'],
  cabinet: ['hero', 'nav', 'card', 'heading'],
  shelves: ['hero', 'nav', 'card', 'heading', 'imageRatio'],
  tickets: ['hero', 'nav', 'card', 'heading'],
  tabletop: ['hero', 'nav', 'card', 'heading'],
  comics: ['hero', 'nav', 'card', 'heading'],
  homescreen: ['hero', 'nav', 'card', 'heading'],
  treasure: ['hero', 'nav', 'card', 'heading'],
  levels: ['hero', 'nav', 'card', 'heading'],
  fridge: ['hero', 'nav', 'card', 'heading'],
  bento: ['hero', 'nav', 'card', 'heading'],
  mailboxes: ['hero', 'nav', 'card', 'heading'],
  depth: ['hero', 'nav', 'card', 'heading'],
  kinetic: ['hero', 'nav', 'card', 'heading'],
  theatre: ['hero', 'nav', 'card', 'heading'],
  stacked: ['hero', 'nav', 'card', 'heading'],
  morph: ['hero', 'nav', 'card', 'heading'],
  fly: ['hero', 'nav', 'card', 'heading'],
  ink: ['hero', 'nav', 'card', 'heading'],
  steam: ['hero', 'nav', 'card', 'heading'],
  citadel: ['hero', 'nav', 'card', 'heading'],
  lanterns: ['hero', 'nav', 'card', 'heading'],
  carpet: ['hero', 'nav', 'card', 'heading'],
};

/** The shape a design browses in; `scroll` when it names none. */
export function bodyOf(layout: Pick<DesignLayout, 'body'>): BodyKind {
  return layout.body ?? 'scroll';
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
  /** 1 to 33, the order of the brief. */
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

/** Where a model sits in the background: its size, where it stands across and up the screen, and how far it is turned. */
export interface ModelFraming {
  /** 0.5 to 2. */
  scale: number;
  /** -1 (left) to 1 (right). */
  x: number;
  /** -1 (down) to 1 (up). */
  y: number;
  /** Degrees, -180 to 180. */
  turn: number;
}

/** A file from the media library chosen as the background (Template Studio stage 2): its asset, and a model's framing. */
export interface SceneAssetChoice {
  assetId: string;
  framing?: Partial<ModelFraming>;
}

/** A scene file as a published menu plays it, resolved at publish like the rest of the design. */
export type SceneMedia =
  | { kind: 'model'; assetId: string; url: string; framing: ModelFraming }
  | {
      kind: 'video';
      assetId: string;
      url: string;
      width: number;
      height: number;
      /** The still shown before the video plays, and instead of it with reduced motion or data saver. */
      poster: { url: string; srcset: string; placeholder: string };
    }
  | { kind: 'lottie'; assetId: string; url: string; width: number; height: number };

/** What a business changed from its template: only what it changed. Stored on `BrandConfig.design`. */
export interface DesignOverrides {
  /** One of the preset's curated palettes, before `colors`. */
  paletteId?: string;
  colors?: Partial<DesignPalette>;
  type?: Partial<DesignType>;
  layout?: Partial<DesignLayout>;
  scene?: Partial<SceneSettings>;
  /** A library file drawn as the background instead of the template's own scene. Part of the look. */
  sceneAsset?: SceneAssetChoice;
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
  /** The library file the background plays instead of the template's own scene, when the business chose one. */
  media?: SceneMedia;
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
  'the-book',
  'the-magazine',
  'taste-airport',
  'the-elevator',
  'the-periodic-table',
  'the-metro-line',
  'the-drawer-cabinet',
  'the-supermarket-shelves',
  'the-kitchen-ticket-rail',
  'the-table-from-above',
  'the-kitchen-comics',
  'the-phone-home-screen',
  'the-treasure-map',
  'the-game-levels',
  'the-fridge',
  'the-bento-box',
  'the-mailbox-wall',
  'the-scroll-depth',
  'the-dancing-letters',
  'the-curtain-and-spotlight',
  'the-stacked-sheets',
  'the-photo-to-details',
  'the-fly-to-cart',
  'the-section-ink',
  'the-living-steam',
  'the-erbil-citadel',
  'the-ramadan-nights',
  'the-thousand-and-one-nights',
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (TEMPLATE_IDS as readonly string[]).includes(value);
}
