import { DEFAULT_FONT_PAIR, FONT_PAIR_IDS, type FontPairId } from '@/lib/font-pairs';
import { parseMedia } from '@/lib/media';
import { RAIL_STYLES, type RailStyle } from '@/lib/rail';
import { stageTone } from '@/lib/stage';
import { motionPresetFeature, type MotionPresetId } from '@/lib/templates/motion-presets';
import { isPremiumTemplate } from '@/lib/templates/premium';
import { TEMPLATES } from '@/lib/templates';
import type { SceneMedia, TemplateId } from '@/lib/templates/types';
import type { BrandView } from '@/server/data/tenant';
import { allows, type Entitlements, type FeatureKey } from './entitlements';
import { DEFAULT_QR_STYLE, type QrStyle } from './qr';
import type { Catalog } from './types';

/**
 * Choices a plan can lock (spec: plans and entitlements, section 6): which font pairs, rails, motion levels and QR looks
 * a restaurant may choose, what guests see instead of a choice its plan no longer includes, and when a save is choosing
 * something locked. A locked choice may be kept, never newly made: nothing stored is rewritten, so moving back up a plan
 * brings every choice back.
 */

export type Motion = 'none' | 'subtle' | 'expressive';

export interface BrandChoices {
  fontPairId: FontPairId;
  railStyle: RailStyle;
  motionIntensity: Motion;
}

/** The font pairs every plan has. */
export const BASIC_FONT_PAIRS: readonly FontPairId[] = ['classic', 'modern'];

const MOTIONS: readonly Motion[] = ['none', 'subtle', 'expressive'];

/** The feature a rail style needs; the plain rail needs none. */
export function railFeature(style: RailStyle): FeatureKey | null {
  if (style === 'plain') return null;
  return style === 'grains' ? 'immersive.stage' : 'design.railStyles';
}

export function allowedFontPairs(entitlements: Entitlements): FontPairId[] {
  return allows(entitlements, 'design.fontPairs') ? [...FONT_PAIR_IDS] : FONT_PAIR_IDS.filter((id) => BASIC_FONT_PAIRS.includes(id));
}

/** The rails the plan allows, in `RAIL_STYLES` order. */
export function allowedRails(entitlements: Entitlements): RailStyle[] {
  return RAIL_STYLES.filter((style) => {
    const feature = railFeature(style);
    return feature === null || allows(entitlements, feature);
  });
}

export function allowedMotions(entitlements: Entitlements): Motion[] {
  return MOTIONS.filter((level) => level !== 'expressive' || allows(entitlements, 'design.expressiveMotion'));
}

/** The rail a new menu starts with: the melting dish, else the deck, else the plain rail. */
export function bestRail(entitlements: Entitlements): RailStyle {
  const rails = allowedRails(entitlements);
  return rails.includes('grains') ? 'grains' : rails.includes('deck') ? 'deck' : 'plain';
}

export function guestFontPair(id: FontPairId, entitlements: Entitlements): FontPairId {
  return allowedFontPairs(entitlements).includes(id) ? id : DEFAULT_FONT_PAIR;
}

/** The rail guests see: the chosen one, else the deck when the animated rails are allowed, else the plain rail. */
export function guestRail(style: RailStyle, entitlements: Entitlements): RailStyle {
  if (allowedRails(entitlements).includes(style)) return style;
  return allows(entitlements, 'design.railStyles') ? 'deck' : 'plain';
}

export function guestMotion(level: Motion, entitlements: Entitlements): Motion {
  return allowedMotions(entitlements).includes(level) ? level : 'subtle';
}

/** Whether a QR style uses anything beyond black on white: other colours, or the logo. Frame text is for every plan. */
export function isBrandedQr(style: QrStyle): boolean {
  return (
    style.foreground.toUpperCase() !== DEFAULT_QR_STYLE.foreground ||
    style.background.toUpperCase() !== DEFAULT_QR_STYLE.background ||
    style.logo
  );
}

/** A template menu's own background file, by kind (spec: scene files and plans). */
export type SceneFileKind = SceneMedia['kind'];

