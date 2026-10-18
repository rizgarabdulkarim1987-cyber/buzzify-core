import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FONT_PAIRS } from '@/lib/font-pairs';
import { BRAND_PRESETS, paletteProblems } from '@/lib/palette';
import { validateForPublish } from '@/server/domain/publish-rules';
import { loadDraftSnapshot } from '@/server/publish/draft';
import { seedMenu } from '../../prisma/seed/apply';
import { ATELIER, type SeedData } from '../../prisma/seed/atelier';
import { demoRestaurant } from '../../prisma/seed/demo-restaurant';
import { HOT_BRICK } from '../../prisma/seed/hot-brick';
import { RIVERLIGHT } from '../../prisma/seed/riverlight';
import { validateSeed } from '../../prisma/seed/validate';
import { requireTestDb, resetTestData, testPrisma } from '../helpers/db';

const prisma = testPrisma();

beforeAll(async () => {
  requireTestDb();
  await resetTestData(prisma);
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

const DEMOS: Array<[string, SeedData]> = [
  ['Riverlight Coffee', RIVERLIGHT],
  ['Hot Brick Burgers', HOT_BRICK],
];

describe('the demo restaurants', () => {
  it('puts the three demos on the three plans, and leaves a demo that exists on its plan', async () => {
    await resetTestData(prisma);
    const plans = [];
    for (const demo of [ATELIER, RIVERLIGHT, HOT_BRICK]) plans.push((await demoRestaurant(prisma, demo)).plan);
    expect(plans).toEqual(['PREMIUM', 'PRO', 'BASIC']);

    const hotBrick = await prisma.restaurant.findFirstOrThrow({ where: { name: HOT_BRICK.profile.name } });
    await prisma.restaurant.update({ where: { id: hotBrick.id }, data: { plan: 'PREMIUM' } });
    expect(await demoRestaurant(prisma, HOT_BRICK)).toMatchObject({ id: hotBrick.id, plan: 'PREMIUM' });
  });
});

describe.each(DEMOS)('%s', (name, seed) => {
  it('passes every integrity check', () => {
    expect(validateSeed(seed)).toEqual([]);
  });

  it('has 10 to 14 products in every category, each named and described in all three languages', () => {
    expect(seed.profile.name).toBe(name);
    expect(seed.products.length).toBeGreaterThanOrEqual(10);
    expect(seed.products.length).toBeLessThanOrEqual(14);
    for (const category of seed.categories) expect(seed.products.some((product) => product.category === category.slug), category.slug).toBe(true);
    for (const product of seed.products) {
      for (const locale of ['en', 'ar', 'ckb'] as const) expect(product.name[locale].trim(), `${product.slug} ${locale}`).not.toBe('');
    }
  });

  it('has palettes with no blocking pair in either theme', () => {
    expect(paletteProblems(seed.brand.tokens.light).filter((problem) => problem.severity === 'block')).toEqual([]);
    expect(paletteProblems(seed.brand.tokens.dark).filter((problem) => problem.severity === 'block')).toEqual([]);
  });

  it('names its typefaces by its font pair', () => {
    const pair = FONT_PAIRS[seed.brand.fontPairId];
    expect(seed.brand.typography).toEqual({ display: pair.display, text: pair.text, arabic: pair.arabic });
  });

  it('publishes with no blocking issue', async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: seed.profile.name, type: seed.profile.type, city: seed.profile.city } });
    const { menuId } = await seedMenu(prisma, seed, restaurant.id);
    const snapshot = await loadDraftSnapshot(prisma, menuId);
    expect(validateForPublish(snapshot).filter((issue) => issue.severity === 'block')).toEqual([]);
    expect((await prisma.brandConfig.findUniqueOrThrow({ where: { menuId } })).fontPairId).toBe(seed.brand.fontPairId);
  });
});

describe('Riverlight Coffee', () => {
  it('is a light café in Erbil, in English first, with the Coffee preset, the café pair and the drum rail', () => {
    expect(RIVERLIGHT.profile).toMatchObject({ type: 'CAFE', city: 'Erbil', country: 'Iraq' });
    expect(RIVERLIGHT.restaurant).toMatchObject({ slug: 'riverlight', currency: 'USD', defaultLocale: 'en', locales: ['en', 'ar', 'ckb'] });
    expect(RIVERLIGHT.brand).toMatchObject({ theme: 'LIGHT', fontPairId: 'cafe', railStyle: 'drum', motionIntensity: 'subtle' });
    expect(RIVERLIGHT.brand.tokens.light).toEqual(BRAND_PRESETS.coffee.light);
    expect(RIVERLIGHT.categories).toHaveLength(3);
  });

  it('offers sizes on its milk drinks, and marks what is true of each product', () => {
    const milky = RIVERLIGHT.products.filter((product) => product.allergens.includes('milk') && product.category === RIVERLIGHT.categories[0]!.slug);
    expect(milky.length).toBeGreaterThan(0);
    for (const product of milky) expect(product.variants?.filter((variant) => variant.isDefault), product.slug).toHaveLength(1);
    expect(RIVERLIGHT.products.some((product) => (product.dietary ?? []).includes('VEGAN'))).toBe(true);
    expect(RIVERLIGHT.products.some((product) => (product.badges ?? []).length > 0)).toBe(true);
  });
});

describe('Hot Brick Burgers', () => {
  it('is a dark fast-food place in Sulaymaniyah, in Sorani first, with the Fast food preset, the street pair and the flap rail', () => {
    expect(HOT_BRICK.profile).toMatchObject({ type: 'FAST_FOOD', city: 'Sulaymaniyah', country: 'Iraq' });
    expect(HOT_BRICK.restaurant).toMatchObject({ slug: 'hot-brick', currency: 'IQD', defaultLocale: 'ckb', locales: ['ckb', 'ar', 'en'] });
    expect(HOT_BRICK.brand).toMatchObject({ theme: 'DARK', fontPairId: 'street', railStyle: 'flap', motionIntensity: 'expressive' });
    expect(HOT_BRICK.brand.tokens.dark).toEqual(BRAND_PRESETS.fastFood.dark);
  });

  it('prices everything in multiples of 250 dinars, sizes and extras included', () => {
    const amounts = HOT_BRICK.products.flatMap((product) => [
      product.price,
      ...(product.variants ?? []).map((variant) => variant.priceDelta),
      ...(product.groups ?? []).flatMap((group) => group.options.map((option) => option.priceDelta)),
    ]);
    for (const amount of amounts) expect(amount % 250, String(amount)).toBe(0);
    for (const bundle of HOT_BRICK.bundles) expect(bundle.price % 250).toBe(0);
  });

  it('has extra cheese and an extra patty on its burgers, and sizes of fries', () => {
    const burgers = HOT_BRICK.products.filter((product) => product.art === 'burger');
    expect(burgers.length).toBeGreaterThan(0);
    for (const burger of burgers) {
      const extras = burger.groups!.flatMap((group) => group.options);
      expect(extras.find((option) => option.visualKey === 'cheese')?.priceDelta).toBe(1_000);
      expect(extras.find((option) => option.visualKey === 'patty')?.priceDelta).toBe(3_000);
    }
    const fries = HOT_BRICK.products.find((product) => product.slug === 'fries')!;
    expect(fries.variants!.length).toBeGreaterThanOrEqual(2);
  });
});
