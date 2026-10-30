import { HEX } from '@/lib/brand';
import { isFontPairId } from '@/lib/font-pairs';
import { LOCALES } from '@/lib/locale';
import { isSafeMediaUrl } from '@/lib/media';
import { DAYS, TIME_OF_DAY, type WorkingHours } from '@/server/domain/restaurant-profile';
import { isMotionPresetId, withMotionPreset } from './motion-presets';
import { sanitizeDesignPalette, themeOf } from './palette';
import {
  CARD_KINDS,
  CORNERS,
  DENSITIES,
  DESIGN_PALETTE_KEYS,
  DETAIL_KINDS,
  BODY_KINDS,
  HEADING_STYLES,
  HERO_KINDS,
  IMAGE_RATIOS,
  NAV_KINDS,
  OPTION_STYLES,
  ORDERING_MODES,
  SHADOWS,
  VISUAL_MODES,
  type BusinessInfo,
  type DesignLayout,
  type DesignOverrides,
  type DesignPalette,
  type DesignType,
  type InfoVisibility,
  type LocalText,
  type MenuDesign,
  type ModelFraming,
  type Promotion,
  type SceneMedia,
  type SceneSettings,
  type SocialLinks,
  type TemplatePreset,
} from './types';

/**
 * A business's overrides read from storage, and its template resolved with them into the design a snapshot freezes.
 * Pure and dependency-free (no Zod), so the Studio's live preview can resolve a design in the browser.
 */

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);
const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export const SCALE_RANGE = [0.85, 1.25] as const;
export const TRACKING_RANGE = [-0.04, 0.2] as const;
export const SCENE_RANGES = {
  intensity: [0, 1],
  speed: [0.25, 2],
  brightness: [0.5, 1.5],
  blur: [0, 12],
  opacity: [0, 1],
  overlay: [0, 0.8],
} as const satisfies Partial<Record<keyof SceneSettings, readonly [number, number]>>;

export const FRAMING_RANGES = {
  scale: [0.5, 2],
  x: [-1, 1],
  y: [-1, 1],
  turn: [-180, 180],
} as const satisfies Record<keyof ModelFraming, readonly [number, number]>;
export const DEFAULT_FRAMING: ModelFraming = { scale: 1, x: 0, y: 0, turn: 0 };
const ASSET_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Most featured products a menu shows. */
export const MAX_FEATURED = 12;
export const TEXT_LIMITS = { featuredTitle: 80, promoTitle: 80, promoBody: 300, promoTerms: 300 } as const;
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

function localText(value: unknown, max: number): LocalText | undefined {
  if (!isObject(value)) return undefined;
  const text: LocalText = {};
  for (const locale of LOCALES) {
    const entry = value[locale];
    if (typeof entry === 'string' && entry.trim() !== '' && entry.length <= max) text[locale] = entry.trim();
  }
  return Object.keys(text).length > 0 ? text : undefined;
}