const SCENE_FEATURES: Readonly<Record<SceneFileKind, FeatureKey>> = {
  model: 'immersive.models3d',
  video: 'design.backgroundVideo',
  lottie: 'design.backgroundAnimation',
  image: 'design.backgroundImage',
};

/** The feature a background file of this kind needs. */
export function sceneFeature(kind: SceneFileKind): FeatureKey {
  return SCENE_FEATURES[kind];
}

/** The kinds of background file the plan allows: model, video, Lottie. */
export function allowedSceneKinds(entitlements: Entitlements): SceneFileKind[] {
  return (['model', 'video', 'lottie', 'image'] as const).filter((kind) => allows(entitlements, sceneFeature(kind)));
}

/**
 * The feature a save would need for choosing a new background file the plan locks, or null. The file already stored
 * is kept, whatever the plan; choosing none needs nothing.
 */
export function sceneChoiceLock(
  next: { assetId: string; kind: SceneFileKind } | null,
  storedAssetId: string | null,
  entitlements: Entitlements,
): FeatureKey | null {
  if (next === null || next.assetId === storedAssetId) return null;
  return allows(entitlements, sceneFeature(next.kind)) ? null : sceneFeature(next.kind);
}

/**
 * `design.premiumTemplates` when a save would newly choose a premium template the plan lacks, or null. The template a
 * menu already has is kept, whatever the plan (spec 2026-10-31, 3.3).
 */
export function premiumTemplateLock(next: TemplateId | null, stored: TemplateId | null, entitlements: Entitlements): FeatureKey | null {
  if (next === null || next === stored || !isPremiumTemplate(next)) return null;
  return allows(entitlements, 'design.premiumTemplates') ? null : 'design.premiumTemplates';
}

/** The feature a save needs for newly choosing a motion preset the plan lacks, or null. A stored preset is kept. */
export function motionPresetLock(next: MotionPresetId | undefined, stored: MotionPresetId | undefined, entitlements: Entitlements): FeatureKey | null {
  if (next === undefined || next === stored) return null;
  const feature = motionPresetFeature(next);
  return feature === null || allows(entitlements, feature) ? null : feature;
}

/** Whether a stored preset is one guests on this plan do not get. */
function presetHidden(preset: MotionPresetId | undefined, entitlements: Entitlements): boolean {
  return preset !== undefined && motionPresetLock(preset, undefined, entitlements) !== null;
}

/** The style a code is drawn in: as chosen, or black on white without the logo on a plan without branded codes. */
export function guestQrStyle(style: QrStyle, entitlements: Entitlements): QrStyle {
  if (allows(entitlements, 'qr.branded') || !isBrandedQr(style)) return style;
  return { ...style, foreground: DEFAULT_QR_STYLE.foreground, background: DEFAULT_QR_STYLE.background, logo: false };
}

/**
 * The brand kit as guests on this plan get it: motion first, then the rail (plain when motion is off, as
 * `resolveRailStyle` has it), then the font pair (left out when it is the classic one), then the template's background
 * file (left out when the plan lacks its kind, so the template's own scene plays). The view given is not changed.
 */
export function clampBrandView(view: BrandView, entitlements: Entitlements): BrandView {
  const motionIntensity = guestMotion(view.motionIntensity, entitlements);
  const railStyle = motionIntensity === 'none' ? 'plain' : guestRail(view.railStyle, entitlements);
  const fontPairId = guestFontPair(view.fontPairId ?? DEFAULT_FONT_PAIR, entitlements);
  const clamped: BrandView = { ...view, motionIntensity, railStyle };
  if (fontPairId === DEFAULT_FONT_PAIR) delete clamped.fontPairId;
  else clamped.fontPairId = fontPairId;
  const media = view.design?.media;
  if (view.design && media && !allows(entitlements, sceneFeature(media.kind))) {
    clamped.design = { ...view.design };
    delete clamped.design.media;
  }
  // A motion preset the plan lacks: the template's own motion plays, under the business's hand-set sliders.
  const stored = view.design?.source.overrides;
  const template = view.design ? TEMPLATES[view.design.templateId] : undefined;
  if (view.design && template && presetHidden(stored?.motionPreset, entitlements)) {
    clamped.design = { ...(clamped.design ?? view.design), scene: { ...template.scene, ...stored?.scene } };
  }
  return clamped;
}

