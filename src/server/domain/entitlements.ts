import { LOCALES, type Locale } from '@/lib/locale';

/**
 * What a restaurant has bought (spec: plans and entitlements), as pure data and functions: the features a plan can
 * include, the three plans and what each holds, a restaurant's extras, and the one resolver every check asks. Plans sell
 * quality, never quantity: there are switches only, no limits. Permissions say what a person may do; this says what the
 * restaurant has, and the two never mix.
 */

export const PLAN_TIERS = ['BASIC', 'PRO', 'PREMIUM'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export type FeatureArea = 'design' | 'immersive' | 'publishing' | 'selling';

export interface FeatureDef {
  key: string;
  area: FeatureArea;
  /** `live`: built and checked; `reserved`: named now for the project that will build it (its switch does nothing yet). */
  status: 'live' | 'reserved';
  /** The roadmap project that builds it (1 for what exists today). */
  project: 1 | 2 | 3 | 4 | 5 | 6;
  /** The lowest plan that includes it by default; every plan above includes it too. */
  startsIn: PlanTier;
}

/** Every feature a plan can include, the live ones first, in the order the Studio lists them. */
export const FEATURES = [
  { key: 'design.fontPairs', area: 'design', status: 'live', project: 1, startsIn: 'PRO' },
  { key: 'design.railStyles', area: 'design', status: 'live', project: 1, startsIn: 'PRO' },
  { key: 'design.expressiveMotion', area: 'design', status: 'live', project: 1, startsIn: 'PRO' },
  { key: 'qr.branded', area: 'design', status: 'live', project: 1, startsIn: 'PRO' },
  { key: 'publish.scheduling', area: 'publishing', status: 'live', project: 1, startsIn: 'PRO' },
  { key: 'selling.smart', area: 'selling', status: 'live', project: 1, startsIn: 'PRO' },
  { key: 'immersive.explore', area: 'immersive', status: 'live', project: 1, startsIn: 'PREMIUM' },
  { key: 'immersive.stage', area: 'immersive', status: 'live', project: 1, startsIn: 'PREMIUM' },
  // Motions from the library at places on the menu (docs/superpowers/specs/2026-10-18-menu-motions-design.md).
  { key: 'design.menuMotions', area: 'design', status: 'live', project: 2, startsIn: 'PRO' },
  // A template menu's own background file, by kind (docs/superpowers/specs/2026-10-18-scene-files-plans-design.md).
  { key: 'design.backgroundAnimation', area: 'design', status: 'live', project: 2, startsIn: 'PRO' },
  { key: 'design.backgroundVideo', area: 'design', status: 'live', project: 2, startsIn: 'PREMIUM' },
  { key: 'immersive.models3d', area: 'immersive', status: 'live', project: 2, startsIn: 'PREMIUM' },
  { key: 'design.premiumTemplates', area: 'design', status: 'reserved', project: 2, startsIn: 'PRO' },
  { key: 'design.backgroundImage', area: 'design', status: 'reserved', project: 2, startsIn: 'PRO' },
  { key: 'design.motionPresets', area: 'design', status: 'reserved', project: 2, startsIn: 'PRO' },
  { key: 'guest.moodPicker', area: 'selling', status: 'reserved', project: 3, startsIn: 'PRO' },
  { key: 'guest.livingPhotos', area: 'immersive', status: 'reserved', project: 3, startsIn: 'PREMIUM' },
  { key: 'guest.stories', area: 'selling', status: 'reserved', project: 3, startsIn: 'PRO' },
  { key: 'guest.occasionMoods', area: 'design', status: 'reserved', project: 3, startsIn: 'PRO' },
  { key: 'guest.drinkMatch', area: 'selling', status: 'reserved', project: 3, startsIn: 'PRO' },
  { key: 'immersive.ar', area: 'immersive', status: 'reserved', project: 4, startsIn: 'PREMIUM' },
  { key: 'ordering.tableBasket', area: 'selling', status: 'reserved', project: 5, startsIn: 'PREMIUM' },
  { key: 'table.callWaiter', area: 'selling', status: 'reserved', project: 6, startsIn: 'PRO' },
  { key: 'loyalty.stampCard', area: 'selling', status: 'reserved', project: 6, startsIn: 'PRO' },
  { key: 'share.dishCards', area: 'selling', status: 'reserved', project: 6, startsIn: 'PRO' },
  { key: 'display.tvBoard', area: 'immersive', status: 'reserved', project: 6, startsIn: 'PREMIUM' },
  { key: 'selling.limitedDrops', area: 'selling', status: 'reserved', project: 6, startsIn: 'PRO' },
  { key: 'design.seasonalParticles', area: 'design', status: 'reserved', project: 6, startsIn: 'PRO' },
  { key: 'contact.whatsapp', area: 'selling', status: 'reserved', project: 6, startsIn: 'BASIC' },
] as const satisfies readonly FeatureDef[];

export type FeatureKey = (typeof FEATURES)[number]['key'];

export const FEATURE_KEYS: readonly FeatureKey[] = FEATURES.map((feature) => feature.key);

const KNOWN = new Set<string>(FEATURE_KEYS);

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && KNOWN.has(value);
}

/** The plans' names until the platform owner renames them. The Sorani names are machine-drafted. */
export const DEFAULT_PLAN_NAMES: Readonly<Record<PlanTier, Record<Locale, string>>> = {
  BASIC: { en: 'Basic', ar: 'الأساسية', ckb: 'بنەڕەتی' },
  PRO: { en: 'Pro', ar: 'الاحترافية', ckb: 'پرۆ' },
  PREMIUM: { en: 'Premium', ar: 'المميزة', ckb: 'پریمیەم' },
};

