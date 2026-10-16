import { describe, expect, it } from 'vitest';
import { ATELIER, type SeedData, type Tri } from '../../prisma/seed/atelier';
import { LOCALES } from '@/lib/locale';
import { validateForPublish, type PublishIssue } from '@/server/domain/publish-rules';
import { buildSnapshot, type MenuSnapshot } from '@/server/domain/snapshot';
import type { Catalog, CatalogGroup, CatalogProduct, TranslationMap } from '@/server/domain/types';
import { IDS, makeBrand, makeCatalog, makeMenu, makeSnapshot, product, withProduct } from './fixtures';

const issues = (snapshot: MenuSnapshot): PublishIssue[] => validateForPublish(snapshot);
const codes = (snapshot: MenuSnapshot) => issues(snapshot).map((i) => [i.code, i.severity]);
const blocking = (snapshot: MenuSnapshot) => issues(snapshot).filter((i) => i.severity === 'block');

/** The sample catalog, but with every product carrying a picture so the media warning stays out of the way. */
function pictured(catalog: Catalog = makeCatalog()): Catalog {
  return { ...catalog, products: catalog.products.map((p) => ({ ...p, media: [{ kind: 'art', art: 'plate', tone: '#222222' }] })) };
}

function withGroup(catalog: Catalog, productId: string, group: Partial<CatalogGroup>): Catalog {
  const patched: CatalogGroup = {
    id: 'g-test',
    productId,
    minSelect: 0,
    maxSelect: 1,
    translations: { en: { name: 'Test group' } },
    options: [],
    ...group,
  };
  return withProduct(catalog, productId, { groups: [patched] });
}

function option(id: string, groupId = 'g-test') {
  return {
    id,
    groupId,
    priceDelta: 0,
    costDelta: null,
    isSuggested: false,
    suggestPriority: 0,
    isAvailable: true,
    visualKey: null,
    translations: { en: { name: id } },
  };
}