/** Choices brought within the plan, for a menu copied into a restaurant on it. */
export function clampBrandChoices(choices: BrandChoices, entitlements: Entitlements): BrandChoices {
  return {
    fontPairId: guestFontPair(choices.fontPairId, entitlements),
    railStyle: guestRail(choices.railStyle, entitlements),
    motionIntensity: guestMotion(choices.motionIntensity, entitlements),
  };
}

/**
 * The feature a save would need for choosing something new that the plan locks, or null. A choice equal to the stored
 * one is kept, whatever the plan.
 */
export function brandChoiceLock(next: BrandChoices, stored: BrandChoices, entitlements: Entitlements): FeatureKey | null {
  if (next.fontPairId !== stored.fontPairId && !allowedFontPairs(entitlements).includes(next.fontPairId)) return 'design.fontPairs';
  if (next.railStyle !== stored.railStyle && !allowedRails(entitlements).includes(next.railStyle)) return railFeature(next.railStyle);
  if (next.motionIntensity !== stored.motionIntensity && !allowedMotions(entitlements).includes(next.motionIntensity)) {
    return 'design.expressiveMotion';
  }
  return null;
}

/** `qr.branded` when a save gives a code brand colours or the logo it did not have on a plan without them; else null. */
export function qrStyleLock(next: QrStyle, stored: QrStyle, entitlements: Entitlements): 'qr.branded' | null {
  if (allows(entitlements, 'qr.branded') || !isBrandedQr(next)) return null;
  const kept =
    next.foreground.toUpperCase() === stored.foreground.toUpperCase() &&
    next.background.toUpperCase() === stored.background.toUpperCase() &&
    next.logo === stored.logo;
  return kept ? null : 'qr.branded';
}

/** The features whose stored choice guests do not see on this plan, in the order the Brand tab lists them. */
export function hiddenChoices(stored: BrandChoices, entitlements: Entitlements): FeatureKey[] {
  const hidden: FeatureKey[] = [];
  if (guestFontPair(stored.fontPairId, entitlements) !== stored.fontPairId) hidden.push('design.fontPairs');
  const rail = railFeature(stored.railStyle);
  if (rail !== null && guestRail(stored.railStyle, entitlements) !== stored.railStyle) hidden.push(rail);
  if (guestMotion(stored.motionIntensity, entitlements) !== stored.motionIntensity) hidden.push('design.expressiveMotion');
  return hidden;
}

/**
 * What a menu would show guests that this plan leaves out, in the order the Preview tab lists it: the brand's choices
 * guests do not see, the template's background file, then Explore, the 3D stage when a product has a stage, smart
 * selling when the menu has offers, pairings or bundles.
 */
export function hiddenFromGuests(
  brand: BrandView,
  catalog: {
    products: ReadonlyArray<{
      media: unknown[];
      groups: ReadonlyArray<{ options: ReadonlyArray<{ isSuggested: boolean }> }>;
      variants: ReadonlyArray<{ priceDelta: number }>;
    }>;
    upsellRules: readonly unknown[];
    pairingRules: readonly unknown[];
    bundles: readonly unknown[];
    promotions?: readonly unknown[];
  },
  entitlements: Entitlements,
): FeatureKey[] {
  const stored = { fontPairId: brand.fontPairId ?? DEFAULT_FONT_PAIR, railStyle: brand.railStyle, motionIntensity: brand.motionIntensity };
  const hidden = hiddenChoices(stored, entitlements);
  const media = brand.design?.media;
  if (media && !allows(entitlements, sceneFeature(media.kind))) hidden.push(sceneFeature(media.kind));
  if (presetHidden(brand.design?.source.overrides.motionPreset, entitlements)) hidden.push('design.motionPresets');
  if (!allows(entitlements, 'immersive.explore')) hidden.push('immersive.explore');
  if (!allows(entitlements, 'immersive.stage') && catalog.products.some((product) => stageTone(parseMedia(product.media)) !== null)) {
    hidden.push('immersive.stage');
  }
  // Upgrades come from rules, suggested options and bigger sizes; pairings and sets from their rules.
  const upgradable = catalog.products.some(
    (product) =>
      product.groups.some((group) => group.options.some((option) => option.isSuggested)) ||
      new Set(product.variants.map((variant) => variant.priceDelta)).size > 1,
  );
  const selling = upgradable || catalog.upsellRules.length + catalog.pairingRules.length + catalog.bundles.length > 0;
  if (!allows(entitlements, 'selling.smart') && selling) hidden.push('selling.smart');
  if (!allows(entitlements, 'selling.offers') && (catalog.promotions?.length ?? 0) > 0) hidden.push('selling.offers');
  return hidden;
}

