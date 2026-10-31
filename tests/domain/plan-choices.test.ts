import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTES } from '@/lib/brand';
import { FONT_PAIR_IDS } from '@/lib/font-pairs';
import { RAIL_STYLES } from '@/lib/rail';
import { TEMPLATES } from '@/lib/templates';
import { DEFAULT_FRAMING, resolveDesign } from '@/lib/templates/resolve';
import type { SceneMedia } from '@/lib/templates/types';
import type { BrandView } from '@/server/data/tenant';
import { defaultPlans, effectiveEntitlements, type PlanTier } from '@/server/domain/entitlements';
import {
  allowedFontPairs,
  allowedMotions,
  allowedRails,
  allowedSceneKinds,
  bestRail,
  brandChoiceLock,
  clampBrandChoices,
  clampBrandView,
  guestFeatures,
  guestFontPair,
  guestMotion,
  guestQrStyle,
  guestRail,
  hiddenChoices,
  hiddenFromGuests,
  isBrandedQr,
  qrStyleLock,
  sceneChoiceLock,
  sceneFeature,
  type BrandChoices,
} from '@/server/domain/plan-choices';
import { DEFAULT_QR_STYLE } from '@/server/domain/qr';

const on = (plan: PlanTier, extras = {}) => effectiveEntitlements({ plan, plans: defaultPlans(), extras });
const BASIC = on('BASIC');
const PRO = on('PRO');
const PREMIUM = on('PREMIUM');

const VIEW: BrandView = { logoText: 'Zhamitos', theme: 'dark', motionIntensity: 'subtle', railStyle: 'plain', tokens: DEFAULT_PALETTES };

describe('what each plan allows', () => {
  it('offers Classic and Modern without every font pair', () => {
    expect(allowedFontPairs(BASIC)).toEqual(['classic', 'modern']);
    expect(allowedFontPairs(PRO)).toEqual([...FONT_PAIR_IDS]);
  });

  it('offers the plain rail always, the animated ones with Pro and the melting dish with the 3D stage', () => {
    expect(allowedRails(BASIC)).toEqual(['plain']);
    expect(allowedRails(PRO)).toEqual(['drum', 'flap', 'deck', 'plain']);
    expect(allowedRails(PREMIUM)).toEqual([...RAIL_STYLES]);
    expect(allowedRails(on('BASIC', { 'immersive.stage': true }))).toEqual(['grains', 'plain']);
  });

  it('offers expressive motion only with its feature', () => {
    expect(allowedMotions(BASIC)).toEqual(['none', 'subtle']);
    expect(allowedMotions(PRO)).toEqual(['none', 'subtle', 'expressive']);
  });

  it('starts a new menu on the best rail the plan allows', () => {
    expect(bestRail(BASIC)).toBe('plain');
    expect(bestRail(PRO)).toBe('deck');
    expect(bestRail(PREMIUM)).toBe('grains');
  });
});

describe('what guests see instead of a locked choice', () => {
  it('maps each rail to the closest one the plan allows', () => {
    expect(guestRail('grains', PRO)).toBe('deck');
    expect(guestRail('drum', BASIC)).toBe('plain');
    expect(guestRail('grains', BASIC)).toBe('plain');
    expect(guestRail('grains', PREMIUM)).toBe('grains');
    expect(guestRail('flap', PRO)).toBe('flap');
  });

  it('shows a locked font pair as Classic and expressive motion as subtle', () => {
    expect(guestFontPair('fine', BASIC)).toBe('classic');
    expect(guestFontPair('modern', BASIC)).toBe('modern');
    expect(guestMotion('expressive', BASIC)).toBe('subtle');
    expect(guestMotion('none', BASIC)).toBe('none');
  });

  it('clamps a brand view without touching the one given', () => {
    const view: BrandView = { ...VIEW, motionIntensity: 'expressive', railStyle: 'drum', fontPairId: 'fine' };
    const clamped = clampBrandView(view, BASIC);
    expect(clamped).toMatchObject({ motionIntensity: 'subtle', railStyle: 'plain', logoText: 'Zhamitos' });
    expect(clamped.fontPairId).toBeUndefined();
    expect(view).toMatchObject({ motionIntensity: 'expressive', railStyle: 'drum', fontPairId: 'fine' });
    expect(clampBrandView(view, PREMIUM)).toEqual(view);
  });

  it('keeps the plain rail when motion is off, whatever the plan', () => {
    expect(clampBrandView({ ...VIEW, motionIntensity: 'none', railStyle: 'plain', railChoice: 'grains' }, PREMIUM).railStyle).toBe('plain');
  });

  it('draws a branded QR style plain on a plan without it, keeping the frame text', () => {
    const branded = { foreground: '#123456', background: '#FFFFEE', logo: true, frameText: 'Scan' };
    expect(guestQrStyle(branded, BASIC)).toEqual({ foreground: '#000000', background: '#FFFFFF', logo: false, frameText: 'Scan' });
    expect(guestQrStyle(branded, PRO)).toEqual(branded);
    expect(isBrandedQr(branded)).toBe(true);
    expect(isBrandedQr({ ...DEFAULT_QR_STYLE, frameText: 'Scan' })).toBe(false);
  });

  it('says which guest features a plan shows', () => {
    expect(guestFeatures(BASIC)).toEqual({ explore: true, stage: false, intro: true, about: false, wheel: false, dishCounts: false, drinkMatch: false, moodPicker: false, livingPhotos: false, occasionMoods: false, stories: false, smartSelling: false, offers: false, socialProof: false, rails: ['plain'] });
    expect(guestFeatures(PRO)).toEqual({ explore: true, stage: false, intro: true, about: true, wheel: true, dishCounts: true, drinkMatch: true, moodPicker: true, livingPhotos: false, occasionMoods: true, stories: true, smartSelling: true, offers: true, socialProof: true, rails: ['drum', 'flap', 'deck', 'plain'] });
    expect(guestFeatures(PREMIUM)).toEqual({ explore: true, stage: true, intro: true, about: true, wheel: true, dishCounts: true, drinkMatch: true, moodPicker: true, livingPhotos: true, occasionMoods: true, stories: true, smartSelling: true, offers: true, socialProof: true, rails: [...RAIL_STYLES] });
  });
});

