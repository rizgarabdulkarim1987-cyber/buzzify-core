import { describe, expect, it } from 'vitest';
import { buildCatalogFeed, catalogEtag, CatalogFeedError } from '@/server/domain/link/catalog-feed';
import type { Catalog, CatalogGroup, CatalogProduct } from '@/server/domain/types';
import { product } from '../domain/fixtures';

const group: CatalogGroup = {
  id: 'g1',
  productId: 'p1',
  minSelect: 0,
  maxSelect: 2,
  translations: { en: { name: 'Extras' }, ar: { name: 'إضافات' } },
  options: [
    { id: 'o1', groupId: 'g1', priceDelta: 500, costDelta: 120, isSuggested: true, suggestPriority: 50, isAvailable: true, visualKey: 'cheese', translations: { en: { name: 'Cheese', effect: 'melts' } } },
    { id: 'o2', groupId: 'g1', priceDelta: 750, costDelta: null, isSuggested: false, suggestPriority: 50, isAvailable: false, visualKey: null, translations: { en: { name: 'Bacon' } } },
  ],
};

function catalog(products: CatalogProduct[], currency = 'IQD'): Catalog {
  return {
    menuId: 'menu1',
    currency,
    timeZone: 'Asia/Baghdad',
    defaultLocale: 'en',
    categories: [{ id: 'cat-plates', slug: 'plates', sortOrder: 2, translations: { en: { name: 'Plates' }, ckb: { name: 'خواردن' } }, completesMeal: false }],
    products,
    upsellRules: [],
    pairingRules: [],
    bundles: [],
    promotions: [],
    schedule: [],
  };
}

const menu = { id: 'menu1', slug: 'atelier', publicBaseUrl: 'https://menu.buzzify.me/atelier', defaultLocale: 'en' as const, locales: ['en', 'ar', 'ckb'] as const };
const revision = { number: 7, hash: 'snaphash', wentLiveAt: new Date('2026-10-20T10:00:00Z') };
const input = (c: Catalog) => ({ catalog: c, menu: { ...menu, locales: [...menu.locales] }, revision, menuPlanActive: true });

const burger = product({
  id: 'p1',
  basePrice: 8500,
  cost: 3000,
  stockCount: 4,
  lowStockThreshold: 2,
  sortOrder: 3,
  translations: { en: { name: 'Burger', description: 'Juicy' }, ar: { name: 'برغر', description: 'لذيذ' } },
  groups: [group],
  variants: [
    { id: 'v1', productId: 'p1', priceDelta: 0, costDelta: 0, isDefault: true, translations: { en: { name: 'Regular' } } },
    { id: 'v2', productId: 'p1', priceDelta: 2000, costDelta: 400, isDefault: false, translations: { en: { name: 'Large' } } },
  ],
});

describe('catalog feed (contract 5.2)', () => {
  it('reshapes the catalog to the contract', () => {
    const feed = buildCatalogFeed(input(catalog([burger, product({ id: 'p2', isAvailable: false, basePrice: 1000 })])));
    expect(feed.contractVersion).toBe(1);
    expect(feed.link).toEqual({ status: 'ACTIVE', menuPlanActive: true });
    expect(feed.menu).toEqual({ id: 'menu1', slug: 'atelier', publicBaseUrl: 'https://menu.buzzify.me/atelier', currency: 'IQD', defaultLocale: 'en', locales: ['en', 'ar', 'ckb'] });
    expect(feed.revision).toEqual({ number: 7, hash: 'snaphash', wentLiveAt: '2026-10-20T10:00:00.000Z' });
    expect(feed.categories).toEqual([{ id: 'cat-plates', sortOrder: 2, name: { en: 'Plates', ckb: 'خواردن' } }]);
    const [p1, p2] = feed.products;
    expect(p1).toEqual({
      id: 'p1',
      categoryId: 'cat-plates',
      sortOrder: 3,
      price: 8500,
      name: { en: 'Burger', ar: 'برغر' },
      state: 'ACTIVE',
      variants: [
        { id: 'v1', priceDelta: 0, isDefault: true, sortOrder: 0, name: { en: 'Regular' } },
        { id: 'v2', priceDelta: 2000, isDefault: false, sortOrder: 1, name: { en: 'Large' } },
      ],
      groups: [
        {
          id: 'g1',
          sortOrder: 0,
          minSelect: 0,
          maxSelect: 2,
          name: { en: 'Extras', ar: 'إضافات' },
          options: [
            { id: 'o1', priceDelta: 500, available: true, sortOrder: 0, name: { en: 'Cheese' } },
            { id: 'o2', priceDelta: 750, available: false, sortOrder: 1, name: { en: 'Bacon' } },
          ],
        },
      ],
    });
    expect(p2?.state).toBe('SOLD_OUT');
  });

  it('T13 never carries cost, stock, media, descriptions or sales data', () => {
    const text = JSON.stringify(buildCatalogFeed(input(catalog([burger]))));
    for (const forbidden of ['cost', 'stock', 'media', 'description', 'Juicy', 'allergens', 'badges', 'upsell', 'bundle', 'promotion', 'ingredients', 'visualKey', 'effect', '3000', '120']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('keeps a name for a product that has none by falling back to its slug', () => {
    const feed = buildCatalogFeed(input(catalog([product({ id: 'p3', slug: 'mystery', translations: {} })])));
    expect(feed.products[0]?.name).toEqual({ en: 'mystery' });
  });

  it('T14 the ETag changes with the revision and with a sold-out toggle, and is stable otherwise', () => {
    const base = catalog([burger]);
    const same = catalog([burger]);
    const soldOut = catalog([{ ...burger, isAvailable: false }]);
    const optionOut = catalog([{ ...burger, groups: [{ ...group, options: [{ ...group.options[0]!, isAvailable: false }, group.options[1]!] }] }]);
    const etag = (c: Catalog, hash = 'snaphash') => catalogEtag(hash, c);
    expect(etag(base)).toBe(etag(same));
    expect(etag(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(etag(base)).not.toBe(etag(soldOut));
    expect(etag(base)).not.toBe(etag(optionOut));
    expect(etag(base)).not.toBe(etag(base, 'other'));
    // Hiding a product removes it from the catalog, which changes the ETag too.
    expect(etag(base)).not.toBe(etag(catalog([])));
    // A price change inside the same revision is impossible (the snapshot is frozen), so only availability counts.
    expect(buildCatalogFeed(input(base)).etag).toBe(etag(base));
  });

  it('refuses a currency other than IQD', () => {
    expect(() => buildCatalogFeed(input(catalog([burger], 'USD')))).toThrowError(expect.objectContaining({ code: 'currencyMismatch' }));
  });

  it('refuses a catalog over the maxima', () => {
    const many = Array.from({ length: 2001 }, (_, i) => product({ id: `x${i}` }));
    expect(() => buildCatalogFeed(input(catalog(many)))).toThrow(CatalogFeedError);
    expect(() => buildCatalogFeed(input(catalog(many)))).toThrowError(expect.objectContaining({ code: 'catalogTooLarge' }));
  });
});
