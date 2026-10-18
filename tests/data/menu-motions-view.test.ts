import { describe, expect, it } from 'vitest';
import { buildMenuView } from '@/server/data/menu-view';
import { tenantInfo } from '@/server/data/public-menu';
import type { BrandView } from '@/server/data/tenant';
import { DEFAULT_ENGINE_CONFIG } from '@/server/domain/config';
import { defaultPlans, effectiveEntitlements, type PlanTier } from '@/server/domain/entitlements';
import { buildSnapshot, toCatalog } from '@/server/domain/snapshot';
import { at, makeCatalog } from '../domain/fixtures';

/** What guests are served of a menu's motions (spec: 2026-10-18-menu-motions-design.md, section 9). */

const BRAND: BrandView = {
  logoText: 'Zhamitos',
  theme: 'dark',
  motionIntensity: 'subtle',
  railStyle: 'plain',
  tokens: {
    dark: { bg: '#000000', surface: '#111111', raised: '#222222', accent: '#D6BC8A', text: '#ffffff', muted: '#999999', line: '#333333', onAccent: '#000000' },
    light: { bg: '#ffffff', surface: '#ffffff', raised: '#eeeeee', accent: '#7A5F26', text: '#000000', muted: '#666666', line: '#dddddd', onAccent: '#ffffff' },
  },
};

const MOTIONS = [
  { place: 'hero', motionId: 'text-reveal', params: { color: '#112233' }, texts: { text: { en: 'Fresh every morning', ar: 'طازج كل صباح' } } },
  { place: 'category', categoryId: 'cat-coffee', motionId: 'coffee-steam', params: {}, texts: {} },
  { place: 'signature', motionId: 'soft-glow', params: {}, texts: {} },
];

function guest(plan: PlanTier, { brand = BRAND, locale = 'en' as const }: { brand?: BrandView; locale?: 'en' | 'ar' | 'ckb' } = {}) {
  const catalog = makeCatalog();
  const snapshot = buildSnapshot({
    menu: {
      name: 'Menu',
      displayName: 'Zhamitos',
      currency: 'USD',
      defaultLocale: 'en',
      locales: ['en', 'ar', 'ckb'],
      timeZone: 'Asia/Baghdad',
      numeralSystem: 'latn',
      engineConfig: DEFAULT_ENGINE_CONFIG,
      seo: {},
    },
    brand,
    catalog,
    motions: MOTIONS,
  });
  const entitlements = effectiveEntitlements({ plan, plans: defaultPlans(), extras: {} });
  const tenant = tenantInfo({ id: catalog.menuId, slug: 'zhamitos', restaurantId: 'restaurant' }, 'revision', snapshot, entitlements);
  const view = buildMenuView(toCatalog(catalog.menuId, snapshot, { products: {}, options: {} }), tenant, locale, at(12));
  return { tenant, view };
}

describe('the motions guests are served', () => {
  it('serves none on a plan without the feature, so the menu is the one it was', () => {
    const { tenant, view } = guest('BASIC');
    expect(tenant.motions).toEqual([]);
    expect(view.motions).toEqual({ categories: {} });
  });

  it('serves every place on a plan with it, the categories keyed by id', () => {
    const { tenant, view } = guest('PRO');
    expect(tenant.motions).toHaveLength(3);
    expect(view.motions.hero?.motionId).toBe('text-reveal');
    expect(view.motions.signature?.motionId).toBe('soft-glow');
    expect(Object.keys(view.motions.categories)).toEqual(['cat-coffee']);
    expect(view.motions.categories['cat-coffee']).toMatchObject({ motionId: 'coffee-steam', playing: true });
  });

  it('gives each guest the text of their language, else the menu’s default one', () => {
    expect(guest('PRO', { locale: 'ar' }).view.motions.hero?.params).toMatchObject({ text: 'طازج كل صباح', color: '#112233' });
    expect(guest('PRO', { locale: 'ckb' }).view.motions.hero?.params.text).toBe('Fresh every morning');
  });

  it('shows the motions still on a menu whose motion is off', () => {
    const { view } = guest('PRO', { brand: { ...BRAND, motionIntensity: 'none' } });
    expect(view.motions.hero?.playing).toBe(false);
    expect(view.motions.categories['cat-coffee']?.playing).toBe(false);
  });
});