describe('validateForPublish', () => {
  describe('on a sound menu', () => {
    it('finds nothing blocking in the sample catalog', () => {
      expect(blocking(makeSnapshot(pictured()))).toEqual([]);
    });

    it('finds nothing at all when every product has a picture and a name in every locale', () => {
      expect(issues(makeSnapshot(pictured()))).toEqual([]);
    });
  });

  describe('EMPTY_MENU', () => {
    it('blocks an empty menu', () => {
      const emptyMenu = makeSnapshot({ ...makeCatalog(), categories: [], products: [] });
      expect(codes(emptyMenu)).toContainEqual(['EMPTY_MENU', 'block']);
    });

    it('blocks a menu whose categories have no products', () => {
      const none = makeSnapshot({ ...makeCatalog(), products: [] });
      expect(codes(none)).toContainEqual(['EMPTY_MENU', 'block']);
    });
  });

  describe('NO_PRICE', () => {
    const withPrice = (price: number) => makeSnapshot(withProduct(pictured(), IDS.burger, { basePrice: price }));

    it('blocks a product priced 0', () => {
      expect(codes(withPrice(0))).toContainEqual(['NO_PRICE', 'block']);
    });

    it('names the product', () => {
      expect(issues(withPrice(0))).toContainEqual({
        code: 'NO_PRICE',
        severity: 'block',
        entity: { type: 'product', id: IDS.burger, slug: IDS.burger },
      });
    });

    it('blocks a negative price', () => {
      expect(codes(withPrice(-100))).toContainEqual(['NO_PRICE', 'block']);
    });

    it('accepts a positive price', () => {
      expect(codes(withPrice(1))).not.toContainEqual(['NO_PRICE', 'block']);
    });
  });

  describe('EMPTY_CATEGORY', () => {
    it('blocks an active category with no products', () => {
      const catalog = pictured();
      const withEmpty = {
        ...catalog,
        categories: [...catalog.categories, { id: 'cat-empty', slug: 'empty', sortOrder: 9, translations: { en: { name: 'Empty' } } }],
      };
      expect(issues(makeSnapshot(withEmpty))).toContainEqual({
        code: 'EMPTY_CATEGORY',
        severity: 'block',
        entity: { type: 'category', id: 'cat-empty', slug: 'empty' },
      });
    });

    it('does not block a category that has products', () => {
      expect(codes(makeSnapshot(pictured()))).not.toContainEqual(['EMPTY_CATEGORY', 'block']);
    });
  });

  describe('UNSATISFIABLE_GROUP', () => {
    it('blocks a group whose minimum exceeds its options', () => {
      const catalog = withGroup(pictured(), IDS.burger, {
        minSelect: 3,
        maxSelect: 3,
        options: [option('o-1'), option('o-2')],
      });
      expect(issues(makeSnapshot(catalog))).toContainEqual({
        code: 'UNSATISFIABLE_GROUP',
        severity: 'block',
        entity: { type: 'group', id: 'g-test' },
      });
    });

    it('blocks a group whose minimum exceeds its maximum', () => {
      const catalog = withGroup(pictured(), IDS.burger, {
        minSelect: 2,
        maxSelect: 1,
        options: [option('o-1'), option('o-2'), option('o-3')],
      });
      expect(codes(makeSnapshot(catalog))).toContainEqual(['UNSATISFIABLE_GROUP', 'block']);
    });

    it('blocks a required group with no options at all', () => {
      const catalog = withGroup(pictured(), IDS.burger, { minSelect: 1, maxSelect: 1, options: [] });
      expect(codes(makeSnapshot(catalog))).toContainEqual(['UNSATISFIABLE_GROUP', 'block']);
    });

    it('accepts a group whose minimum equals its options and maximum', () => {
      const catalog = withGroup(pictured(), IDS.burger, {
        minSelect: 2,
        maxSelect: 2,
        options: [option('o-1'), option('o-2')],
      });
      expect(codes(makeSnapshot(catalog))).not.toContainEqual(['UNSATISFIABLE_GROUP', 'block']);
    });
  });

  describe('BROKEN_REFERENCE', () => {
    it('blocks a pairing rule whose target is not in the menu', () => {
      const catalog = pictured();
      const broken = {
        ...catalog,
        pairingRules: [...catalog.pairingRules, { ...catalog.pairingRules[0]!, id: 'r-broken', targetProductId: 'p-gone' }],
      };
      expect(issues(makeSnapshot(broken))).toContainEqual({
        code: 'BROKEN_REFERENCE',
        severity: 'block',
        entity: { type: 'rule', id: 'r-broken' },
      });
    });

    it('blocks a pairing rule whose source product or category is not in the menu', () => {
      const catalog = pictured();
      const base = catalog.pairingRules[0]!;
      const broken = {
        ...catalog,
        pairingRules: [
          { ...base, id: 'r-no-source', sourceProductId: 'p-gone' },
          { ...base, id: 'r-no-category', sourceType: 'CATEGORY' as const, sourceProductId: null, sourceCategoryId: 'cat-gone' },
        ],
      };
      const found = issues(makeSnapshot(broken)).filter((i) => i.code === 'BROKEN_REFERENCE');
      expect(found.map((i) => i.entity?.id).sort()).toEqual(['r-no-category', 'r-no-source']);
    });

    it('blocks an upsell rule that points at a product that is not in the menu', () => {
      const catalog = pictured();
      const broken = {
        ...catalog,
        upsellRules: [{ ...catalog.upsellRules[0]!, id: 'u-broken', targetProductId: 'p-gone' }],
      };
      expect(issues(makeSnapshot(broken))).toContainEqual({
        code: 'BROKEN_REFERENCE',
        severity: 'block',
        entity: { type: 'rule', id: 'u-broken' },
      });
    });

    it('blocks a bundle with a product or variant that is not in the menu', () => {
      const catalog = pictured();
      const bundle = catalog.bundles[0]!;
      const broken = {
        ...catalog,
        bundles: [
          { ...bundle, id: 'b-no-product', slug: 'no-product', items: [{ productId: 'p-gone', variantId: null, quantity: 1 }] },
          { ...bundle, id: 'b-no-variant', slug: 'no-variant', items: [{ productId: IDS.coldBrew, variantId: 'v-gone', quantity: 1 }] },
          { ...bundle, id: 'b-ok', slug: 'ok', items: [{ productId: IDS.coldBrew, variantId: IDS.varLarge, quantity: 1 }] },
        ],
      };
      const found = issues(makeSnapshot(broken)).filter((i) => i.code === 'BROKEN_REFERENCE');
      expect(found).toEqual([
        { code: 'BROKEN_REFERENCE', severity: 'block', entity: { type: 'bundle', id: 'b-no-product', slug: 'no-product' } },
        { code: 'BROKEN_REFERENCE', severity: 'block', entity: { type: 'bundle', id: 'b-no-variant', slug: 'no-variant' } },
      ]);
    });

    it('blocks a product that belongs to a category that is not in the menu', () => {
      const catalog = pictured();
      const broken = { ...catalog, products: [...catalog.products, product({ id: 'p-lost', categoryId: 'cat-gone', media: [{}] })] };
      expect(issues(makeSnapshot(broken))).toContainEqual({
        code: 'BROKEN_REFERENCE',
        severity: 'block',
        entity: { type: 'product', id: 'p-lost', slug: 'p-lost' },
      });
    });

    it('accepts the sample rules, bundles and categories', () => {
      expect(codes(makeSnapshot(pictured()))).not.toContainEqual(['BROKEN_REFERENCE', 'block']);
    });
  });

  describe('MISSING_TRANSLATION', () => {
    const sorani = { locales: ['en', 'ckb'] as Array<'en' | 'ckb'> };

    it('warns, not blocks, for a missing Sorani name', () => {
      const missingCkb = makeSnapshot(pictured(), sorani);
      expect(issues(missingCkb)).toContainEqual(
        expect.objectContaining({ code: 'MISSING_TRANSLATION', severity: 'warn', locale: 'ckb' }),
      );
      expect(blocking(missingCkb)).toEqual([]);
    });

    it('checks the name of every category and every product', () => {
      const found = issues(makeSnapshot(pictured(), sorani)).filter((i) => i.code === 'MISSING_TRANSLATION');
      const catalog = makeCatalog();
      expect(found).toHaveLength(catalog.categories.length + catalog.products.length);
      expect(found.filter((i) => i.entity?.type === 'category')).toHaveLength(catalog.categories.length);
      expect(found.filter((i) => i.entity?.type === 'product')).toHaveLength(catalog.products.length);
      expect(found.every((i) => i.locale === 'ckb')).toBe(true);
    });

    it('only checks the locales the menu offers', () => {
      expect(issues(makeSnapshot(pictured(), { locales: ['en'] }))).toEqual([]);
    });

    it('treats a blank name as missing', () => {
      const catalog = withProduct(pictured(), IDS.fries, { translations: { en: { name: '   ', description: '' } } });
      const found = issues(makeSnapshot(catalog)).filter((i) => i.code === 'MISSING_TRANSLATION');
      expect(found).toEqual([
        {
          code: 'MISSING_TRANSLATION',
          severity: 'warn',
          entity: { type: 'product', id: IDS.fries, slug: IDS.fries },
          locale: 'en',
        },
      ]);
    });

    it('does not complain when the name is there', () => {
      const translations: TranslationMap = {
        en: { name: 'Fries' },
        ckb: { name: 'چپس' },
      };
      const catalog = pictured();
      const full = {
        ...catalog,
        categories: catalog.categories.map((c) => ({ ...c, translations: { en: { name: c.slug }, ckb: { name: c.slug } } })),
        products: catalog.products.map((p) => ({ ...p, translations })),
      };
      expect(issues(makeSnapshot(full, sorani))).toEqual([]);
    });
  });

  describe('NO_IMAGE', () => {
    it('warns for a product with no media', () => {
      const catalog = withProduct(pictured(), IDS.fries, { media: [] });
      expect(issues(makeSnapshot(catalog))).toEqual([
        { code: 'NO_IMAGE', severity: 'warn', entity: { type: 'product', id: IDS.fries, slug: IDS.fries } },
      ]);
    });

    it('is quiet for a product with media', () => {
      expect(issues(makeSnapshot(pictured())).some((i) => i.code === 'NO_IMAGE')).toBe(false);
    });
  });

  describe('a menu with several problems', () => {
    it('reports every kind of problem a menu has, blocking and not', () => {
      const catalog = withProduct(makeCatalog(), IDS.burger, { basePrice: 0 });
      const found = codes(makeSnapshot(catalog));
      expect(found).toContainEqual(['NO_PRICE', 'block']);
      expect(found).toContainEqual(['NO_IMAGE', 'warn']);
    });
  });

  describe('the ATELIER demo menu', () => {
    it('finds nothing blocking in the ATELIER seed', () => {
      expect(validateForPublish(atelierSnapshot()).filter((i) => i.severity === 'block')).toEqual([]);
    });

    it('finds nothing at all: every product has art and a name in English, Arabic and Sorani', () => {
      expect(validateForPublish(atelierSnapshot())).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// ATELIER, mapped the way `loadDraftCatalog` maps the rows that `seedMenu` writes. Ids are the seed slugs and positions.
// ---------------------------------------------------------------------------------------------------------------------

function translations(fields: Record<string, Tri>): TranslationMap {
  const out: TranslationMap = {};
  for (const locale of LOCALES) {
    const entry: Record<string, string> = {};
    for (const [field, tri] of Object.entries(fields)) entry[field] = tri[locale];
    out[locale] = entry;
  }
  return out;
}

function atelierCatalog(data: SeedData): Catalog {
  const categoryId = (slug: string) => `cat:${slug}`;
  const productId = (slug: string) => `prod:${slug}`;

  const products = data.products.map<CatalogProduct>((p, index) => {
    const id = productId(p.slug);
    return {
      id,
      categoryId: categoryId(p.category),
      slug: p.slug,
      basePrice: p.price,
      cost: p.cost,
      popularity: p.popularity,
      priority: p.priority,
      isSignature: p.signature ?? false,
      isFeatured: p.featured ?? false,
      isAvailable: true,
      isHidden: false,
      stockCount: p.stock ?? null,
      lowStockThreshold: p.lowStock ?? null,
      dayparts: p.dayparts ?? [],
      hideOutsideDaypart: p.hideOutsideDaypart ?? false,
      slot: p.slot ?? null,
      translations: translations({ name: p.name, description: p.description }),
      media: [{ kind: 'art', art: p.art, tone: p.tone, ...(p.model ? { model: p.model } : {}) }],
      allergens: p.allergens,
      dietary: [],
      calories: null,
      badges: [],
      ingredients: p.ingredients,
      sortOrder: index,
      variants: (p.variants ?? []).map((v, order) => ({
        id: `${id}:variant:${order}`,
        productId: id,
        priceDelta: v.priceDelta,
        costDelta: v.costDelta,
        isDefault: v.isDefault ?? false,
        translations: translations({ name: v.name }),
      })),
      groups: (p.groups ?? []).map<CatalogGroup>((g, order) => {
        const groupId = `${id}:group:${order}`;
        return {
          id: groupId,
          productId: id,
          minSelect: g.min,
          maxSelect: g.max,
          translations: translations({ name: g.name }),
          options: g.options.map((o, optionOrder) => ({
            id: `${groupId}:option:${optionOrder}`,
            groupId,
            priceDelta: o.priceDelta,
            costDelta: o.costDelta,
            isSuggested: o.suggested ?? false,
            suggestPriority: o.suggestPriority ?? 50,
            isAvailable: true,
            visualKey: o.visualKey ?? null,
            translations: translations({ name: o.name, ...(o.effect ? { effect: o.effect } : {}) }),
          })),
        };
      }),
    };
  });

  return {
    menuId: 'atelier',
    currency: data.restaurant.currency,
    timeZone: data.restaurant.timezone,
    defaultLocale: data.restaurant.defaultLocale,
    categories: data.categories.map((c, index) => ({
      id: categoryId(c.slug),
      slug: c.slug,
      sortOrder: index,
      translations: translations({ name: c.name }),
    })),
    products,
    upsellRules: data.upsellRules.map((r, index) => ({
      id: `upsell:${index}`,
      sourceProductId: productId(r.source),
      targetProductId: productId(r.target),
      priority: r.priority,
      dayparts: [],
      translations: translations({ pitch: r.pitch, effect: r.effect }),
    })),
    pairingRules: data.pairingRules.map((r, index) => ({
      id: `pairing:${index}`,
      sourceType: 'product' in r.source ? ('PRODUCT' as const) : ('CATEGORY' as const),
      sourceProductId: 'product' in r.source ? productId(r.source.product) : null,
      sourceCategoryId: 'category' in r.source ? categoryId(r.source.category) : null,
      targetProductId: productId(r.target),
      weight: r.weight,
      dayparts: r.dayparts ?? [],
      translations: translations({ reason: r.reason }),
    })),
    bundles: data.bundles.map((b) => ({
      id: `bundle:${b.slug}`,
      slug: b.slug,
      price: b.price,
      dayparts: b.dayparts ?? [],
      translations: translations({ name: b.name, description: b.description }),
      items: b.items.map((i) => ({ productId: productId(i.product), variantId: null, quantity: i.quantity })),
    })),
    schedule: data.schedule,
  };
}

function atelierSnapshot(): MenuSnapshot {
  const data = ATELIER;
  return buildSnapshot({
    menu: makeMenu({
      name: data.restaurant.name,
      displayName: data.profile.name,
      currency: data.restaurant.currency,
      defaultLocale: data.restaurant.defaultLocale,
      locales: data.restaurant.locales,
      timeZone: data.restaurant.timezone,
      numeralSystem: data.restaurant.numeralSystem === 'ARAB' ? 'arab' : 'latn',
    }),
    brand: makeBrand({
      logoText: data.brand.logoText,
      theme: data.brand.theme === 'LIGHT' ? 'light' : 'dark',
      motionIntensity: data.brand.motionIntensity,
      railStyle: data.brand.railStyle,
      tokens: data.brand.tokens,
    }),
    catalog: atelierCatalog(data),
  });
}
