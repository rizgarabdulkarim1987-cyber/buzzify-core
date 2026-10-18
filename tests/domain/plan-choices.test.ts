import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTES } from '@/lib/brand';
import { RAIL_STYLES } from '@/lib/rail';
import type { BrandView } from '@/server/data/tenant';
import { defaultPlans, effectiveEntitlements, type PlanTier } from '@/server/domain/entitlements';
import {
  allowedFontPairs,
  allowedMotions,
  allowedRails,
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
  type BrandChoices,
} from '@/server/domain/plan-choices';
import { DEFAULT_QR_STYLE } from '@/server/domain/qr';

const on = (plan: PlanTier, extras = {}) => effectiveEntitlements({ plan, plans: defaultPlans(), extras });
const BASIC = on('BASIC');
const PRO = on('PRO');
const PREMIUM = on('PREMIUM');

const VIEW: BrandView = { logoText: 'Zhamitos', theme: 'dark', motionIntensity: 'subtle', railStyle: 'plain', tokens: DEFAULT_PALETTES };

describe('what each plan allows', () => {
  it('offers Classic and Modern without all six font pairs', () => {
    expect(allowedFontPairs(BASIC)).toEqual(['classic', 'modern']);
    expect(allowedFontPairs(PRO)).toHaveLength(6);
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
    expect(guestFeatures(BASIC)).toEqual({ explore: false, stage: false, smartSelling: false, offers: false, socialProof: false, rails: ['plain'] });
    expect(guestFeatures(PRO)).toEqual({ explore: false, stage: false, smartSelling: true, offers: true, socialProof: true, rails: ['drum', 'flap', 'deck', 'plain'] });
    expect(guestFeatures(PREMIUM)).toEqual({ explore: true, stage: true, smartSelling: true, offers: true, socialProof: true, rails: [...RAIL_STYLES] });
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
    expect(hiddenFromGuests(PLAIN_VIEW, { ...noSelling, products: [suggested] }, PRO)).toEqual(['immersive.explore']);
    expect(hiddenFromGuests(PLAIN_VIEW, { ...noSelling, products: [suggested] }, BASIC)).toEqual(['immersive.explore', 'selling.smart']);
    expect(hiddenFromGuests(PLAIN_VIEW, { ...noSelling, products: [sizes] }, BASIC)).toEqual(['immersive.explore', 'selling.smart']);
    // One size, or sizes at one price, offer nothing to upgrade to.
    expect(hiddenFromGuests(PLAIN_VIEW, { ...noSelling, products: [product([], [{ priceDelta: 0 }, { priceDelta: 0 }])] }, BASIC)).toEqual([
      'immersive.explore',
    ]);
  });
});