/**
 * The catalog as the restaurant's plan serves it to guests. Without smart selling there are no upgrades, pairings or
 * sets: suggestions are empty, and a set already in a cart is priced as one that is no longer offered. Without timed
 * offers there are no specials or discounts, so every price is the regular one. The public pages and the Studio's
 * previews both read the catalog through this.
 */
export function servedCatalog(catalog: Catalog, features: Pick<GuestFeatures, 'smartSelling' | 'offers'>): Catalog {
  const selling = features.smartSelling ? catalog : { ...catalog, upsellRules: [], pairingRules: [], bundles: [] };
  return features.offers ? selling : { ...selling, promotions: [] };
}

/**
 * What the guest pages may show: Explore, the 3D stage, smart selling, timed offers, the labels drawn from guest data
 * and stock, and the rails `?rail=` may preview.
 */
export interface GuestFeatures {
  explore: boolean;
  stage: boolean;
  smartSelling: boolean;
  offers: boolean;
  socialProof: boolean;
  /** The plan holds the intro page, the restaurant's own page and the wheel (each also needs its menu switch). */
  intro: boolean;
  about: boolean;
  wheel: boolean;
  /** The plan holds the order and view counts on dish cards (also needs the menu's switch). */
  dishCounts: boolean;
  /** Project 3: drinks that go with a dish, the mood picker, living photos, occasion moods and stories. */
  drinkMatch: boolean;
  moodPicker: boolean;
  livingPhotos: boolean;
  occasionMoods: boolean;
  stories: boolean;
  /** Project 4: a model per dish, and putting it on the table in AR. */
  models3d: boolean;
  ar: boolean;
  /** Project 5: the guests of a table share one basket. */
  tableBasket: boolean;
  /** A guest at a table can call a waiter (`table.callWaiter`). */
  callWaiter: boolean;
  /** The menu shows a link to chat with the restaurant on WhatsApp (`contact.whatsapp`). */
  whatsapp: boolean;
  /** A guest can share a dish as a card (`share.dishCards`). */
  shareCards: boolean;
  rails: RailStyle[];
}

export function guestFeatures(entitlements: Entitlements): GuestFeatures {
  return {
    explore: allows(entitlements, 'immersive.explore'),
    stage: allows(entitlements, 'immersive.stage'),
    smartSelling: allows(entitlements, 'selling.smart'),
    offers: allows(entitlements, 'selling.offers'),
    socialProof: allows(entitlements, 'selling.socialProof'),
    intro: allows(entitlements, 'menu.intro'),
    about: allows(entitlements, 'menu.about'),
    wheel: allows(entitlements, 'menu.wheel'),
    dishCounts: allows(entitlements, 'menu.dishCounts'),
    drinkMatch: allows(entitlements, 'guest.drinkMatch'),
    moodPicker: allows(entitlements, 'guest.moodPicker'),
    livingPhotos: allows(entitlements, 'guest.livingPhotos'),
    occasionMoods: allows(entitlements, 'guest.occasionMoods'),
    stories: allows(entitlements, 'guest.stories'),
    models3d: allows(entitlements, 'immersive.models3d'),
    ar: allows(entitlements, 'immersive.ar'),
    tableBasket: allows(entitlements, 'ordering.tableBasket'),
    callWaiter: allows(entitlements, 'table.callWaiter'),
    whatsapp: allows(entitlements, 'contact.whatsapp'),
    shareCards: allows(entitlements, 'share.dishCards'),
    rails: allowedRails(entitlements),
  };
}
