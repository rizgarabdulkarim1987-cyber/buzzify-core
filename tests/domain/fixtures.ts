import { DEFAULT_PALETTES } from '@/lib/brand';
import type { BrandView } from '@/server/data/tenant';
import { DEFAULT_ENGINE_CONFIG } from '@/server/domain/config';
import { buildSnapshot, type MenuSnapshot, type SnapshotMenu } from '@/server/domain/snapshot';
import type {
  Bundle,
  Catalog,
  CatalogProduct,
  DaypartWindow,
  PairingRule,
  UpsellRule,
} from '@/server/domain/types';

export const WINDOWS: DaypartWindow[] = [
  { daypart: 'BREAKFAST', startMinute: 420, endMinute: 660, daysOfWeek: 127 },
  { daypart: 'LUNCH', startMinute: 660, endMinute: 960, daysOfWeek: 127 },
  { daypart: 'DINNER', startMinute: 960, endMinute: 1320, daysOfWeek: 127 },
  { daypart: 'LATE_NIGHT', startMinute: 1320, endMinute: 180, daysOfWeek: 127 },
];

/** Local time in Asia/Baghdad (UTC+3, no daylight saving) on Thursday 2026-10-15. */
export function at(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 9, 15, hour - 3, minute));
}

export function product(overrides: Partial<CatalogProduct> & Pick<CatalogProduct, 'id'>): CatalogProduct {
  return {
    categoryId: 'cat-plates',
    slug: overrides.id,
    basePrice: 1000,
    cost: 300,
    popularity: 50,
    priority: 50,
    isSignature: false,
    isFeatured: false,
    isAvailable: true,
    isHidden: false,
    stockCount: null,
    lowStockThreshold: null,
    dayparts: [],
    hideOutsideDaypart: false,
    slot: null,
    translations: { en: { name: overrides.id, description: '' } },
    groups: [],
    variants: [],
    media: [],
    allergens: [],
    dietary: [],
    calories: null,
    badges: [],
    ingredients: {},
    sortOrder: 0,
    ...overrides,
  };
}

export const IDS = {
  espresso: 'p-espresso',
  burger: 'p-burger',
  wagyu: 'p-wagyu',
  fries: 'p-fries',
  sparkling: 'p-sparkling',
  croissant: 'p-croissant',
  cheesecake: 'p-cheesecake',
  steak: 'p-steak',
  caviar: 'p-caviar',
  coldBrew: 'p-coldbrew',
  optCheese: 'o-cheese',
  optDouble: 'o-double',
  optBacon: 'o-bacon',
  optShot: 'o-shot',
  optRare: 'o-rare',
  optWell: 'o-well',
  varRegular: 'v-regular',
  varLarge: 'v-large',
  groupAddons: 'g-addons',
  groupDoneness: 'g-doneness',
  groupExtras: 'g-extras',
} as const;

