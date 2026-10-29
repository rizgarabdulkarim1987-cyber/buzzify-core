import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getCatalog, getTenant, resolvePublicMenu } from '@/server/data/public-menu';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, publishFixture, resetTestData, testPrisma } from '../helpers/db';

// The public read path uses the app's client; point it at the test database.
process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

describe('public menu read path', () => {
  let a: Awaited<ReturnType<typeof createMenuFixture>>;
  let b: Awaited<ReturnType<typeof createMenuFixture>>;

  beforeEach(async () => {
    await resetTestData(prisma);
    a = await createMenuFixture(prisma, 'public-a');
    b = await createMenuFixture(prisma, 'public-b');
  });

  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('serves a published menu from its live revision', async () => {
    expect(await resolvePublicMenu('public-a')).toEqual({
      kind: 'live',
      tenant: expect.objectContaining({
        id: a.menu.id,
        restaurantId: a.restaurant.id,
        revisionId: a.menu.liveRevisionId,
        slug: 'public-a',
        name: 'Restaurant public-a',
        currency: 'USD',
        defaultLocale: 'en',
        locales: ['en', 'ar', 'ckb'],
        timeZone: 'Asia/Baghdad',
        numeralSystem: 'latn',
      }),
    });
    const tenant = await getTenant('public-a');
    expect(tenant?.brand).toMatchObject({ logoText: 'Restaurant public-a', theme: 'dark', motionIntensity: 'subtle' });
    const catalog = await getCatalog(tenant!);
    expect(catalog.menuId).toBe(a.menu.id);
    expect(catalog.products.map((p) => p.id)).toEqual([a.product.id]);
  });

  it('carries the extras gate: off until the menu switches them on, and only while the plan holds them', async () => {
    const x = await createMenuFixture(prisma, 'public-extras');
    const before = await resolvePublicMenu('public-extras');
    expect(before.kind === 'live' && before.tenant.extras).toEqual({ intro: false, about: false, wheel: false, dishCounts: false, aboutTitle: { en: '', ar: '', ckb: '' } });
    await prisma.menu.update({ where: { id: x.menu.id }, data: { introEnabled: true, wheelEnabled: true } });
    await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { plan: 'PREMIUM' } });
    const { expireMenu } = await import('@/server/data/cache');
    expireMenu(['public-extras'], x.menu.id);
    const on = await resolvePublicMenu('public-extras');
    expect(on.kind === 'live' && on.tenant.extras).toMatchObject({ intro: true, about: false, wheel: true });
    await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { plan: 'BASIC' } });
    expireMenu(['public-extras'], x.menu.id);
    const basic = await resolvePublicMenu('public-extras');
    expect(basic.kind === 'live' && basic.tenant.extras).toMatchObject({ intro: false, wheel: false });
  });

  it('does not show draft edits until the next publish', async () => {
    await prisma.product.update({ where: { id: a.product.id }, data: { basePrice: 999 } });
    const tenant = await getTenant(a.menu.slug);
    expect((await getCatalog(tenant!)).products[0]!.basePrice).toBe(300);

    await publishFixture(prisma, a.menu.id);
    expect((await getCatalog((await getTenant(a.menu.slug))!)).products[0]!.basePrice).toBe(999);
  });

  it('takes settings and brand from the live revision, not the draft', async () => {
    await prisma.menu.update({ where: { id: a.menu.id }, data: { currency: 'IQD', locales: ['en', 'ar'] } });
    await prisma.restaurant.update({ where: { id: a.restaurant.id }, data: { name: 'Renamed' } });
    expect(await getTenant('public-a')).toMatchObject({ currency: 'USD', name: 'Restaurant public-a', locales: ['en', 'ar', 'ckb'] });

    await publishFixture(prisma, a.menu.id);
    expect(await getTenant('public-a')).toMatchObject({ currency: 'IQD', name: 'Renamed', locales: ['en', 'ar'] });
  });

  it('shows sold-out at once without a publish', async () => {
    await prisma.product.update({ where: { id: a.product.id }, data: { isAvailable: false } });
    expect((await getCatalog((await getTenant(a.menu.slug))!)).products[0]!.isAvailable).toBe(false);
  });

  it('shows stock and sold-out options at once without a publish', async () => {
    const group = await prisma.modifierGroup.create({
      data: { menuId: a.menu.id, productId: a.product.id, translations: { en: { name: 'Milk' } } },
    });
    const option = await prisma.modifierOption.create({
      data: { menuId: a.menu.id, groupId: group.id, translations: { en: { name: 'Oat' } } },
    });
    await publishFixture(prisma, a.menu.id);
    await prisma.product.update({ where: { id: a.product.id }, data: { stockCount: 3 } });
    await prisma.modifierOption.update({ where: { id: option.id }, data: { isAvailable: false } });

    const product = (await getCatalog((await getTenant(a.menu.slug))!)).products[0]!;
    expect(product.stockCount).toBe(3);
    expect(product.groups[0]!.options[0]).toMatchObject({ id: option.id, isAvailable: false });
  });

  it('never serves a hidden product', async () => {
    const second = await prisma.product.create({
      data: { menuId: a.menu.id, categoryId: a.category.id, slug: 'public-a-latte', basePrice: 450, translations: { en: { name: 'Latte' } } },
    });
    await publishFixture(prisma, a.menu.id);
    await prisma.product.update({ where: { id: second.id }, data: { isHidden: true } });
    const catalog = await getCatalog((await getTenant(a.menu.slug))!);
    expect(catalog.products.map((p) => p.id)).toEqual([a.product.id]);
  });

  it("never returns another menu's products", async () => {
    const catalog = await getCatalog((await getTenant('public-b'))!);
    expect(catalog.menuId).toBe(b.menu.id);
    expect(catalog.products.map((p) => p.id)).toEqual([b.product.id]);
  });

  it('resolves a historical slug as a redirect to the current one', async () => {
    await prisma.menu.update({ where: { id: a.menu.id }, data: { slug: 'public-a-renamed' } });
    await prisma.menuSlug.create({ data: { slug: 'public-a-renamed', menuId: a.menu.id } });

    const old = await resolvePublicMenu('public-a');
    expect(old).toMatchObject({ kind: 'redirect', slug: 'public-a-renamed', tenant: { id: a.menu.id, slug: 'public-a-renamed' } });
    expect(await resolvePublicMenu('public-a-renamed')).toMatchObject({ kind: 'live', tenant: { id: a.menu.id } });
    // The pricing APIs keep working for links that still carry the old slug.
    expect((await getTenant('public-a'))?.id).toBe(a.menu.id);
  });

  it('is missing for a never-published menu and unavailable for a suspended one', async () => {
    await createMenuFixture(prisma, 'public-draft', { publish: false });
    expect(await resolvePublicMenu('public-draft')).toEqual({ kind: 'missing' });
    expect(await getTenant('public-draft')).toBeNull();

    await prisma.menu.update({ where: { id: a.menu.id }, data: { status: 'SUSPENDED' } });
    expect(await resolvePublicMenu('public-a')).toEqual({
      kind: 'unavailable',
      menuId: a.menu.id,
      name: 'Restaurant public-a',
      defaultLocale: 'en',
      locales: ['en', 'ar', 'ckb'],
    });
    expect(await getTenant('public-a')).toBeNull();
  });

  it('is unavailable for an archived menu that was published', async () => {
    await prisma.menu.update({ where: { id: a.menu.id }, data: { status: 'ARCHIVED', statusBeforeArchive: 'PUBLISHED' } });
    expect(await resolvePublicMenu('public-a')).toMatchObject({ kind: 'unavailable' });
    expect(await getTenant('public-a')).toBeNull();
  });

  it('is missing for an archived menu that was never published', async () => {
    const draft = await createMenuFixture(prisma, 'public-archived', { publish: false });
    await prisma.menu.update({ where: { id: draft.menu.id }, data: { status: 'ARCHIVED' } });
    expect(await resolvePublicMenu('public-archived')).toEqual({ kind: 'missing' });
  });

  it('is unavailable when the restaurant is suspended or archived', async () => {
    for (const status of ['SUSPENDED', 'ARCHIVED'] as const) {
      await prisma.restaurant.update({ where: { id: a.restaurant.id }, data: { status } });
      expect(await resolvePublicMenu('public-a'), status).toMatchObject({ kind: 'unavailable', name: 'Restaurant public-a' });
      expect(await getTenant('public-a'), status).toBeNull();
    }
    await prisma.restaurant.update({ where: { id: a.restaurant.id }, data: { status: 'ACTIVE' } });
    expect(await resolvePublicMenu('public-a')).toMatchObject({ kind: 'live' });
  });

  describe('the Menu subscription', () => {
    const DAY = 86_400_000;
    const subscribe = async (status: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'CANCELLED', periodEnd = Date.now() + 25 * DAY) => {
      await prisma.application.upsert({ where: { id: 'menu' }, create: { id: 'menu', name: { en: 'Menu' } }, update: {} });
      await prisma.subscription.deleteMany({ where: { restaurantId: a.restaurant.id } });
      await prisma.subscription.create({
        data: {
          restaurantId: a.restaurant.id,
          applicationId: 'menu',
          planCode: 'pro',
          status,
          period: 'MONTHLY',
          currency: 'IQD',
          priceMinor: 0,
          currentPeriodStart: new Date(periodEnd - 30 * DAY),
          currentPeriodEnd: new Date(periodEnd),
          trialEndsAt: status === 'TRIAL' ? new Date(periodEnd) : null,
          version: 1,
        },
      });
    };

    it('keeps serving a restaurant that has never had one', async () => {
      expect(await resolvePublicMenu('public-a')).toMatchObject({ kind: 'live' });
    });

    it('serves while it is on trial, active or in grace', async () => {
      for (const status of ['TRIAL', 'ACTIVE', 'GRACE'] as const) {
        await subscribe(status);
        expect(await resolvePublicMenu('public-a'), status).toMatchObject({ kind: 'live' });
      }
    });

    it('closes the menu once it is cancelled or expired', async () => {
      for (const status of ['CANCELLED', 'EXPIRED'] as const) {
        await subscribe(status);
        expect(await resolvePublicMenu('public-a'), status).toMatchObject({ kind: 'unavailable', name: 'Restaurant public-a' });
        expect(await getTenant('public-a'), status).toBeNull();
      }
      expect(await resolvePublicMenu('public-b')).toMatchObject({ kind: 'live' });
    });

    it('closes the menu when the period has run out, before the sweep has stored it', async () => {
      await subscribe('TRIAL', Date.now() - DAY);
      expect(await resolvePublicMenu('public-a')).toMatchObject({ kind: 'unavailable' });
    });
  });

  it('is missing for unknown, malformed and tombstoned slugs', async () => {
    await prisma.menuSlug.create({ data: { slug: 'public-gone', menuId: null } });
    for (const slug of ['nope', '', "x'; DROP TABLE", 'UPPER', '-lead', 'a'.repeat(49), 'public-gone']) {
      expect(await resolvePublicMenu(slug), slug).toEqual({ kind: 'missing' });
      expect(await getTenant(slug), slug).toBeNull();
    }
  });
});
