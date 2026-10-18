import type { Locale } from '@/lib/locale';
import { motionById } from '@/motion/catalog';
import { cleanMotion, slotOf, startingParams, startingTexts, type SnapshotMotion } from '@/server/domain/menu-motions';
import type { TemplateId } from './types';

/**
 * The motions each template suggests (spec: docs/superpowers/specs/2026-10-18-template-motions-design.md, section 3):
 * one for the top of the menu, chosen for the preset's look, and one for each kind of category the menu holds. Pure, for
 * the design service (placing them when a template is applied) and the Studio (its preview and gallery). Not exported
 * from `./index`: it reads the motion catalog, which the guest menu's first JavaScript must not carry.
 */

/** What a category holds, as far as its motion goes. */
export type CategoryKind = 'coffee' | 'icecream' | 'dessert' | 'drinks' | 'grill';

/**
 * Words that say what a category holds, in its slug or its names in English, Arabic and Sorani, in the order they are
 * tried: iced coffee is coffee before it is a cold drink, and ice cream before it is a dessert. "ice" alone would match
 * "juice", so ice cream is only ever the whole phrase.
 */
const KIND_WORDS: ReadonlyArray<readonly [CategoryKind, readonly string[]]> = [
  ['coffee', ['coffee', 'espresso', 'cafe', 'café', 'latte', 'cappuccino', 'قهوة', 'قهوه', 'اسبريسو', 'إسبريسو', 'قاوە', 'قەهوە', 'کافی']],
  ['icecream', ['ice cream', 'icecream', 'gelato', 'sorbet', 'آيس كريم', 'ايس كريم', 'بوظة', 'جيلاتو', 'ئایس کریم', 'ئایسکریم', 'بەستەنی']],
  ['dessert', ['dessert', 'sweet', 'cake', 'patisserie', 'pastries', 'حلويات', 'حلى', 'كيك', 'شیرینی', 'کێک', 'حەلوا']],
  ['drinks', ['drink', 'juice', 'smoothie', 'lemonade', 'mocktail', 'soda', 'مشروب', 'عصير', 'عصائر', 'خواردنەوە', 'شەربەت']],
  ['grill', ['grill', 'bbq', 'barbecue', 'kebab', 'kabab', 'مشاوي', 'مشويات', 'شواء', 'کەباب', 'برژاو']],
];

/** The motion every template suggests for a kind of category. */
const KIND_MOTIONS: Record<CategoryKind, string> = {
  coffee: 'coffee-steam',
  icecream: 'ice-cream-swirl',
  dessert: 'chocolate-dripping',
  drinks: 'beverage-splash',
  grill: 'fire-simulation',
};

/** How many categories a template's suggestions reach, so a long menu does not become a wall of motion. */
export const MAX_CATEGORY_SUGGESTIONS = 3;

/**
 * Each preset's motion for the top of the menu. `tint`: its `color` takes the template's accent, for the ambient motions
 * whose colour is only a mood (a food motion keeps its own: coffee stays coffee-coloured).
 */
export const PRESET_HERO_MOTIONS: Record<TemplateId, { motionId: string; tint?: boolean }> = {
  'obsidian-gold': { motionId: 'golden-particles', tint: true },
  'ivory-marble': { motionId: 'ambient-light', tint: true },
  'emerald-palace': { motionId: 'volumetric-lighting', tint: true },
  'royal-burgundy': { motionId: 'satin-silk' },
  'kyoto-ink': { motionId: 'slow-smoke' },
  'mediterranean-riviera': { motionId: 'procedural-waves', tint: true },
  'ember-grill': { motionId: 'fire-simulation' },
  'botanical-table': { motionId: 'organic-blob', tint: true },
  'saffron-house': { motionId: 'animated-bokeh', tint: true },
  'ocean-pearl': { motionId: 'caustic-light' },
  'copper-roast': { motionId: 'coffee-beans-falling' },
  'cream-studio': { motionId: 'animated-gradient', tint: true },
  'matcha-ritual': { motionId: 'organic-blob', tint: true },
  'midnight-espresso': { motionId: 'coffee-steam' },
  'terra-cafe': { motionId: 'liquid-background' },
  'nordic-brew': { motionId: 'aurora-background' },
  'neon-noir': { motionId: 'mesh-gradient' },
  'gallery-blanc': { motionId: 'floating-geometric-shapes', tint: true },
  'paris-maison': { motionId: 'premium-logo-reveal', tint: true },
  'butter-and-fold': { motionId: 'food-levitation' },
  'rose-patisserie': { motionId: 'animated-bokeh', tint: true },
  'cocoa-atelier': { motionId: 'chocolate-dripping' },
  'artisan-crust': { motionId: 'ambient-light', tint: true },
  'pistachio-boutique': { motionId: 'organic-blob', tint: true },
  'celebration-house': { motionId: 'golden-particles', tint: true },
  'gelato-riviera': { motionId: 'ice-cream-swirl' },
  'sorbet-garden': { motionId: 'animated-gradient', tint: true },
  'vanilla-cloud': { motionId: 'soft-glow', tint: true },
  'pop-gelato': { motionId: 'floating-geometric-shapes', tint: true },
  'frozen-jewel': { motionId: 'glass-refraction', tint: true },
};