describe('locks on choices', () => {
  const stored: BrandChoices = { fontPairId: 'fine', railStyle: 'drum', motionIntensity: 'expressive' };

  it('keeps a locked choice that was already stored and refuses a new one', () => {
    expect(brandChoiceLock(stored, stored, BASIC)).toBeNull();
    expect(brandChoiceLock({ ...stored, fontPairId: 'cafe' }, stored, BASIC)).toBe('design.fontPairs');
    expect(brandChoiceLock({ ...stored, railStyle: 'deck' }, stored, BASIC)).toBe('design.railStyles');
    expect(brandChoiceLock({ ...stored, railStyle: 'grains' }, { ...stored, railStyle: 'plain' }, PRO)).toBe('immersive.stage');
    expect(brandChoiceLock({ ...stored, motionIntensity: 'expressive' }, { ...stored, motionIntensity: 'subtle' }, BASIC)).toBe('design.expressiveMotion');
    expect(brandChoiceLock({ ...stored, railStyle: 'plain', fontPairId: 'classic', motionIntensity: 'none' }, stored, BASIC)).toBeNull();
  });

  it('refuses a newly branded QR style but not a kept one, nor a plain one', () => {
    const branded = { foreground: '#123456', background: '#FFFFFF', logo: false, frameText: '' };
    expect(qrStyleLock(branded, DEFAULT_QR_STYLE, BASIC)).toBe('qr.branded');
    expect(qrStyleLock({ ...branded, frameText: 'Scan' }, branded, BASIC)).toBeNull();
    expect(qrStyleLock({ ...DEFAULT_QR_STYLE, frameText: 'Scan' }, branded, BASIC)).toBeNull();
    expect(qrStyleLock(branded, DEFAULT_QR_STYLE, PRO)).toBeNull();
  });

  it('brings copied choices within the plan', () => {
    expect(clampBrandChoices(stored, BASIC)).toEqual({ fontPairId: 'classic', railStyle: 'plain', motionIntensity: 'subtle' });
    expect(clampBrandChoices(stored, PREMIUM)).toEqual(stored);
  });

  it('lists the stored choices guests do not see', () => {
    expect(hiddenChoices(stored, BASIC)).toEqual(['design.fontPairs', 'design.railStyles', 'design.expressiveMotion']);
    expect(hiddenChoices({ ...stored, railStyle: 'grains' }, PRO)).toEqual(['immersive.stage']);
    expect(hiddenChoices(stored, PREMIUM)).toEqual([]);
  });
});

describe('what the Preview tab says guests on the plan do not see', () => {
  const noSelling = { upsellRules: [], pairingRules: [], bundles: [] };
  const product = (groups: Array<{ options: Array<{ isSuggested: boolean }> }> = [], variants: Array<{ priceDelta: number }> = []) => ({
    media: [],
    groups,
    variants,
  });
  const PLAIN_VIEW: BrandView = { ...VIEW, railStyle: 'plain', motionIntensity: 'subtle' };

  it('counts a suggested option or a bigger size as smart selling, which offers them as upgrades', () => {
    const suggested = product([{ options: [{ isSuggested: true }] }]);
    const sizes = product([], [{ priceDelta: 0 }, { priceDelta: 150 }]);
    expect(hiddenFromGuests(PLAIN_VIEW, { ...noSelling, products: [suggested] }, PRO)).toEqual([]);
    expect(hiddenFromGuests(PLAIN_VIEW, { ...noSelling, products: [suggested] }, BASIC)).toEqual(['selling.smart']);
    expect(hiddenFromGuests(PLAIN_VIEW, { ...noSelling, products: [sizes] }, BASIC)).toEqual(['selling.smart']);
    const offer = { id: 'o', kind: 'SPECIAL' as const, percentOff: null, productIds: ['p'], categoryIds: [], startsOn: null, endsOn: null, startMinute: null, endMinute: null, daysOfWeek: 127, roundTo: 5, translations: {}, sortOrder: 0 };
    expect(hiddenFromGuests(PLAIN_VIEW, { ...noSelling, products: [], promotions: [offer] }, PRO)).toEqual([]);
    expect(hiddenFromGuests(PLAIN_VIEW, { ...noSelling, products: [], promotions: [offer] }, BASIC)).toEqual(['selling.offers']);
    // One size, or sizes at one price, offer nothing to upgrade to.
    expect(hiddenFromGuests(PLAIN_VIEW, { ...noSelling, products: [product([], [{ priceDelta: 0 }, { priceDelta: 0 }])] }, BASIC)).toEqual([]);
  });

});

