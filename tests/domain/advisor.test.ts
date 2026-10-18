import { describe, expect, it } from 'vitest';
import { adviseMenu, type AdviceCode } from '@/server/domain/advisor';
import type { Catalog, CatalogProduct } from '@/server/domain/types';
import { IDS, makeCatalog, product, withProduct } from './fixtures';

const photo = { kind: 'image', url: '/m/p.webp', alt: 'Dish', width: 800, height: 600 };
const art = { kind: 'art', art: 'plate', tone: '#222222' };

/** The sample menu with nothing to advise: photos, descriptions, costs, a signature dish and rules everywhere. */
function tidy(): Catalog {
  const catalog = makeCatalog();
  return {
    ...catalog,
    products: catalog.products.map((p) => ({
      ...p,
      media: [photo],
      translations: { en: { name: p.id, description: `About ${p.id}` } },
      isSignature: p.id === IDS.burger,
      variants: [],
    })),
    bundles: catalog.bundles.filter((b) => b.id !== 'b-not-a-deal'),
  };
}

const codes = (catalog: Catalog, locales: Array<'en' | 'ar' | 'ckb'> = ['en']) => adviseMenu(catalog, locales).map((a) => a.code);
const find = (catalog: Catalog, code: AdviceCode, locales: Array<'en' | 'ar' | 'ckb'> = ['en']) =>
  adviseMenu(catalog, locales).find((a) => a.code === code);

describe('adviseMenu', () => {
  it('has nothing to say about a tidy menu', () => {
    expect(codes(tidy())).toEqual([]);
  });

  it('names dishes with only drawn art or nothing as having no photo; a library photo counts', () => {
    let catalog = withProduct(tidy(), IDS.burger, { media: [art] });
    catalog = withProduct(catalog, IDS.fries, { media: [] });
    catalog = withProduct(catalog, IDS.steak, { media: [{ kind: 'asset', assetId: 'a1' }] });
    expect(find(catalog, 'NO_PHOTO')?.productIds).toEqual([IDS.burger, IDS.fries]);
  });

  it('names a dish missing its description in a language of the menu', () => {
    const catalog = withProduct(tidy(), IDS.fries, { translations: { en: { name: 'Fries', description: 'Crisp' }, ar: { name: 'بطاطا' } } });
    expect(find(catalog, 'NO_DESCRIPTION')).toBeUndefined();
    expect(find(catalog, 'NO_DESCRIPTION', ['en', 'ar'])?.productIds).toContain(IDS.fries);
  });

  it('names dishes without a cost', () => {
    expect(find(withProduct(tidy(), IDS.fries, { cost: null }), 'NO_COST')?.productIds).toEqual([IDS.fries]);
  });

  it('calls a category of 11 dishes long and one of 10 not', () => {
    const extra = (n: number): CatalogProduct[] =>
      Array.from({ length: n }, (_, i) => ({ ...product({ id: `x${i}`, categoryId: 'cat-breakfast' }), media: [photo], translations: { en: { name: `x${i}`, description: 'd' } } }));
    const base = tidy();
    const inBreakfast = base.products.filter((p) => p.categoryId === 'cat-breakfast').length;
    const ten = { ...base, products: [...base.products, ...extra(10 - inBreakfast)] };
    const eleven = { ...base, products: [...base.products, ...extra(11 - inBreakfast)] };
    expect(find(ten, 'LONG_CATEGORY')).toBeUndefined();
    expect(find(eleven, 'LONG_CATEGORY')?.categoryIds).toEqual(['cat-breakfast']);
  });

  it('calls three vegan dishes alone in a category a vegetarian section', () => {
    const base = tidy();
    const vegan = (id: string): CatalogProduct => ({
      ...product({ id, categoryId: 'cat-green', dietary: ['VEGAN'] }),
      media: [photo],
      translations: { en: { name: id, description: 'd' } },
    });
    const catalog = {
      ...base,
      categories: [...base.categories, { id: 'cat-green', slug: 'green', sortOrder: 9, translations: { en: { name: 'Green' } }, completesMeal: false }],
      products: [...base.products, vegan('v1'), vegan('v2'), { ...vegan('v3'), dietary: ['VEGETARIAN'] }],
    };
    expect(find(catalog, 'VEGETARIAN_SECTION')?.categoryIds).toEqual(['cat-green']);
    const withMeat = { ...catalog, products: catalog.products.map((p) => (p.id === 'v3' ? { ...p, dietary: [] } : p)) };
    expect(find(withMeat, 'VEGETARIAN_SECTION')).toBeUndefined();
  });

  it('names a dish with exactly two sizes', () => {
    const sized = makeCatalog().products.find((p) => p.id === IDS.coldBrew)!;
    expect(find(withProduct(tidy(), IDS.coldBrew, { variants: sized.variants }), 'TWO_SIZES')?.productIds).toEqual([IDS.coldBrew]);
  });

  it('says so when the menu has no upgrade or pairing rule at all', () => {
    expect(find({ ...tidy(), upsellRules: [], pairingRules: [] }, 'NO_RULES')).toEqual({ code: 'NO_RULES', productIds: [], categoryIds: [], bundleIds: [] });
    expect(find({ ...tidy(), upsellRules: [] }, 'NO_RULES')).toBeUndefined();
  });

  it('names a set that costs as much as its items', () => {
    expect(find(makeCatalog(), 'SET_NOT_A_DEAL')?.bundleIds).toEqual(['b-not-a-deal']);
  });

  it('says so when no dish is signature or featured', () => {
    const plain = { ...tidy(), products: tidy().products.map((p) => ({ ...p, isSignature: false, isFeatured: false })) };
    expect(codes(plain)).toEqual(['NO_SIGNATURE']);
  });

  it('lists its advice in a fixed order', () => {
    const messy = { ...withProduct(makeCatalog(), IDS.fries, { cost: null }), upsellRules: [], pairingRules: [] };
    const order: AdviceCode[] = ['NO_PHOTO', 'NO_DESCRIPTION', 'NO_COST', 'LONG_CATEGORY', 'VEGETARIAN_SECTION', 'TWO_SIZES', 'NO_RULES', 'SET_NOT_A_DEAL', 'NO_SIGNATURE'];
    const found = codes(messy);
    expect(found).toEqual(order.filter((code) => found.includes(code)));
  });
});
