import { describe, expect, it } from 'vitest';
import { buildMenuView, buildSearchIndex } from '@/server/data/menu-view';
import type { TenantInfo } from '@/server/data/tenant';
import { DEFAULT_ENGINE_CONFIG } from '@/server/domain/config';
import { at, IDS, makeCatalog, withProduct } from '../domain/fixtures';

const tenant: TenantInfo = {
  id: 'r-test',
  slug: 'test',
  name: 'Test',
  currency: 'USD',
  defaultLocale: 'en',
  locales: ['en', 'ar', 'ckb'],
  timeZone: 'Asia/Baghdad',
  numeralSystem: 'latn',
  engineConfig: DEFAULT_ENGINE_CONFIG,
  brand: {
    logoText: 'TEST',
    theme: 'dark',
    motionIntensity: 'subtle',
    tokens: {
      dark: { bg: '#000000', surface: '#111111', raised: '#222222', accent: '#D6BC8A', text: '#ffffff', muted: '#999999', line: '#333333', onAccent: '#000000' },
      light: { bg: '#ffffff', surface: '#ffffff', raised: '#eeeeee', accent: '#7A5F26', text: '#000000', muted: '#666666', line: '#dddddd', onAccent: '#ffffff' },
    },
  },
};

describe('buildMenuView', () => {
  it('groups products under ordered categories with localized text', () => {
    const view = buildMenuView(makeCatalog(), tenant, 'en', at(12));
    expect(view.categories.map((c) => c.slug)).toEqual(['coffee', 'breakfast', 'plates', 'patisserie', 'cold']);
    const burger = view.products.find((p) => p.id === IDS.burger)!;
    expect(burger.name).toBe(IDS.burger); // fixture names equal ids
    expect(burger.groups[0]?.options.map((o) => o.name)).toEqual(['Premium cheese', 'Double patty', 'Bacon']);
  });

  it('carries what an option does to the product visually', () => {
    const view = buildMenuView(makeCatalog(), tenant, 'en', at(12));
    const burger = view.products.find((p) => p.id === IDS.burger)!;
    expect(burger.groups[0]?.options.map((o) => o.visualKey)).toEqual(['cheese', 'patty', 'bacon']);
    const espresso = view.products.find((p) => p.id === IDS.espresso)!;
    expect(espresso.groups.flatMap((g) => g.options).every((o) => o.visualKey === null)).toBe(true);
  });

  it('shows the price a customer will actually pay, including the default variant', () => {
    const catalog = withProduct(makeCatalog(), IDS.espresso, {
      variants: [
        {
          id: 'v-standard',
          productId: IDS.espresso,
          priceDelta: 100,
          costDelta: null,
          isDefault: true,
          translations: { en: { name: 'Standard' } },
        },
      ],
    });
    const view = buildMenuView(catalog, tenant, 'en', at(12));
    expect(view.products.find((p) => p.id === IDS.espresso)?.displayPrice).toBe(400);
    expect(view.products.find((p) => p.id === IDS.burger)?.displayPrice).toBe(900);
  });

  it('flags products that need choices and keeps simple ones quick-addable', () => {
    const view = buildMenuView(makeCatalog(), tenant, 'en', at(12));
    expect(view.products.find((p) => p.id === IDS.steak)?.needsChoices).toBe(true);
    expect(view.products.find((p) => p.id === IDS.burger)?.needsChoices).toBe(false);
    expect(view.products.find((p) => p.id === IDS.fries)?.needsChoices).toBe(false);
  });

  it('shows unavailable products as unavailable and hides out-of-daypart ones', () => {
    let catalog = withProduct(makeCatalog(), IDS.fries, { isAvailable: false });
    catalog = withProduct(catalog, IDS.croissant, { hideOutsideDaypart: true });
    const view = buildMenuView(catalog, tenant, 'en', at(12));
    expect(view.products.find((p) => p.id === IDS.fries)?.orderState).toBe('UNAVAILABLE');
    expect(view.products.some((p) => p.id === IDS.croissant)).toBe(false);
    expect(buildMenuView(catalog, tenant, 'en', at(9)).products.some((p) => p.id === IDS.croissant)).toBe(true);
  });

  const espressoInThreeLocales = () =>
    withProduct(makeCatalog(), IDS.espresso, {
      translations: { en: { name: 'Espresso', description: '' }, ar: { name: 'إسبريسو' }, ckb: { name: 'ئێسپرێسۆ' } },
      ingredients: { en: ['Coffee'], ar: ['قهوة'] },
    });

  it("gives each product a search key in the page's own language and ingredients", () => {
    const view = buildMenuView(espressoInThreeLocales(), tenant, 'en', at(12));
    const key = view.products.find((p) => p.id === IDS.espresso)!.searchKey;
    expect(key).toContain('espresso');
    expect(key).toContain('coffee');
    // The other languages are not sent with the page; they arrive with the search index.
    expect(key).not.toContain('اسبريسو');
    expect(key).not.toContain('قهوه');
  });

  it('builds a search index across all locales and ingredients', () => {
    const index = buildSearchIndex(espressoInThreeLocales(), at(12));
    const key = index[IDS.espresso]!;
    expect(key).toContain('espresso');
    expect(key).toContain('اسبريسو');
    expect(key).toContain('قهوه');
  });

  it('keeps products that are hidden from the menu out of the search index', () => {
    const catalog = withProduct(makeCatalog(), IDS.croissant, { hideOutsideDaypart: true });
    expect(buildSearchIndex(catalog, at(12))[IDS.croissant]).toBeUndefined();
    expect(buildSearchIndex(catalog, at(9))[IDS.croissant]).toBeDefined();
  });

  it('picks the signature product for the daypart and reports the daypart', () => {
    const catalog = withProduct(makeCatalog(), IDS.croissant, { isSignature: true });
    const view = buildMenuView(catalog, tenant, 'en', at(9));
    expect(view.daypart).toBe('BREAKFAST');
    expect(view.signatureProductId).toBe(IDS.croissant);
  });

  it('falls back to the default locale when a translation is missing', () => {
    const view = buildMenuView(makeCatalog(), tenant, 'ckb', at(12));
    expect(view.products.find((p) => p.id === IDS.burger)?.name).toBe(IDS.burger);
    expect(view.categories[0]?.name).toBe('Coffee');
  });

  it('drops invalid media entries instead of failing', () => {
    const catalog = withProduct(makeCatalog(), IDS.fries, {
      media: [{ kind: 'image', url: 'javascript:alert(1)', alt: 'x', width: 1, height: 1 }, { kind: 'art', art: 'plate', tone: '#D9B45A' }],
    });
    const view = buildMenuView(catalog, tenant, 'en', at(12));
    expect(view.products.find((p) => p.id === IDS.fries)?.media).toEqual([{ kind: 'art', art: 'plate', tone: '#D9B45A' }]);
  });
});
