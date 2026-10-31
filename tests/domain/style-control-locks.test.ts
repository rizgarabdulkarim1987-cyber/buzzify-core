import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTES } from '@/lib/brand';
import { BUSINESS_TYPES, TEMPLATE_IDS, TEMPLATES, presetsFor } from '@/lib/templates';
import { resolveDesign } from '@/lib/templates/resolve';
import { MOTION_PRESETS } from '@/lib/templates/motion-presets';
import { isPremiumTemplate, PREMIUM_TEMPLATE_IDS } from '@/lib/templates/premium';
import type { BrandView } from '@/server/data/tenant';
import { defaultPlans, effectiveEntitlements, FEATURES, type PlanTier } from '@/server/domain/entitlements';
import { clampBrandView, hiddenFromGuests, motionPresetLock, premiumTemplateLock } from '@/server/domain/plan-choices';

const on = (plan: PlanTier) => effectiveEntitlements({ plan, plans: defaultPlans(), extras: {} });
const BASIC = on('BASIC');
const PRO = on('PRO');

const live = (key: string) => FEATURES.find((feature) => feature.key === key)?.status;

describe('project 2 features are live', () => {
  it.each(['design.premiumTemplates', 'design.backgroundImage', 'design.motionPresets'])('%s is built', (key) => {
    expect(live(key)).toBe('live');
  });
});

describe('premium templates', () => {
  it('is a fixed set of real templates', () => {
    expect(PREMIUM_TEMPLATE_IDS.length).toBeGreaterThan(0);
    for (const id of PREMIUM_TEMPLATE_IDS) expect(TEMPLATE_IDS).toContain(id);
    expect(isPremiumTemplate('obsidian-gold')).toBe(PREMIUM_TEMPLATE_IDS.includes('obsidian-gold'));
  });

  it('leaves every business type free templates on Basic', () => {
    for (const business of BUSINESS_TYPES) {
      expect(presetsFor(business).some((preset) => !isPremiumTemplate(preset.id))).toBe(true);
    }
  });

  it('keeps the first thirty presets free: they were sold before this feature', () => {
    for (const id of TEMPLATE_IDS.slice(0, 30)) expect(isPremiumTemplate(id)).toBe(false);
  });

  it('refuses a newly chosen premium template without the feature and never a kept one', () => {
    const premium = PREMIUM_TEMPLATE_IDS[0];
    const free = TEMPLATE_IDS.find((id) => !isPremiumTemplate(id))!;
    expect(premiumTemplateLock(premium, null, BASIC)).toBe('design.premiumTemplates');
    expect(premiumTemplateLock(premium, free, BASIC)).toBe('design.premiumTemplates');
    expect(premiumTemplateLock(premium, premium, BASIC)).toBeNull();
    expect(premiumTemplateLock(free, premium, BASIC)).toBeNull();
    expect(premiumTemplateLock(null, premium, BASIC)).toBeNull();
    expect(premiumTemplateLock(premium, null, PRO)).toBeNull();
  });
});

describe('motion preset locks', () => {
  it('lets every plan choose still and keeps a stored preset', () => {
    expect(motionPresetLock('still', undefined, BASIC)).toBeNull();
    expect(motionPresetLock('calm', undefined, BASIC)).toBe('design.motionPresets');
    expect(motionPresetLock('calm', 'calm', BASIC)).toBeNull();
    expect(motionPresetLock(undefined, 'calm', BASIC)).toBeNull();
    expect(motionPresetLock('showtime', 'calm', PRO)).toBeNull();
  });

  const preset = TEMPLATES['obsidian-gold'];
  const design = resolveDesign(preset, { motionPreset: 'showtime', scene: { brightness: 1.2 } }, { details: null, poweredBy: true });
  const view: BrandView = { logoText: 'Z', theme: 'dark', motionIntensity: 'subtle', railStyle: 'plain', tokens: DEFAULT_PALETTES, design };

  it('shows guests on a plan without presets the template motion, keeping their own sliders', () => {
    const clamped = clampBrandView(view, BASIC);
    expect(clamped.design?.scene.intensity).toBe(preset.scene.intensity);
    expect(clamped.design?.scene.brightness).toBe(1.2);
    expect(clampBrandView(view, PRO).design?.scene.intensity).toBe(MOTION_PRESETS.showtime.intensity);
  });

  it('does not touch a stored still, nor a design with no preset', () => {
    const still = resolveDesign(preset, { motionPreset: 'still' }, { details: null, poweredBy: true });
    expect(clampBrandView({ ...view, design: still }, BASIC).design?.scene).toEqual(still.scene);
    const none = resolveDesign(preset, {}, { details: null, poweredBy: true });
    expect(clampBrandView({ ...view, design: none }, BASIC).design).toEqual(none);
  });

  it('tells the Preview tab a locked preset is hidden from guests', () => {
    const catalog = { products: [], upsellRules: [], pairingRules: [], bundles: [] };
    expect(hiddenFromGuests(view, catalog, BASIC)).toContain('design.motionPresets');
    expect(hiddenFromGuests(view, catalog, PRO)).not.toContain('design.motionPresets');
  });
});