/** The longest plan name, in characters. */
export const PLAN_NAME_MAX = 40;

/** What each plan is called and holds. */
export interface Plans {
  names: Record<PlanTier, Record<Locale, string>>;
  features: Record<PlanTier, ReadonlySet<FeatureKey>>;
}

const rank = (tier: PlanTier) => PLAN_TIERS.indexOf(tier);

/** Whether a feature is in a plan by default: in the plan it starts in and every plan above. */
const inByDefault = (feature: FeatureDef, tier: PlanTier) => rank(tier) >= rank(feature.startsIn);

/** The plans as the catalog defines them, before the platform owner changes anything. */
export function defaultPlans(): Plans {
  return parsePlans({});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A stored name, trimmed, if it is 1 to 40 characters; otherwise undefined. */
function nameOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name.length >= 1 && [...name].length <= PLAN_NAME_MAX ? name : undefined;
}

/**
 * Reads the stored plans (`{ [tier]: { names?: { [locale]: string }, features?: { [key]: boolean } } }`). The JSON is
 * untrusted: unknown tiers, keys and locales are dropped, a value that is not `true` or `false` is ignored, and a name
 * that is not 1 to 40 characters keeps the default. What a tier does not say takes the catalog's default, so a feature
 * added later starts where the catalog puts it.
 */
export function parsePlans(json: unknown): Plans {
  const stored = isRecord(json) ? json : {};
  const names = {} as Record<PlanTier, Record<Locale, string>>;
  const features = {} as Record<PlanTier, ReadonlySet<FeatureKey>>;
  for (const tier of PLAN_TIERS) {
    const entry = isRecord(stored[tier]) ? stored[tier] : {};
    const storedNames = isRecord(entry.names) ? entry.names : {};
    names[tier] = Object.fromEntries(LOCALES.map((locale) => [locale, nameOf(storedNames[locale]) ?? DEFAULT_PLAN_NAMES[tier][locale]])) as Record<Locale, string>;
    const storedFeatures = isRecord(entry.features) ? entry.features : {};
    const set = new Set<FeatureKey>();
    for (const feature of FEATURES) {
      const value = storedFeatures[feature.key];
      if (typeof value === 'boolean' ? value : inByDefault(feature, tier)) set.add(feature.key);
    }
    features[tier] = set;
  }
  return { names, features };
}

/** The plans as they are stored: every tier with every name and every feature written out. */
export function plansToStore(plans: Plans): Record<PlanTier, { names: Record<Locale, string>; features: Record<FeatureKey, boolean> }> {
  return Object.fromEntries(
    PLAN_TIERS.map((tier) => [
      tier,
      {
        names: { ...plans.names[tier] },
        features: Object.fromEntries(FEATURE_KEYS.map((key) => [key, plans.features[tier].has(key)])) as Record<FeatureKey, boolean>,
      },
    ]),
  ) as Record<PlanTier, { names: Record<Locale, string>; features: Record<FeatureKey, boolean> }>;
}

/** What one restaurant has on or off beyond its plan. A key it does not hold is as the plan says. */
export type PlanExtras = Partial<Record<FeatureKey, boolean>>;

/** Reads `Restaurant.planExtras` (`{ features?: { [key]: boolean } }`); unknown keys and non-booleans are dropped. */
export function parseExtras(json: unknown): PlanExtras {
  const features = isRecord(json) && isRecord(json.features) ? json.features : {};
  const extras: PlanExtras = {};
  for (const key of FEATURE_KEYS) {
    const value = features[key];
    if (typeof value === 'boolean') extras[key] = value;
  }
  return extras;
}

/** The extras as `Restaurant.planExtras` stores them. */
export function extrasToStore(extras: PlanExtras): { features: Record<string, boolean> } {
  return { features: Object.fromEntries(FEATURE_KEYS.filter((key) => extras[key] !== undefined).map((key) => [key, extras[key]!])) };
}

/** What a restaurant has: its plan, and every feature it may use. */
export interface Entitlements {
  plan: PlanTier;
  features: ReadonlySet<FeatureKey>;
}

/** A restaurant's features: its plan's, with its extras laid over them (an extra wins over the plan). */
export function effectiveEntitlements(args: { plan: PlanTier; plans: Plans; extras: PlanExtras }): Entitlements {
  const features = new Set<FeatureKey>(args.plans.features[args.plan]);
  for (const key of FEATURE_KEYS) {
    const extra = args.extras[key];
    if (extra === true) features.add(key);
    if (extra === false) features.delete(key);
  }
  return { plan: args.plan, features };
}

/** Whether the restaurant may use `key`. */
export function allows(entitlements: Entitlements, key: FeatureKey): boolean {
  return entitlements.features.has(key);
}

/** The lowest plan that includes `key`, for "Part of Pro"; null when no plan does. */
export function lowestPlanWith(plans: Plans, key: FeatureKey): PlanTier | null {
  return PLAN_TIERS.find((tier) => plans.features[tier].has(key)) ?? null;
}

/** The live features `after` lacks that `before` had, in catalog order: what guests stop seeing on a change of plan. */
export function featuresLost(before: Entitlements, after: Entitlements): FeatureKey[] {
  return FEATURES.filter((feature) => feature.status === 'live' && before.features.has(feature.key) && !after.features.has(feature.key)).map(
    (feature) => feature.key,
  );
}