const products: CatalogProduct[] = [
  product({
    id: IDS.espresso,
    categoryId: 'cat-coffee',
    basePrice: 300,
    cost: 45,
    popularity: 80,
    slot: 'DRINK',
    groups: [
      {
        id: IDS.groupExtras,
        productId: IDS.espresso,
        minSelect: 0,
        maxSelect: 1,
        translations: { en: { name: 'Extras' } },
        options: [
          {
            id: IDS.optShot,
            groupId: IDS.groupExtras,
            priceDelta: 100,
            costDelta: 20,
            isSuggested: true,
            suggestPriority: 60,
            visualKey: null,
            isAvailable: true,
            translations: { en: { name: 'Extra shot', effect: 'A second shot of espresso' } },
          },
        ],
      },
    ],
  }),
  product({
    id: IDS.burger,
    basePrice: 900,
    cost: 310,
    popularity: 75,
    slot: 'MAIN',
    groups: [
      {
        id: IDS.groupAddons,
        productId: IDS.burger,
        minSelect: 0,
        maxSelect: 2,
        translations: { en: { name: 'Make it yours' } },
        options: [
          {
            id: IDS.optCheese,
            groupId: IDS.groupAddons,
            priceDelta: 100,
            costDelta: 35,
            isSuggested: true,
            suggestPriority: 70,
            visualKey: 'cheese',
            isAvailable: true,
            translations: { en: { name: 'Premium cheese', effect: 'Aged cheddar, melted' } },
          },
          {
            id: IDS.optDouble,
            groupId: IDS.groupAddons,
            priceDelta: 300,
            costDelta: 160,
            isSuggested: true,
            suggestPriority: 85,
            visualKey: 'patty',
            isAvailable: true,
            translations: { en: { name: 'Double patty', effect: 'A second 140 g beef patty' } },
          },
          {
            id: IDS.optBacon,
            groupId: IDS.groupAddons,
            priceDelta: 150,
            costDelta: 60,
            isSuggested: false,
            suggestPriority: 50,
            visualKey: 'bacon',
            isAvailable: true,
            translations: { en: { name: 'Bacon' } },
          },
        ],
      },
    ],
  }),
  product({ id: IDS.wagyu, basePrice: 1300, cost: 590, popularity: 60, slot: 'MAIN' }),
  product({ id: IDS.fries, basePrice: 550, cost: 120, popularity: 70, slot: 'SIDE' }),
  product({ id: IDS.sparkling, categoryId: 'cat-cold', basePrice: 300, cost: 60, popularity: 55, slot: 'DRINK' }),
  product({
    id: IDS.croissant,
    categoryId: 'cat-breakfast',
    basePrice: 350,
    cost: 80,
    popularity: 85,
    slot: 'BAKERY',
    dayparts: ['BREAKFAST'],
  }),
  product({ id: IDS.cheesecake, categoryId: 'cat-pastry', basePrice: 750, cost: 190, popularity: 65, slot: 'DESSERT' }),
  product({
    id: IDS.steak,
    basePrice: 2800,
    cost: 1150,
    popularity: 50,
    slot: 'MAIN',
    groups: [
      {
        id: IDS.groupDoneness,
        productId: IDS.steak,
        minSelect: 1,
        maxSelect: 1,
        translations: { en: { name: 'Doneness' } },
        options: [
          {
            id: IDS.optRare,
            groupId: IDS.groupDoneness,
            priceDelta: 0,
            costDelta: 0,
            isSuggested: false,
            suggestPriority: 0,
            visualKey: null,
            isAvailable: true,
            translations: { en: { name: 'Rare' } },
          },
          {
            id: IDS.optWell,
            groupId: IDS.groupDoneness,
            priceDelta: 0,
            costDelta: 0,
            isSuggested: false,
            suggestPriority: 0,
            visualKey: null,
            isAvailable: true,
            translations: { en: { name: 'Well done' } },
          },
        ],
      },
    ],
  }),
  // Very high margin and priority, but no rule relates it to anything: it must never be recommended.
  product({ id: IDS.caviar, basePrice: 4000, cost: 400, popularity: 20, priority: 95, slot: 'STARTER' }),
  product({
    id: IDS.coldBrew,
    categoryId: 'cat-cold',
    basePrice: 500,
    cost: 90,
    popularity: 60,
    slot: 'DRINK',
    variants: [
      {
        id: IDS.varRegular,
        productId: IDS.coldBrew,
        priceDelta: 0,
        costDelta: 0,
        isDefault: true,
        translations: { en: { name: 'Regular 350 ml' } },
      },
      {
        id: IDS.varLarge,
        productId: IDS.coldBrew,
        priceDelta: 150,
        costDelta: 40,
        isDefault: false,
        translations: { en: { name: 'Large 500 ml' } },
      },
    ],
  }),
];

const upsellRules: UpsellRule[] = [
  {
    id: 'u-wagyu',
    sourceProductId: IDS.burger,
    targetProductId: IDS.wagyu,
    priority: 80,
    dayparts: [],
    translations: { en: { pitch: 'Wagyu burger', effect: 'Wagyu beef patty on a toasted brioche bun' } },
  },
];

const pairingRules: PairingRule[] = [
  {
    id: 'r-burger-fries',
    sourceType: 'PRODUCT',
    sourceProductId: IDS.burger,
    sourceCategoryId: null,
    targetProductId: IDS.fries,
    weight: 90,
    dayparts: [],
    translations: { en: { reason: 'Crisp and salted, the classic partner' } },
  },
  {
    id: 'r-burger-sparkling',
    sourceType: 'PRODUCT',
    sourceProductId: IDS.burger,
    sourceCategoryId: null,
    targetProductId: IDS.sparkling,
    weight: 50,
    dayparts: [],
    translations: { en: { reason: 'Something cold alongside' } },
  },
  {
    id: 'r-steak-fries',
    sourceType: 'PRODUCT',
    sourceProductId: IDS.steak,
    sourceCategoryId: null,
    targetProductId: IDS.fries,
    weight: 85,
    dayparts: [],
    translations: { en: { reason: 'A side for the steak' } },
  },
  {
    id: 'r-coffee-croissant',
    sourceType: 'CATEGORY',
    sourceProductId: null,
    sourceCategoryId: 'cat-coffee',
    targetProductId: IDS.croissant,
    weight: 85,
    dayparts: [],
    translations: { en: { reason: 'Pairs with your coffee' } },
  },
  {
    id: 'r-coffee-cheesecake',
    sourceType: 'CATEGORY',
    sourceProductId: null,
    sourceCategoryId: 'cat-coffee',
    targetProductId: IDS.cheesecake,
    weight: 55,
    dayparts: [],
    translations: { en: { reason: 'Something sweet with it' } },
  },
  {
    id: 'r-pastry-espresso',
    sourceType: 'CATEGORY',
    sourceProductId: null,
    sourceCategoryId: 'cat-pastry',
    targetProductId: IDS.espresso,
    weight: 70,
    dayparts: [],
    translations: { en: { reason: 'An espresso to go with it' } },
  },
];