const normalize = (text: string) => text.toLocaleLowerCase().replace(/[-_]+/g, ' ');

/** What a category holds, read from its slug and its names; null when nothing says. */
export function categoryKind(category: { slug: string; names: readonly string[] }): CategoryKind | null {
  const text = normalize([category.slug, ...category.names].join(' '));
  for (const [kind, words] of KIND_WORDS) if (words.some((word) => text.includes(word))) return kind;
  return null;
}

export interface SuggestionInput {
  /** The menu's categories in its order, each with its names in every language. */
  categories: ReadonlyArray<{ id: string; slug: string; names: readonly string[] }>;
  /** The template's page colour and accent, after the business's own colour changes. */
  palette: { bg: string; accent: string };
  locales: readonly Locale[];
  /** The name guests see, for words that stand for the brand. */
  logoText: string;
}

function suggestion(
  place: 'hero' | 'category',
  motionId: string,
  input: SuggestionInput,
  options: { categoryId?: string; tint?: boolean },
): SnapshotMotion | null {
  const meta = motionById(motionId);
  if (!meta) return null;
  const params = startingParams(meta, input.palette.bg);
  if (options.tint && meta.params.color?.type === 'color') params.color = input.palette.accent;
  return cleanMotion(
    { place, ...(options.categoryId ? { categoryId: options.categoryId } : {}), motionId, params, texts: startingTexts(meta, input.locales, input.logoText) },
    { locales: input.locales, categoryIds: new Set(input.categories.map((category) => category.id)) },
  );
}

/**
 * A template's suggestions for one menu: its top-of-menu motion first, then a motion for each of the first categories
 * (up to `MAX_CATEGORY_SUGGESTIONS`) whose kind has one, in menu order. Each is cleaned like a saved placement.
 */
export function suggestedMotions(templateId: TemplateId, input: SuggestionInput): SnapshotMotion[] {
  const hero = PRESET_HERO_MOTIONS[templateId];
  const motions: SnapshotMotion[] = [];
  const top = suggestion('hero', hero.motionId, input, { tint: hero.tint });
  if (top) motions.push(top);
  for (const category of input.categories) {
    if (motions.length - (top ? 1 : 0) >= MAX_CATEGORY_SUGGESTIONS) break;
    const kind = categoryKind(category);
    const placed = kind ? suggestion('category', KIND_MOTIONS[kind], input, { categoryId: category.id }) : null;
    if (placed) motions.push(placed);
  }
  return motions;
}

/** What the Studio's preview needs to show any template with the motions applying it would give (spec section 5). */
export interface MotionSwap {
  /** The template the draft is drawn with, or null for the classic menu. */
  templateId: string | null;
  /** The designer's own motions: those no template placed. */
  owned: SnapshotMotion[];
  categories: SuggestionInput['categories'];
  locales: readonly Locale[];
  logoText: string;
  /** Whether the restaurant's plan shows guests the menu's motions at all. */
  allowed: boolean;
  /** False when the menu's motion level is off: every motion shows still. */
  playing: boolean;
}

/**
 * The motions a template would leave on the menu if it were applied now: the designer's own, then the template's
 * suggestions in the places they leave empty (none for Classic). Nothing on a plan without motions on the menu.
 */
export function previewMotions(swap: MotionSwap, templateId: TemplateId | null, palette: { bg: string; accent: string }): SnapshotMotion[] {
  if (!swap.allowed) return [];
  if (templateId === null) return [...swap.owned];
  const taken = new Set(swap.owned.map((motion) => slotOf(motion.place, motion.categoryId)));
  const suggestions = suggestedMotions(templateId, { categories: swap.categories, palette, locales: swap.locales, logoText: swap.logoText });
  return [...swap.owned, ...suggestions.filter((motion) => !taken.has(slotOf(motion.place, motion.categoryId)))];
}
