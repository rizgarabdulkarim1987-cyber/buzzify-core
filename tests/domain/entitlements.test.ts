import { describe, expect, it } from 'vitest';
import {
  allows,
  defaultPlans,
  effectiveEntitlements,
  extrasToStore,
  FEATURE_KEYS,
  FEATURES,
  featuresLost,
  isFeatureKey,
  lowestPlanWith,
  parseExtras,
  parsePlans,
  PLAN_TIERS,
  plansToStore,
  type PlanTier,
} from '@/server/domain/entitlements';

const live = (tier: PlanTier) =>
  [...defaultPlans().features[tier]].filter((key) => FEATURES.find((feature) => feature.key === key)!.status === 'live');

describe('the feature catalog', () => {
  it('lists the fifteen live features first, in the specs’ order', () => {
    expect(FEATURE_KEYS.slice(0, 15)).toEqual([
      'design.fontPairs',
      'design.railStyles',
      'design.expressiveMotion',
      'qr.branded',
      'publish.scheduling',
      'selling.smart',
      'selling.offers',
      'selling.socialProof',
      'selling.insights',
      'immersive.explore',
      'immersive.stage',
      'design.menuMotions',
      'design.backgroundAnimation',
      'design.backgroundVideo',
      'immersive.models3d',
    ]);
    expect(FEATURES.filter((feature) => feature.status === 'live')).toHaveLength(15);
    expect(FEATURES.filter((feature) => feature.status === 'reserved')).toHaveLength(17);
  });

  it('knows its own keys and nothing else', () => {
    expect(isFeatureKey('qr.branded')).toBe(true);
    expect(isFeatureKey('made.up')).toBe(false);
    expect(isFeatureKey(42)).toBe(false);
  });

  it('starts each live feature where the spec says', () => {
    expect(live('BASIC')).toEqual([]);
    expect(live('PRO')).toEqual([
      'design.fontPairs',
      'design.railStyles',
      'design.expressiveMotion',
      'qr.branded',
      'publish.scheduling',
      'selling.smart',
      'selling.offers',
      'selling.socialProof',
      'selling.insights',
      'design.menuMotions',
      'design.backgroundAnimation',
    ]);
    expect(live('PREMIUM')).toHaveLength(15);
  });

  it('starts the scene files where the spec says: Lottie in Pro, video and models in Premium', () => {
    const plans = defaultPlans();
    expect(plans.features.BASIC.has('design.backgroundAnimation')).toBe(false);
    expect(plans.features.PRO.has('design.backgroundAnimation')).toBe(true);
    expect(plans.features.PREMIUM.has('design.backgroundAnimation')).toBe(true);
    expect(plans.features.PRO.has('immersive.models3d')).toBe(false);
    expect(plans.features.PREMIUM.has('immersive.models3d')).toBe(true);
  });

  it('starts each reserved feature in its plan and every plan above', () => {
    const plans = defaultPlans();
    expect(plans.features.BASIC.has('contact.whatsapp')).toBe(true);
    expect(plans.features.PRO.has('contact.whatsapp')).toBe(true);
    expect(plans.features.BASIC.has('guest.stories')).toBe(false);
    expect(plans.features.PRO.has('guest.stories')).toBe(true);
    expect(plans.features.PRO.has('design.backgroundVideo')).toBe(false);
    expect(plans.features.PREMIUM.has('design.backgroundVideo')).toBe(true);
  });

  it('names the plans in three languages by default', () => {
    expect(defaultPlans().names).toEqual({
      BASIC: { en: 'Basic', ar: 'الأساسية', ckb: 'بنەڕەتی' },
      PRO: { en: 'Pro', ar: 'الاحترافية', ckb: 'پرۆ' },
      PREMIUM: { en: 'Premium', ar: 'المميزة', ckb: 'پریمیەم' },
    });
    expect(PLAN_TIERS).toEqual(['BASIC', 'PRO', 'PREMIUM']);
  });
});