function picked<T extends object>(source: Json, rules: { [K in keyof T]?: (value: unknown) => boolean }): Partial<T> | undefined {
  const result: Partial<T> = {};
  for (const [key, valid] of Object.entries(rules) as Array<[keyof T & string, (value: unknown) => boolean]>) {
    if (key in source && valid(source[key])) result[key] = source[key] as T[keyof T & string];
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

const LAYOUT_RULES: { [K in keyof DesignLayout]: (value: unknown) => boolean } = {
  body: (v) => oneOf(BODY_KINDS, v),
  hero: (v) => oneOf(HERO_KINDS, v),
  nav: (v) => oneOf(NAV_KINDS, v),
  card: (v) => oneOf(CARD_KINDS, v),
  detail: (v) => oneOf(DETAIL_KINDS, v),
  options: (v) => oneOf(OPTION_STYLES, v),
  imageRatio: (v) => oneOf(IMAGE_RATIOS, v),
  density: (v) => oneOf(DENSITIES, v),
  corners: (v) => oneOf(CORNERS, v),
  shadow: (v) => oneOf(SHADOWS, v),
  heading: (v) => oneOf(HEADING_STYLES, v),
};

const TYPE_RULES: { [K in keyof DesignType]: (value: unknown) => boolean } = {
  fontPairId: isFontPairId,
  scale: (v) => inRange(v, ...SCALE_RANGE),
  displayCase: (v) => v === 'normal' || v === 'upper',
  tracking: (v) => inRange(v, ...TRACKING_RANGE),
};

const bool = (v: unknown) => typeof v === 'boolean';
const SCENE_RULES: { [K in keyof SceneSettings]: (value: unknown) => boolean } = {
  mode: (v) => oneOf(VISUAL_MODES, v),
  intensity: (v) => inRange(v, ...SCENE_RANGES.intensity),
  speed: (v) => inRange(v, ...SCENE_RANGES.speed),
  ambient: bool,
  tap: bool,
  scroll: bool,
  brightness: (v) => inRange(v, ...SCENE_RANGES.brightness),
  blur: (v) => inRange(v, ...SCENE_RANGES.blur),
  opacity: (v) => inRange(v, ...SCENE_RANGES.opacity),
  overlay: (v) => inRange(v, ...SCENE_RANGES.overlay),
};

const FRAMING_RULES: { [K in keyof ModelFraming]: (value: unknown) => boolean } = {
  scale: (v) => inRange(v, ...FRAMING_RANGES.scale),
  x: (v) => inRange(v, ...FRAMING_RANGES.x),
  y: (v) => inRange(v, ...FRAMING_RANGES.y),
  turn: (v) => inRange(v, ...FRAMING_RANGES.turn),
};

const INFO_RULES: { [K in keyof InfoVisibility]: (value: unknown) => boolean } = {
  hours: bool,
  address: bool,
  map: bool,
  phone: bool,
  whatsapp: bool,
  social: bool,
};

function promotion(value: unknown): Promotion | null | undefined {
  if (value === null) return null;
  if (!isObject(value)) return undefined;
  const title = localText(value.title, TEXT_LIMITS.promoTitle);
  const terms = localText(value.terms, TEXT_LIMITS.promoTerms);
  // An offer without its conditions is never kept.
  if (!title || !terms) return undefined;
  return { title, body: localText(value.body, TEXT_LIMITS.promoBody) ?? {}, terms };
}

const safeUrl = (value: unknown): value is string => isSafeMediaUrl(value) && value.length <= 1000;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * A resolved scene file from elsewhere than a snapshot (the Studio's message to its preview), read as strictly as a
 * snapshot reads one: safe URLs only, a known kind, a model framed within range. Null for anything else.
 */
export function parseSceneMedia(value: unknown): SceneMedia | null {
  if (!isObject(value) || typeof value.assetId !== 'string' || !ASSET_ID.test(value.assetId) || !safeUrl(value.url)) return null;
  const { assetId, url } = value;
  switch (value.kind) {
    case 'model': {
      const framing = isObject(value.framing) ? picked<ModelFraming>(value.framing, FRAMING_RULES) : undefined;
      if (!framing || Object.keys(framing).length !== 4) return null;
      return { kind: 'model', assetId, url, framing: framing as ModelFraming };
    }
    case 'lottie':
      return positive(value.width) && positive(value.height) ? { kind: 'lottie', assetId, url, width: value.width, height: value.height } : null;
    case 'image': {
      if (!positive(value.width) || !positive(value.height)) return null;
      const srcset = typeof value.srcset === 'string' && value.srcset.split(',').every((entry) => entry.trim() === '' || safeUrl(entry.trim().split(' ')[0])) ? value.srcset : '';
      const placeholder = typeof value.placeholder === 'string' && /^(data:image\/webp;base64,[A-Za-z0-9+/]+={0,2})?$/.test(value.placeholder) ? value.placeholder : '';
      return { kind: 'image', assetId, url, width: value.width, height: value.height, srcset, placeholder };
    }
    case 'video': {
      const poster = value.poster;
      if (!positive(value.width) || !positive(value.height) || !isObject(poster) || !safeUrl(poster.url)) return null;
      const srcset = typeof poster.srcset === 'string' && poster.srcset.split(',').every((entry) => entry.trim() === '' || safeUrl(entry.trim().split(' ')[0])) ? poster.srcset : '';
      const placeholder = typeof poster.placeholder === 'string' && /^(data:image\/webp;base64,[A-Za-z0-9+/]+={0,2})?$/.test(poster.placeholder) ? poster.placeholder : '';
      return { kind: 'video', assetId, url, width: value.width, height: value.height, poster: { url: poster.url, srcset, placeholder } };
    }
    default:
      return null;
  }
}

/** Overrides from storage. Anything malformed, unknown or out of range is dropped, never guessed at. */
export function parseOverrides(input: unknown): DesignOverrides {
  if (!isObject(input)) return {};
  const overrides: DesignOverrides = {};
  if (typeof input.paletteId === 'string' && /^[a-z0-9-]{1,40}$/.test(input.paletteId)) overrides.paletteId = input.paletteId;
  if (isObject(input.colors)) {
    const colors: Partial<DesignPalette> = {};
    for (const key of DESIGN_PALETTE_KEYS) {
      const value = input.colors[key];
      if (typeof value === 'string' && HEX.test(value)) colors[key] = value.toUpperCase();
    }
    if (Object.keys(colors).length > 0) overrides.colors = colors;
  }
  const type = isObject(input.type) ? picked<DesignType>(input.type, TYPE_RULES) : undefined;
  if (type) overrides.type = type;
  const layout = isObject(input.layout) ? picked<DesignLayout>(input.layout, LAYOUT_RULES) : undefined;
  if (layout) overrides.layout = layout;
  const scene = isObject(input.scene) ? picked<SceneSettings>(input.scene, SCENE_RULES) : undefined;
  if (scene) overrides.scene = scene;
  if (isMotionPresetId(input.motionPreset)) overrides.motionPreset = input.motionPreset;
  if (isObject(input.sceneAsset) && typeof input.sceneAsset.assetId === 'string' && ASSET_ID.test(input.sceneAsset.assetId)) {
    const framing = isObject(input.sceneAsset.framing) ? picked<ModelFraming>(input.sceneAsset.framing, FRAMING_RULES) : undefined;
    overrides.sceneAsset = { assetId: input.sceneAsset.assetId, ...(framing ? { framing } : {}) };
  }
  if (isObject(input.featured) && Array.isArray(input.featured.slugs)) {
    const slugs = [...new Set(input.featured.slugs.filter((slug): slug is string => typeof slug === 'string' && SLUG.test(slug)))].slice(0, MAX_FEATURED);
    const title = localText(input.featured.title, TEXT_LIMITS.featuredTitle);
    overrides.featured = { slugs, ...(title ? { title } : {}) };
  }
  const promo = promotion(input.promo);
  if (promo !== undefined) overrides.promo = promo;
  const info = isObject(input.info) ? picked<InfoVisibility>(input.info, INFO_RULES) : undefined;
  if (info) overrides.info = info;
  if (oneOf(ORDERING_MODES, input.ordering)) overrides.ordering = input.ordering;
  return overrides;
}

// ---------------------------------------------------------------------------------------------------------------------
// The restaurant's details
// ---------------------------------------------------------------------------------------------------------------------

/** The restaurant profile fields the menu can show, as the Restaurant row holds them. */
export interface RestaurantDetails {
  address: string;
  city: string;
  phone: string;
  whatsapp: string;
  mapUrl: string;
  socialLinks: unknown;
  workingHours: unknown;
}

const HTTPS = /^https:\/\/[^\s<>"']{3,500}$/;
const PHONE = /^\+?[0-9][0-9 ()-]{4,24}$/;

function hoursOf(value: unknown): WorkingHours | undefined {
  if (!isObject(value)) return undefined;
  const hours = {} as WorkingHours;
  let any = false;
  for (const day of DAYS) {
    const ranges = Array.isArray(value[day]) ? value[day] : [];
    hours[day] = ranges.filter(
      (range): range is [string, string] =>
        Array.isArray(range) && range.length === 2 && range.every((time) => typeof time === 'string' && TIME_OF_DAY.test(time)),
    );
    if (hours[day].length > 0) any = true;
  }
  return any ? hours : undefined;
}

function socialOf(value: unknown): SocialLinks | undefined {
  if (!isObject(value)) return undefined;
  const links: SocialLinks = {};
  for (const key of ['instagram', 'facebook', 'tiktok', 'website'] as const) {
    const url = value[key];
    if (typeof url === 'string' && HTTPS.test(url.trim())) links[key] = url.trim();
  }
  return Object.keys(links).length > 0 ? links : undefined;
}

/** The details a menu shows: the ones switched on and filled in, each checked (links https only, phones digits). */
export function businessInfo(details: RestaurantDetails, visible: InfoVisibility): BusinessInfo {
  const info: BusinessInfo = {};
  const hours = visible.hours ? hoursOf(details.workingHours) : undefined;
  if (hours) info.hours = hours;
  const address = [details.address.trim(), details.city.trim()].filter(Boolean).join(', ');
  if (visible.address && address) info.address = address;
  if (visible.map && HTTPS.test(details.mapUrl.trim())) info.mapUrl = details.mapUrl.trim();
  if (visible.phone && PHONE.test(details.phone.trim())) info.phone = details.phone.trim();
  if (visible.whatsapp && PHONE.test(details.whatsapp.trim())) info.whatsapp = details.whatsapp.trim();
  const social = visible.social ? socialOf(details.socialLinks) : undefined;
  if (social) info.social = social;
  return info;
}

export const ALL_INFO: InfoVisibility = { hours: true, address: true, map: true, phone: true, whatsapp: true, social: true };

// ---------------------------------------------------------------------------------------------------------------------
// Resolving
// ---------------------------------------------------------------------------------------------------------------------

export interface ResolveExtras {
  details: RestaurantDetails | null;
  poweredBy: boolean;
  customTemplateId?: string;
}

/** The palette a business sees: its curated choice (or the preset's own), with its manual colours on top. */
export function overriddenPalette(preset: TemplatePreset, overrides: DesignOverrides): DesignPalette {
  const base = preset.palettes.find((entry) => entry.id === overrides.paletteId)?.palette ?? preset.palette;
  return sanitizeDesignPalette(overrides.colors, base);
}

/** A preset with a business's overrides on top, field by field, and the restaurant's details it chose to show. */
export function resolveDesign(preset: TemplatePreset, overrides: DesignOverrides, extras: ResolveExtras): MenuDesign {
  const palette = overriddenPalette(preset, overrides);
  const visible = { ...ALL_INFO, ...overrides.info };
  return {
    templateId: preset.id,
    theme: themeOf(palette.bg),
    palette,
    type: { ...preset.type, ...overrides.type },
    layout: { ...preset.layout, ...overrides.layout },
    scene: { ...withMotionPreset(preset.scene, overrides.motionPreset), ...overrides.scene },
    featured: {
      slugs: overrides.featured?.slugs ?? [],
      ...(overrides.featured?.title ? { title: overrides.featured.title } : {}),
    },
    ...(overrides.promo ? { promo: overrides.promo } : {}),
    info: extras.details ? businessInfo(extras.details, visible) : {},
    ordering: overrides.ordering ?? 'list',
    poweredBy: extras.poweredBy,
    source: {
      templateVersion: preset.version,
      ...(extras.customTemplateId ? { customTemplateId: extras.customTemplateId } : {}),
      overrides,
    },
  };
}
