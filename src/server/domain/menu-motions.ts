import type { Locale } from '@/lib/locale';
import { MOTIONS, motionById } from '@/motion/catalog';
import { resolveParams } from '@/motion/params';
import type { MotionCategory, MotionMeta, MotionParams, ParamSpec } from '@/motion/types';

/**
 * Motions from the library on a client's menu (spec: docs/superpowers/specs/2026-10-18-menu-motions-design.md): the
 * places that take one, which motions each offers, and what a placement holds once cleaned. Pure, so the Studio, the
 * publish and the guest pages clean a placement the same way. It reads the catalog and the params (plain data), never
 * `@/motion` itself, which carries the client component.
 */

/** The top of the menu, behind the signature dish, and over a category's heading. */
export const MOTION_PLACES = ['hero', 'signature', 'category'] as const;
export type MotionPlace = (typeof MOTION_PLACES)[number];

/**
 * The groups whose motions are pictures. The others (scroll, interactive, micro-interactions, transitions) draw
 * stand-in menu rows, cards, buttons and pages that guests would take for the real ones.
 */
export const PLACEABLE_CATEGORIES: readonly MotionCategory[] = ['three-d', 'luxury', 'food', 'background', 'type', 'effects'];

const PLACEABLE = MOTIONS.filter((motion) => PLACEABLE_CATEGORIES.includes(motion.category));
const PLACEABLE_IDS = new Set(PLACEABLE.map((motion) => motion.id));

/** The motions a place offers, in the library's order. The same for every place in this release. */
export function placeMotions(place: MotionPlace): MotionMeta[] {
  void place;
  return [...PLACEABLE];
}

export function isOffered(place: MotionPlace, motionId: string): boolean {
  void place;
  return PLACEABLE_IDS.has(motionId);
}

export function isMotionPlace(value: unknown): value is MotionPlace {
  return typeof value === 'string' && (MOTION_PLACES as readonly string[]).includes(value);
}

/** The key that makes a place unique on its menu: `hero`, `signature`, or `category:<categoryId>`. */
export function slotOf(place: MotionPlace, categoryId?: string | null): string {
  if (place === 'category') {
    if (!categoryId) throw new Error('A category place needs its category');
    return `category:${categoryId}`;
  }
  if (categoryId) throw new Error(`The ${place} place has no category`);
  return place;
}

/** For each text parameter, its text in each language of the menu. */
export type MotionTexts = Record<string, Partial<Record<Locale, string>>>;

/** A placement as the snapshot holds it: params resolved without the text ones, texts per language. */
export interface SnapshotMotion {
  place: MotionPlace;
  /** The category whose heading it plays over; category places only. */
  categoryId?: string;
  motionId: string;
  params: MotionParams;
  texts: MotionTexts;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type TextSpec = Extract<ParamSpec, { type: 'text' }>;

function textSpecs(meta: MotionMeta): Array<[string, TextSpec]> {
  return Object.entries(meta.params).filter((entry): entry is [string, TextSpec] => entry[1].type === 'text');
}

/** A motion's params with the text ones left out: those are written per language, in `texts`. */
function withoutText(meta: MotionMeta, params: MotionParams): MotionParams {
  const out = { ...params };
  for (const [key] of textSpecs(meta)) delete out[key];
  return out;
}

function cleanTexts(meta: MotionMeta, raw: unknown, locales: readonly Locale[]): MotionTexts {
  const texts: MotionTexts = {};
  if (!isRecord(raw)) return texts;
  for (const [key, spec] of textSpecs(meta)) {
    const byLocale = raw[key];
    if (!isRecord(byLocale)) continue;
    const kept: Partial<Record<Locale, string>> = {};
    for (const locale of locales) {
      const value = byLocale[locale];
      if (typeof value !== 'string') continue;
      const text = Array.from(value.trim()).slice(0, spec.maxLength).join('');
      if (text !== '') kept[locale] = text;
    }
    if (Object.keys(kept).length > 0) texts[key] = kept;
  }
  return texts;
}

/**
 * A placement as it may be stored and shown, or null when it cannot be: an unknown place, a motion the place does not
 * offer, a category place without one of the menu's categories (or another place with one). Params are resolved
 * (`resolveParams`) without the text ones; texts keep the motion's text params and the menu's languages, trimmed to the
 * param's length, empty ones dropped. The input is untrusted (a form, a stored snapshot).
 */
export function cleanMotion(raw: unknown, ctx: { locales: readonly Locale[]; categoryIds: ReadonlySet<string> }): SnapshotMotion | null {
  if (!isRecord(raw) || !isMotionPlace(raw.place) || typeof raw.motionId !== 'string') return null;
  const { place, motionId } = raw;
  const categoryId = raw.categoryId ?? undefined;
  if (categoryId !== undefined && typeof categoryId !== 'string') return null;
  if (place === 'category' ? !categoryId || !ctx.categoryIds.has(categoryId) : categoryId !== undefined) return null;
  const meta = motionById(motionId);
  if (!meta || !isOffered(place, motionId)) return null;
  const given = isRecord(raw.params) ? (raw.params as Partial<MotionParams>) : {};
  return {
    place,
    ...(place === 'category' ? { categoryId } : {}),
    motionId,
    params: withoutText(meta, resolveParams(meta, given)),
    texts: cleanTexts(meta, raw.texts, ctx.locales),
  };
}

/**
 * The params a guest's page draws: the placement's, resolved again, with each text in the guest's language, else the
 * menu's default one, else the brand's logo text (the name guests see), so no guest reads the library's sample words.
 */
export function guestParams(motion: SnapshotMotion, locale: Locale, defaultLocale: Locale, logoText: string): MotionParams {
  const meta = motionById(motion.motionId);
  if (!meta) return {};
  const given: Partial<MotionParams> = { ...motion.params };
  for (const [key] of textSpecs(meta)) {
    const byLocale = motion.texts[key] ?? {};
    given[key] = byLocale[locale] || byLocale[defaultLocale] || logoText;
  }
  return resolveParams(meta, given);
}

/** The params a motion starts with when a designer picks it: the defaults, its background on the page's colour. */
export function startingParams(meta: MotionMeta, pageBackground: string): MotionParams {
  const given: Partial<MotionParams> = meta.params.background?.type === 'color' ? { background: pageBackground } : {};
  return withoutText(meta, resolveParams(meta, given));
}

/** The texts a motion starts with: the logo text in every language for a text that stands for the brand, else none. */
export function startingTexts(meta: MotionMeta, locales: readonly Locale[], logoText: string): MotionTexts {
  const texts: MotionTexts = {};
  for (const [key, spec] of textSpecs(meta)) {
    if (spec.sample !== 'brand') continue;
    const text = Array.from(logoText.trim()).slice(0, spec.maxLength).join('');
    if (text !== '') texts[key] = Object.fromEntries(locales.map((locale) => [locale, text]));
  }
  return texts;
}