describe('scene files', () => {
  const MEDIA = {
    model: { kind: 'model', assetId: 'm1', url: '/m1/original.glb', framing: DEFAULT_FRAMING },
    video: { kind: 'video', assetId: 'v1', url: '/v1/original.mp4', width: 1080, height: 1920, poster: { url: '/v1/poster.webp', srcset: '', placeholder: '' } },
    lottie: { kind: 'lottie', assetId: 'l1', url: '/l1/original.json', width: 512, height: 512 },
    image: { kind: 'image', assetId: 'i1', url: '/i1/1600.webp', width: 2400, height: 1600, srcset: '', placeholder: '' },
  } satisfies Record<SceneMedia['kind'], SceneMedia>;
  const designed = (media: SceneMedia): BrandView => ({
    ...VIEW,
    design: { ...resolveDesign(TEMPLATES['obsidian-gold'], {}, { details: null, poweredBy: true }), media },
  });

  it('names the feature each kind of file needs', () => {
    expect(sceneFeature('model')).toBe('immersive.models3d');
    expect(sceneFeature('video')).toBe('design.backgroundVideo');
    expect(sceneFeature('lottie')).toBe('design.backgroundAnimation');
    expect(sceneFeature('image')).toBe('design.backgroundImage');
  });

  it('offers Lottie with Pro, every kind with Premium, and a kind an extra turns on', () => {
    expect(allowedSceneKinds(BASIC)).toEqual([]);
    expect(allowedSceneKinds(PRO)).toEqual(['lottie', 'image']);
    expect(allowedSceneKinds(PREMIUM)).toEqual(['model', 'video', 'lottie', 'image']);
    expect(allowedSceneKinds(on('BASIC', { 'design.backgroundVideo': true }))).toEqual(['video']);
  });

  it('keeps a stored file whatever the plan, and refuses a new one the plan locks', () => {
    expect(sceneChoiceLock({ assetId: 'v1', kind: 'video' }, 'v1', BASIC)).toBeNull();
    expect(sceneChoiceLock({ assetId: 'v2', kind: 'video' }, 'v1', PRO)).toBe('design.backgroundVideo');
    expect(sceneChoiceLock({ assetId: 'm1', kind: 'model' }, null, PRO)).toBe('immersive.models3d');
    expect(sceneChoiceLock({ assetId: 'l1', kind: 'lottie' }, null, PRO)).toBeNull();
    expect(sceneChoiceLock({ assetId: 'l1', kind: 'lottie' }, null, BASIC)).toBe('design.backgroundAnimation');
    expect(sceneChoiceLock(null, 'v1', BASIC)).toBeNull();
  });

  it('gives guests the template’s own scene for a file the plan lacks, without touching the view given', () => {
    expect(clampBrandView(designed(MEDIA.video), PRO).design?.media).toBeUndefined();
    expect(clampBrandView(designed(MEDIA.model), PRO).design?.media).toBeUndefined();
    expect(clampBrandView(designed(MEDIA.lottie), PRO).design?.media).toEqual(MEDIA.lottie);
    for (const media of Object.values(MEDIA)) {
      const view = designed(media);
      expect(clampBrandView(view, BASIC).design?.media).toBeUndefined();
      expect(clampBrandView(view, BASIC).design?.templateId).toBe('obsidian-gold');
      expect(view.design?.media).toEqual(media);
      expect(clampBrandView(view, PREMIUM)).toEqual(view);
    }
    expect(clampBrandView(designed(MEDIA.video), on('PRO', { 'design.backgroundVideo': true })).design?.media).toEqual(MEDIA.video);
  });

  it('tells the Preview tab about a file guests do not see, right after the brand’s choices', () => {
    const catalog = { upsellRules: [], pairingRules: [], bundles: [], products: [] };
    expect(hiddenFromGuests(designed(MEDIA.video), catalog, PRO)).toEqual(['design.backgroundVideo']);
    expect(hiddenFromGuests(designed(MEDIA.lottie), catalog, PRO)).toEqual([]);
    expect(hiddenFromGuests({ ...designed(MEDIA.model), fontPairId: 'fine' }, catalog, BASIC)).toEqual(['design.fontPairs', 'immersive.models3d']);
    expect(hiddenFromGuests(designed(MEDIA.model), catalog, PREMIUM)).toEqual([]);
  });
});