const bundles: Bundle[] = [
  {
    id: 'b-breakfast',
    slug: 'breakfast-set',
    price: 600,
    dayparts: ['BREAKFAST'],
    translations: { en: { name: 'Breakfast set', description: 'Croissant and espresso' } },
    items: [
      { productId: IDS.croissant, variantId: null, quantity: 1 },
      { productId: IDS.espresso, variantId: null, quantity: 1 },
    ],
  },
  {
    id: 'b-burger-meal',
    slug: 'burger-meal',
    price: 1500,
    dayparts: [],
    translations: { en: { name: 'Burger meal', description: 'Burger, fries and sparkling water' } },
    items: [
      { productId: IDS.burger, variantId: null, quantity: 1 },
      { productId: IDS.fries, variantId: null, quantity: 1 },
      { productId: IDS.sparkling, variantId: null, quantity: 1 },
    ],
  },
  {
    // Not a deal: 900 + 550 = 1450 individually, bundle price 1450.
    id: 'b-not-a-deal',
    slug: 'no-saving',
    price: 1450,
    dayparts: [],
    translations: { en: { name: 'No saving' } },
    items: [
      { productId: IDS.burger, variantId: null, quantity: 1 },
      { productId: IDS.fries, variantId: null, quantity: 1 },
    ],
  },
];

export function makeCatalog(overrides: Partial<Catalog> = {}): Catalog {
  return {
    menuId: 'm-test',
    currency: 'USD',
    timeZone: 'Asia/Baghdad',
    defaultLocale: 'en',
    categories: [
      { id: 'cat-coffee', slug: 'coffee', sortOrder: 0, translations: { en: { name: 'Coffee' } } },
      { id: 'cat-breakfast', slug: 'breakfast', sortOrder: 1, translations: { en: { name: 'Breakfast' } } },
      { id: 'cat-plates', slug: 'plates', sortOrder: 2, translations: { en: { name: 'Plates' } } },
      { id: 'cat-pastry', slug: 'patisserie', sortOrder: 3, translations: { en: { name: 'Patisserie' } } },
      { id: 'cat-cold', slug: 'cold', sortOrder: 4, translations: { en: { name: 'Cold' } } },
    ],
    products,
    upsellRules,
    pairingRules,
    bundles,
    schedule: WINDOWS,
    ...overrides,
  };
}

export function withProduct(catalog: Catalog, id: string, patch: Partial<CatalogProduct>): Catalog {
  return {
    ...catalog,
    products: catalog.products.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  };
}

export function makeMenu(overrides: Partial<SnapshotMenu> = {}): SnapshotMenu {
  return {
    name: 'Main menu',
    displayName: 'Test Cafe',
    currency: 'USD',
    defaultLocale: 'en',
    locales: ['en'],
    timeZone: 'Asia/Baghdad',
    numeralSystem: 'latn',
    engineConfig: DEFAULT_ENGINE_CONFIG,
    seo: {},
    ...overrides,
  };
}

export function makeBrand(overrides: Partial<BrandView> = {}): BrandView {
  return {
    logoText: 'Test Cafe',
    theme: 'dark',
    motionIntensity: 'subtle',
    railStyle: 'grains',
    tokens: { dark: DEFAULT_PALETTES.dark, light: DEFAULT_PALETTES.light },
    ...overrides,
  };
}

/** The frozen form of the catalog given, or of `makeCatalog()`. */
export function makeSnapshot(catalog: Catalog = makeCatalog(), menu: Partial<SnapshotMenu> = {}): MenuSnapshot {
  return buildSnapshot({ menu: makeMenu(menu), brand: makeBrand(), catalog });
}