describe('stored plans', () => {
  it('reads stored plan contents over the defaults and ignores what does not fit', () => {
    const plans = parsePlans({
      BASIC: { features: { 'immersive.explore': true, 'made.up': true, 'design.fontPairs': 'yes' }, names: { en: ' Starter ', ar: '', ckb: 'x'.repeat(41) } },
      GOLD: { features: { 'qr.branded': true } },
      PRO: 'nonsense',
    });
    expect(plans.features.BASIC.has('immersive.explore')).toBe(true);
    expect(plans.features.BASIC.has('design.fontPairs')).toBe(false);
    expect(plans.names.BASIC).toEqual({ en: 'Starter', ar: 'الأساسية', ckb: 'بنەڕەتی' });
    expect(plans.features.PRO).toEqual(defaultPlans().features.PRO);
  });

  it('reads anything that is not an object as the defaults', () => {
    for (const json of [null, undefined, 'x', 3, []]) expect(parsePlans(json)).toEqual(defaultPlans());
  });

  it('round-trips plans and extras through what is stored', () => {
    const plans = parsePlans({ PRO: { features: { 'immersive.stage': true }, names: { en: 'Plus' } } });
    expect(parsePlans(plansToStore(plans))).toEqual(plans);
    const extras = parseExtras({ features: { 'immersive.explore': true, 'qr.branded': false } });
    expect(parseExtras(extrasToStore(extras))).toEqual(extras);
    expect(extrasToStore(extras)).toEqual({ features: { 'immersive.explore': true, 'qr.branded': false } });
  });

  it('reads extras with unknown keys and non-booleans left out', () => {
    expect(parseExtras({ features: { 'qr.branded': true, 'made.up': true, 'immersive.stage': 1 } })).toEqual({ 'qr.branded': true });
    expect(parseExtras('x')).toEqual({});
    expect(parseExtras({ features: [] })).toEqual({});
  });
});

describe('a restaurant’s entitlements', () => {
  it('follows the plan', () => {
    const basic = effectiveEntitlements({ plan: 'BASIC', plans: defaultPlans(), extras: {} });
    expect(basic.plan).toBe('BASIC');
    expect(allows(basic, 'qr.branded')).toBe(false);
    expect(allows(basic, 'contact.whatsapp')).toBe(true);
  });

  it('lets an extra switch a feature on or off beyond the plan', () => {
    const on = effectiveEntitlements({ plan: 'BASIC', plans: defaultPlans(), extras: parseExtras({ features: { 'immersive.stage': true } }) });
    expect(allows(on, 'immersive.stage')).toBe(true);
    const off = effectiveEntitlements({ plan: 'PREMIUM', plans: defaultPlans(), extras: { 'immersive.explore': false } });
    expect(allows(off, 'immersive.explore')).toBe(false);
    expect(allows(off, 'immersive.stage')).toBe(true);
  });

  it('names the lowest plan with a feature, or null', () => {
    const plans = defaultPlans();
    expect(lowestPlanWith(plans, 'qr.branded')).toBe('PRO');
    expect(lowestPlanWith(plans, 'immersive.explore')).toBe('PREMIUM');
    expect(lowestPlanWith(plans, 'contact.whatsapp')).toBe('BASIC');
    const none = parsePlans({ PREMIUM: { features: { 'immersive.explore': false } } });
    expect(lowestPlanWith(none, 'immersive.explore')).toBeNull();
  });

  it('lists the live features a change of plan takes away, in catalog order', () => {
    const premium = effectiveEntitlements({ plan: 'PREMIUM', plans: defaultPlans(), extras: {} });
    const basic = effectiveEntitlements({ plan: 'BASIC', plans: defaultPlans(), extras: {} });
    expect(featuresLost(premium, basic)).toEqual(FEATURE_KEYS.slice(0, 15));
    expect(featuresLost(basic, premium)).toEqual([]);
  });
});
