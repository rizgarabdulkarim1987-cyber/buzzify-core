import { describe, expect, it } from 'vitest';
import { buildMenuView, buildSearchIndex } from '@/server/data/menu-view';
import type { TenantInfo } from '@/server/data/tenant';
import { DEFAULT_ENGINE_CONFIG, DEFAULT_SALES_SETTINGS, type SalesSettings } from '@/server/domain/config';
import type { CatalogPromotion } from '@/server/domain/types';
import { at, IDS, makeCatalog, withProduct } from '../domain/fixtures';

const tenant: TenantInfo = {
  id: 'r-test',
  restaurantId: 'restaurant-test',
  feedbackEnabled: true,
  revisionId: 'revision-test',
  slug: 'test',
  name: 'Test',
  currency: 'USD',
  defaultLocale: 'en',
  locales: ['en', 'ar', 'ckb'],
  timeZone: 'Asia/Baghdad',
  numeralSystem: 'latn',
  engineConfig: DEFAULT_ENGINE_CONFIG,
  seo: {},
  features: { explore: true, stage: true, smartSelling: true, offers: true, socialProof: true, intro: true, about: true, wheel: true, dishCounts: true, drinkMatch: true, moodPicker: true, livingPhotos: true, occasionMoods: true, stories: true, models3d: true, ar: true, tableBasket: true, callWaiter: true, rails: ['grains', 'drum', 'flap', 'deck', 'plain'] },
  extras: { intro: false, about: false, wheel: false, dishCounts: false, aboutTitle: { en: '', ar: '', ckb: '' } },
  brand: {
    logoText: 'TEST',
    theme: 'dark',
    motionIntensity: 'subtle',
    railStyle: 'grains',
    tokens: {
      dark: { bg: '#000000', surface: '#111111', raised: '#222222', accent: '#D6BC8A', text: '#ffffff', muted: '#999999', line: '#333333', onAccent: '#000000' },
      light: { bg: '#ffffff', surface: '#ffffff', raised: '#eeeeee', accent: '#7A5F26', text: '#000000', muted: '#666666', line: '#dddddd', onAccent: '#ffffff' },
    },
  },
};

