import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getCatalog, getTenant } from '@/server/data/public-menu';
import { RAIL_STYLES } from '@/lib/rail';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, publishFixture, resetTestData, seedAtelier, testPrisma } from '../helpers/db';

// The public read path uses the app's client; point it at the test database.
process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

describe('what guests get on each plan', () => {
  let a: Awaited<ReturnType<typeof createMenuFixture>>;

  const setPlan = (restaurantId: string, plan: 'BASIC' | 'PRO' | 'PREMIUM', planExtras: object = {}) =>
    prisma.restaurant.update({ where: { id: restaurantId }, data: { plan, planExtras } });

  beforeEach(async () => {
    await resetTestData(prisma);
    a = await createMenuFixture(prisma, 'guest-plans', { publish: false });
    await prisma.brandConfig.create({
      data: { menuId: a.menu.id, tokens: {}, typography: {}, logoText: 'Zhamitos', railStyle: 'drum', fontPairId: 'fine', motionIntensity: 'expressive' },
    });
    await publishFixture(prisma, a.menu.id);
  });

  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('serves every feature on Premium, as before plans', async () => {
    const tenant = (await getTenant('guest-plans'))!;
    expect(tenant.brand).toMatchObject({ railStyle: 'drum', motionIntensity: 'expressive', fontPairId: 'fine' });
    expect(tenant.features).toEqual({ explore: true, stage: true, smartSelling: true, offers: true, socialProof: true, intro: true, about: true, wheel: true, dishCounts: true, drinkMatch: true, moodPicker: true, livingPhotos: true, occasionMoods: true, stories: true, models3d: true, ar: true, tableBasket: true, rails: [...RAIL_STYLES] });
  });

  it('serves a Basic menu with the fallbacks and the guest features off, without touching its revision', async () => {
    const before = await prisma.menu.findUniqueOrThrow({ where: { id: a.menu.id }, select: { liveRevisionId: true, liveHash: true, draftHash: true } });
    await setPlan(a.restaurant.id, 'BASIC');
    const tenant = (await getTenant('guest-plans'))!;
    expect(tenant.brand).toMatchObject({ railStyle: 'plain', motionIntensity: 'subtle' });
    expect(tenant.brand.fontPairId).toBeUndefined();
    expect(tenant.features).toEqual({ explore: true, stage: false, smartSelling: false, offers: false, socialProof: false, intro: true, about: false, wheel: false, dishCounts: false, drinkMatch: false, moodPicker: false, livingPhotos: false, occasionMoods: false, stories: false, models3d: false, ar: false, tableBasket: false, rails: ['plain'] });
    expect(await prisma.menu.findUniqueOrThrow({ where: { id: a.menu.id }, select: { liveRevisionId: true, liveHash: true, draftHash: true } })).toEqual(before);
  });

  it('serves timed offers only on a plan with them: without, every price is the regular one', async () => {
    await prisma.promotion.create({
      data: { menuId: a.menu.id, kind: 'DISCOUNT', percentOff: 50, productIds: [a.product.id], translations: { en: { title: 'Half price' } } },
    });
    await publishFixture(prisma, a.menu.id);
    expect((await getCatalog((await getTenant('guest-plans'))!)).promotions).toHaveLength(1);
    await setPlan(a.restaurant.id, 'BASIC');
    expect((await getCatalog((await getTenant('guest-plans'))!)).promotions).toEqual([]);
  });

  it('serves the deck on Pro for a menu that chose the melting dish', async () => {
    await prisma.brandConfig.update({ where: { menuId: a.menu.id }, data: { railStyle: 'grains' } });
    await publishFixture(prisma, a.menu.id);
    await setPlan(a.restaurant.id, 'PRO');
    expect((await getTenant('guest-plans'))!.brand.railStyle).toBe('deck');
  });

  it('follows an extra over the plan', async () => {
    await setPlan(a.restaurant.id, 'BASIC', { features: { 'immersive.stage': true } });
    expect((await getTenant('guest-plans'))!.features.stage).toBe(true);
  });

  it('follows the plans the platform owner set', async () => {
    await setPlan(a.restaurant.id, 'BASIC');
    await prisma.platformSetting.create({ data: { key: 'plans', value: { BASIC: { features: { 'immersive.stage': true } } } } });
    expect((await getTenant('guest-plans'))!.features.stage).toBe(true);
  });

  it('serves no upsell rules, pairings or bundles without smart selling', async () => {
    const atelier = await seedAtelier(prisma);
    const tenantOf = async () => (await getTenant('atelier'))!;
    const premium = await getCatalog(await tenantOf());
    expect(premium.bundles.length + premium.upsellRules.length + premium.pairingRules.length).toBeGreaterThan(0);
    await setPlan(atelier.restaurant.id, 'BASIC');
    const basic = await getCatalog(await tenantOf());
    expect([basic.bundles, basic.upsellRules, basic.pairingRules]).toEqual([[], [], []]);
    expect(basic.products.length).toBe(premium.products.length);
  });
});