describe('buildMenuView', () => {
  it("shows a dish's 3D model only on a plan with models, and offers AR only on a plan with AR", () => {
    const model = { kind: 'model3d', url: 'https://cdn.test/burger.glb', assetId: 'm1' };
    const catalog = withProduct(makeCatalog(), IDS.burger, { media: [model] });
    const mediaOf = (info: TenantInfo) => buildMenuView(catalog, info, 'en', at(12)).products.find((p) => p.id === IDS.burger)!.media;
    expect(mediaOf(tenant)).toEqual([{ ...model, ar: true }]);
    expect(mediaOf({ ...tenant, features: { ...tenant.features, ar: false } })).toEqual([model]);
    // Without the plan the choice is kept in the draft and the snapshot, and simply not shown.
    expect(mediaOf({ ...tenant, features: { ...tenant.features, models3d: false, ar: false } })).toEqual([]);
  });

  it('gives food the drinks that go with it, the paired one first, when the plan has drink match', () => {
    const view = buildMenuView(makeCatalog(), tenant, 'en', at(12));
    const burger = view.products.find((p) => p.id === IDS.burger)!;
    expect(burger.match?.[0]).toEqual({ id: IDS.sparkling, name: IDS.sparkling, price: 300, paired: true });
    expect(view.products.find((p) => p.id === IDS.espresso)!.match).toBeUndefined();
    expect(view.products.find((p) => p.id === IDS.cheesecake)!.match).toBeUndefined();
  });

  it('stamps each dish with the moods it suits when the plan has the mood picker, and nothing when it does not', () => {
    const catalog = withProduct(makeCatalog(), IDS.burger, { calories: 900, serves: 2 });
    const on = buildMenuView(catalog, tenant, 'en', at(12));
    expect(on.products.find((p) => p.id === IDS.burger)!.moods).toEqual(['hearty', 'share']);
    expect(on.products.find((p) => p.id === IDS.cheesecake)!.moods).toEqual(['sweet']);
    const off: TenantInfo = { ...tenant, features: { ...tenant.features, moodPicker: false } };
    expect(buildMenuView(catalog, off, 'en', at(12)).products.some((p) => p.moods !== undefined)).toBe(false);
  });

  it('names the live occasion that has a mood, with the days left, when the plan has occasion moods', () => {
    const occasions = [{ id: 'o-ramadan', startsOn: '2026-01-01', endsOn: '2099-01-01', isActive: true, mood: 'RAMADAN' as const, translations: { en: { name: 'Ramadan' } } }];
    const catalog = makeCatalog({ occasions });
    const view = buildMenuView(catalog, tenant, 'en', at(12));
    expect(view.occasion).toMatchObject({ mood: 'RAMADAN', name: 'Ramadan' });
    expect(view.occasion!.daysLeft).toBeGreaterThan(0);
    const off: TenantInfo = { ...tenant, features: { ...tenant.features, occasionMoods: false } };
    expect(buildMenuView(catalog, off, 'en', at(12)).occasion).toBeUndefined();
    expect(buildMenuView(makeCatalog({ occasions: [{ ...occasions[0]!, mood: undefined }] }), tenant, 'en', at(12)).occasion).toBeUndefined();
  });

  it('carries the running stories only on a plan that has them, and leaves the key out when there are none', () => {
    const stories = [{ id: 's1', image: { kind: 'image', url: '/x.webp', alt: '', width: 1, height: 1 } as never, caption: 'Fresh baklava', productSlug: null }];
    expect(buildMenuView(makeCatalog(), tenant, 'en', at(12), { stories }).stories).toEqual(stories);
    expect(buildMenuView(makeCatalog(), tenant, 'en', at(12), { stories: [] }).stories).toBeUndefined();
    expect(buildMenuView(makeCatalog(), tenant, 'en', at(12)).stories).toBeUndefined();
    const off: TenantInfo = { ...tenant, features: { ...tenant.features, stories: false } };
    expect(buildMenuView(makeCatalog(), off, 'en', at(12), { stories }).stories).toBeUndefined();
  });

  it('leaves the match out on a plan without drink match', () => {
    const off: TenantInfo = { ...tenant, features: { ...tenant.features, drinkMatch: false } };
    const view = buildMenuView(makeCatalog(), off, 'en', at(12));
    expect(view.products.some((p) => p.match !== undefined)).toBe(false);
  });

  it('groups products under ordered categories with localized text', () => {
    const view = buildMenuView(makeCatalog(), tenant, 'en', at(12));
    expect(view.categories.map((c) => c.slug)).toEqual(['coffee', 'breakfast', 'plates', 'patisserie', 'cold']);
    const burger = view.products.find((p) => p.id === IDS.burger)!;
    expect(burger.name).toBe(IDS.burger); // fixture names equal ids
    expect(burger.groups[0]?.options.map((o) => o.name)).toEqual(['Premium cheese', 'Double patty', 'Bacon']);
  });

  it('gives each category the dish of its first product with a 3D model, or a plate', () => {
    let catalog = withProduct(makeCatalog(), IDS.espresso, { media: [{ kind: 'art', art: 'cup', tone: '#6B4226' }] });
    // The croissant is breakfast-only and off the menu at noon; its category still shows its dish.
    catalog = withProduct(catalog, IDS.croissant, {
      media: [{ kind: 'art', art: 'pastry', tone: '#C98A3A', model: 'croissant' }],
    });
    const view = buildMenuView(catalog, tenant, 'en', at(12));
    expect(Object.fromEntries(view.categories.map((c) => [c.slug, c.dish]))).toEqual({
      coffee: 'cup',
      breakfast: 'croissant',
      plates: 'plate',
      patisserie: 'plate',
      cold: 'plate',
    });
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

describe('the sales tools on the menu', () => {
  const offer = (overrides: Partial<CatalogPromotion> = {}): CatalogPromotion => ({
    id: 'hh',
    kind: 'DISCOUNT',
    percentOff: 20,
    productIds: [IDS.burger],
    categoryIds: [],
    startsOn: null,
    endsOn: null,
    startMinute: 17 * 60,
    endMinute: 19 * 60,
    daysOfWeek: 127,
    roundTo: 5,
    translations: { en: { title: 'Happy hour', text: 'Burgers for less' } },
    sortOrder: 0,
    ...overrides,
  });
  const burgerOf = (view: ReturnType<typeof buildMenuView>) => view.products.find((p) => p.id === IDS.burger)!;
  const withSales = (sales: Partial<SalesSettings>, features: Partial<TenantInfo['features']> = {}): TenantInfo => ({
    ...tenant,
    engineConfig: { ...DEFAULT_ENGINE_CONFIG, sales: { ...DEFAULT_SALES_SETTINGS, ...sales } },
    features: { ...tenant.features, ...features },
  });

  it('shows the sale price beside the regular one during a discount, and neither after it', () => {
    const catalog = makeCatalog({ promotions: [offer()] });
    expect(burgerOf(buildMenuView(catalog, tenant, 'en', at(18)))).toMatchObject({ displayPrice: 720, regularPrice: 900, percentOff: 20, roundTo: 5 });
    const after = burgerOf(buildMenuView(catalog, tenant, 'en', at(20)));
    expect(after.displayPrice).toBe(900);
    expect(after).not.toHaveProperty('regularPrice');
    expect(after).not.toHaveProperty('percentOff');
  });

  it('lists the live offers in order with when they end, and names a special on its dishes', () => {
    const special = offer({ id: 'sp', kind: 'SPECIAL', percentOff: null, startMinute: null, endMinute: null, endsOn: '2026-10-17', translations: { en: { title: 'Chef special' } } });
    const autumn = offer({ id: 'far', kind: 'SPECIAL', percentOff: null, productIds: [IDS.fries], startMinute: null, endMinute: null, endsOn: '2026-12-31', sortOrder: 2, translations: { en: { title: 'Autumn' } } });
    const ended = offer({ id: 'gone', endsOn: '2026-10-01' });
    const view = buildMenuView(makeCatalog({ promotions: [offer(), special, autumn, ended] }), tenant, 'en', at(18));
    expect(view.offers).toEqual([
      { id: 'hh', kind: 'DISCOUNT', title: 'Happy hour', text: 'Burgers for less', percentOff: 20, endsAt: { time: '19:00' } },
      { id: 'sp', kind: 'SPECIAL', title: 'Chef special', text: IDS.burger, percentOff: null, endsAt: { date: '2026-10-17' } },
      { id: 'far', kind: 'SPECIAL', title: 'Autumn', text: IDS.fries, percentOff: null, endsAt: null },
    ]);
    expect(burgerOf(view).special).toBe('Chef special');
    expect(view.products.find((p) => p.id === IDS.espresso)).not.toHaveProperty('special');
  });

  it('never lists an offer whose dishes guests cannot see right now', () => {
    const breakfastOnly = withProduct(makeCatalog({ promotions: [offer({ productIds: [IDS.croissant], startMinute: null, endMinute: null })] }), IDS.croissant, {
      dayparts: ['BREAKFAST'],
      hideOutsideDaypart: true,
    });
    expect(buildMenuView(breakfastOnly, tenant, 'en', at(18)).offers).toEqual([]);
    expect(buildMenuView(breakfastOnly, tenant, 'en', at(8)).offers.map((o) => o.id)).toEqual(['hh']);
  });

  it('gives a dish its order and view counts only from its first paid order, and only when the menu shows them', () => {
    const on: TenantInfo = { ...tenant, extras: { ...tenant.extras, dishCounts: true } };
    const dishCounts = new Map([
      [IDS.burger, { orders: 5, views: 40 }],
      [IDS.fries, { orders: 0, views: 12 }],
    ]);
    const shown = buildMenuView(makeCatalog(), on, 'en', at(12), { dishCounts });
    expect(burgerOf(shown).counts).toEqual({ orders: 5, views: 40 });
    expect(shown.products.find((p) => p.id === IDS.fries)).not.toHaveProperty('counts');
    expect(shown.products.find((p) => p.id === IDS.espresso)).not.toHaveProperty('counts');
    expect(burgerOf(buildMenuView(makeCatalog(), tenant, 'en', at(12), { dishCounts }))).not.toHaveProperty('counts');
    expect(burgerOf(buildMenuView(makeCatalog(), on, 'en', at(12)))).not.toHaveProperty('counts');
  });

  it('marks the most ordered dishes only when the menu shows them and the plan includes it', () => {
    const extras = { mostOrdered: [IDS.burger] };
    expect(burgerOf(buildMenuView(makeCatalog(), tenant, 'en', at(12), extras)).mostOrdered).toBe(true);
    expect(view(makeCatalog(), withSales({ showMostOrdered: false }), extras)).not.toHaveProperty('mostOrdered');
    expect(view(makeCatalog(), withSales({}, { socialProof: false }), extras)).not.toHaveProperty('mostOrdered');
    expect(view(makeCatalog(), tenant)).not.toHaveProperty('mostOrdered');

    function view(catalog: ReturnType<typeof makeCatalog>, t: TenantInfo, e = {}) {
      return burgerOf(buildMenuView(catalog, t, 'en', at(12), e));
    }
  });

  it('says how few are left only from a real count at or below the threshold', () => {
    const low = withProduct(makeCatalog(), IDS.burger, { stockCount: 3, lowStockThreshold: 5 });
    expect(burgerOf(buildMenuView(low, tenant, 'en', at(12))).fewLeft).toBe(3);
    expect(burgerOf(buildMenuView(withProduct(low, IDS.burger, { stockCount: 6 }), tenant, 'en', at(12)))).not.toHaveProperty('fewLeft');
    expect(burgerOf(buildMenuView(withProduct(low, IDS.burger, { lowStockThreshold: null }), tenant, 'en', at(12)))).not.toHaveProperty('fewLeft');
    expect(burgerOf(buildMenuView(low, withSales({ showLowStock: false }), 'en', at(12)))).not.toHaveProperty('fewLeft');
    expect(burgerOf(buildMenuView(low, withSales({}, { socialProof: false }), 'en', at(12)))).not.toHaveProperty('fewLeft');
  });

  it('carries how many a dish serves, and the menu’s price style', () => {
    expect(burgerOf(buildMenuView(withProduct(makeCatalog(), IDS.burger, { serves: 4 }), tenant, 'en', at(12))).serves).toBe(4);
    expect(burgerOf(buildMenuView(makeCatalog(), tenant, 'en', at(12)))).not.toHaveProperty('serves');
    expect(buildMenuView(makeCatalog(), tenant, 'en', at(12)).priceStyle).toBe('symbol');
    expect(buildMenuView(makeCatalog(), withSales({ priceStyle: 'plain' }), 'en', at(12)).priceStyle).toBe('plain');
  });
});

describe('2b product fields', () => {
  it('carries badges, dietary tags and calories', () => {
    const catalog = withProduct(makeCatalog(), IDS.burger, { badges: ['NEW', 'POPULAR'], dietary: ['HALAL', 'SPICY'], calories: 640 });
    const burger = buildMenuView(catalog, tenant, 'en', at(12)).products.find((p) => p.id === IDS.burger)!;
    expect(burger).toMatchObject({ badges: ['NEW', 'POPULAR'], dietary: ['HALAL', 'SPICY'], calories: 640 });
    const espresso = buildMenuView(catalog, tenant, 'en', at(12)).products.find((p) => p.id === IDS.espresso)!;
    // Nothing is sent for what a product does not have.
    expect(espresso).not.toHaveProperty('badges');
    expect(espresso).not.toHaveProperty('dietary');
    expect(espresso).not.toHaveProperty('calories');
  });

  it('leaves out a tag the menu does not know', () => {
    const catalog = withProduct(makeCatalog(), IDS.burger, { badges: ['NEW', 'SPONSORED'], dietary: ['KETO', 'VEGAN'] });
    expect(buildMenuView(catalog, tenant, 'en', at(12)).products.find((p) => p.id === IDS.burger)).toMatchObject({ badges: ['NEW'], dietary: ['VEGAN'] });
  });

  it('gives a library photo the alt text of the page language, else the default one', () => {
    const photo = {
      kind: 'image',
      url: '/api/dev-media/r/r1/abc/webp-1080.webp',
      alt: 'Burger',
      alts: { en: 'Burger', ar: 'برغر' },
      width: 1200,
      height: 800,
    };
    const catalog = withProduct(makeCatalog(), IDS.burger, { media: [photo] });
    const altIn = (locale: 'en' | 'ar' | 'ckb') =>
      (buildMenuView(catalog, tenant, locale, at(12)).products.find((p) => p.id === IDS.burger)!.media[0] as { alt: string }).alt;
    expect(altIn('ar')).toBe('برغر');
    expect(altIn('en')).toBe('Burger');
    expect(altIn('ckb')).toBe('Burger');
  });
});
