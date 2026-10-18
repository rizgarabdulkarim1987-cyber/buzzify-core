import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { loadDraftSnapshot } from '@/server/publish/draft';
import * as sales from '@/server/studio/actions/sales';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as salesQueries from '@/server/studio/queries/sales';
import { loadDraftCatalog } from '@/server/data/catalog-loader';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, publishFixture, requireTestDb, resetTestData } from '../helpers/db';

const prisma = () => getPrisma();
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};

let a: Awaited<ReturnType<typeof createMenuFixture>>;
let b: Awaited<ReturnType<typeof createMenuFixture>>;
let owner: Actor;
let latte: string;
let cake: string;
let cakes: string;

const run = <I, O>(def: ActionDef<I, O>, input: unknown, actor: Actor = owner) => runAction(prisma(), actor, def, input, META);
const rules = (actor: Actor = owner) => runQuery(prisma(), actor, salesQueries.rules, { menuId: a.menu.id });
const auditActions = async () => (await prisma().auditLog.findMany({ orderBy: { occurredAt: 'asc' } })).map((row) => row.action);

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'sales-a');
  b = await createMenuFixture(prisma(), 'sales-b');
  latte = (await prisma().product.create({ data: { menuId: a.menu.id, categoryId: a.category.id, slug: 'latte', basePrice: 450, translations: { en: { name: 'Latte' } } } })).id;
  cakes = (await prisma().category.create({ data: { menuId: a.menu.id, slug: 'cakes', sortOrder: 1, translations: { en: { name: 'Cakes' } } } })).id;
  cake = (await prisma().product.create({ data: { menuId: a.menu.id, categoryId: cakes, slug: 'cake', basePrice: 500, translations: { en: { name: 'Cake' } } } })).id;
  await prisma().user.create({ data: { id: 'owner-a', name: 'Alpha Owner', email: 'owner-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'owner-a', restaurantId: a.restaurant.id, role: 'OWNER' } });
  owner = (await loadActor(prisma(), 'owner-a')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
});

const upgrade = (overrides: Record<string, unknown> = {}) => ({
  menuId: a.menu.id,
  sourceProductId: a.product.id,
  targetProductId: latte,
  pitch: { en: 'Make it a latte', ar: 'اجعلها لاتيه' },
  effect: { en: 'Steamed milk and a double shot' },
  priority: 75,
  dayparts: ['BREAKFAST'],
  isActive: true,
  ...overrides,
});

describe('upgrade rules', () => {
  it('creates a rule the published menu carries, and audits it', async () => {
    const saved = dataOf(await run(sales.saveUpgrade, upgrade()));
    expect(saved.version).toBe(1);
    const row = await prisma().upsellRule.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row).toMatchObject({
      sourceProductId: a.product.id,
      targetProductId: latte,
      priority: 75,
      dayparts: ['BREAKFAST'],
      isActive: true,
      translations: { en: { pitch: 'Make it a latte', effect: 'Steamed milk and a double shot' }, ar: { pitch: 'اجعلها لاتيه' } },
    });
    const draft = await loadDraftSnapshot(prisma(), a.menu.id);
    expect(draft.catalog.upsellRules.map((rule) => rule.id)).toEqual([saved.id]);
    const menu = await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } });
    expect(menu.draftHash).not.toBe(menu.liveHash);
    expect(await auditActions()).toContain('upgrade.created');
  });

  it('edits a rule at the version read and refuses an older one', async () => {
    const saved = dataOf(await run(sales.saveUpgrade, upgrade()));
    const edited = dataOf(await run(sales.saveUpgrade, upgrade({ ruleId: saved.id, version: 1, priority: 100, isActive: false })));
    expect(edited.version).toBe(2);
    expect(await prisma().upsellRule.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ priority: 100, isActive: false, version: 2 });
    expect(failureOf(await run(sales.saveUpgrade, upgrade({ ruleId: saved.id, version: 1 }))).code).toBe('CONFLICT');
    expect(await auditActions()).toContain('upgrade.updated');
  });

  it('deletes a rule at its version', async () => {
    const saved = dataOf(await run(sales.saveUpgrade, upgrade()));
    expect(failureOf(await run(sales.deleteUpgrade, { menuId: a.menu.id, ruleId: saved.id, version: 3 })).code).toBe('CONFLICT');
    dataOf(await run(sales.deleteUpgrade, { menuId: a.menu.id, ruleId: saved.id, version: 1 }));
    expect(await prisma().upsellRule.count()).toBe(0);
    expect(await auditActions()).toContain('upgrade.deleted');
  });

  it('refuses an upgrade to the same dish, a second one between the same dishes, and a dish of another menu', async () => {
    expect(failureOf(await run(sales.saveUpgrade, upgrade({ targetProductId: a.product.id }))).fields).toHaveProperty('targetProductId');
    dataOf(await run(sales.saveUpgrade, upgrade()));
    expect(failureOf(await run(sales.saveUpgrade, upgrade())).fields).toHaveProperty('targetProductId');
    expect(failureOf(await run(sales.saveUpgrade, upgrade({ targetProductId: b.product.id }))).code).toBe('NOT_FOUND');
  });

  it('needs smart selling in the plan', async () => {
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { plan: 'BASIC' } });
    owner = (await loadActor(prisma(), 'owner-a')) as Actor;
    expect(failureOf(await run(sales.saveUpgrade, upgrade())).code).toBe('UPGRADE_REQUIRED');
  });

  it('is not found for someone outside the restaurant', async () => {
    await prisma().user.create({ data: { id: 'owner-b', name: 'Beta Owner', email: 'owner-b@example.com' } });
    await prisma().membership.create({ data: { userId: 'owner-b', restaurantId: b.restaurant.id, role: 'OWNER' } });
    const stranger = (await loadActor(prisma(), 'owner-b')) as Actor;
    expect(failureOf(await run(sales.saveUpgrade, upgrade(), stranger)).code).toBe('NOT_FOUND');
  });
});

const pairing = (overrides: Record<string, unknown> = {}) => ({
  menuId: a.menu.id,
  source: { kind: 'CATEGORY', id: a.category.id },
  targetProductId: cake,
  reason: { en: 'Coffee loves cake' },
  weight: 50,
  dayparts: [],
  isActive: true,
  ...overrides,
});

describe('pairing rules', () => {
  it('pairs a category with a dish, edits and deletes the pairing', async () => {
    const saved = dataOf(await run(sales.savePairing, pairing()));
    expect(await prisma().pairingRule.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({
      sourceType: 'CATEGORY',
      sourceCategoryId: a.category.id,
      sourceProductId: null,
      targetProductId: cake,
      weight: 50,
      translations: { en: { reason: 'Coffee loves cake' } },
    });
    const edited = dataOf(await run(sales.savePairing, pairing({ ruleId: saved.id, version: 1, source: { kind: 'PRODUCT', id: latte }, weight: 100 })));
    expect(await prisma().pairingRule.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({
      sourceType: 'PRODUCT',
      sourceProductId: latte,
      sourceCategoryId: null,
      weight: 100,
      version: edited.version,
    });
    dataOf(await run(sales.deletePairing, { menuId: a.menu.id, ruleId: saved.id, version: edited.version }));
    expect(await prisma().pairingRule.count()).toBe(0);
    expect(await auditActions()).toEqual(expect.arrayContaining(['pairing.created', 'pairing.updated', 'pairing.deleted']));
  });

  it('refuses a second pairing between the same source and dish', async () => {
    dataOf(await run(sales.savePairing, pairing()));
    expect(failureOf(await run(sales.savePairing, pairing())).fields).toHaveProperty('targetProductId');
    dataOf(await run(sales.savePairing, pairing({ source: { kind: 'PRODUCT', id: latte } })));
  });

  it('refuses a dish paired with itself and a category of another menu', async () => {
    expect(failureOf(await run(sales.savePairing, pairing({ source: { kind: 'PRODUCT', id: cake } }))).fields).toHaveProperty('targetProductId');
    expect(failureOf(await run(sales.savePairing, pairing({ source: { kind: 'CATEGORY', id: b.category.id } }))).code).toBe('NOT_FOUND');
  });
});

const set = (overrides: Record<string, unknown> = {}) => ({
  menuId: a.menu.id,
  names: { en: 'Coffee and cake', ar: 'قهوة وكعكة' },
  descriptions: { en: 'An espresso with a slice' },
  price: 700,
  items: [
    { productId: a.product.id, variantId: null, quantity: 1 },
    { productId: cake, variantId: null, quantity: 1 },
  ],
  dayparts: [],
  isActive: true,
  ...overrides,
});

describe('sets', () => {
  it('builds a set of two dishes priced below them, edits and deletes it', async () => {
    const saved = dataOf(await run(sales.saveSet, set()));
    const row = await prisma().bundle.findUniqueOrThrow({ where: { id: saved.id }, include: { items: { orderBy: { id: 'asc' } } } });
    expect(row).toMatchObject({ slug: 'coffee-and-cake', price: 700, translations: { en: { name: 'Coffee and cake', description: 'An espresso with a slice' }, ar: { name: 'قهوة وكعكة' } } });
    expect(row.items.map((item) => [item.productId, item.quantity]).sort()).toEqual([[a.product.id, 1], [cake, 1]].sort());

    const edited = dataOf(await run(sales.saveSet, set({ bundleId: saved.id, version: 1, slug: 'coffee-and-cake', price: 650, items: [{ productId: a.product.id, variantId: null, quantity: 2 }, { productId: cake, variantId: null, quantity: 1 }] })));
    expect(await prisma().bundle.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ price: 650, version: 2 });
    expect(await prisma().bundleItem.findMany({ where: { bundleId: saved.id }, select: { quantity: true } })).toHaveLength(2);
    dataOf(await run(sales.deleteSet, { menuId: a.menu.id, bundleId: saved.id, version: edited.version }));
    expect(await prisma().bundle.count()).toBe(0);
    expect(await prisma().bundleItem.count()).toBe(0);
    expect(await auditActions()).toEqual(expect.arrayContaining(['set.created', 'set.updated', 'set.deleted']));
  });

  it('refuses one dish, a price not below the dishes, a size of another dish and a slug in use', async () => {
    expect(failureOf(await run(sales.saveSet, set({ items: [{ productId: cake, variantId: null, quantity: 2 }] }))).code).toBe('INVALID');
    // Espresso 300 and cake 500 cost 800 one by one.
    expect(failureOf(await run(sales.saveSet, set({ price: 800 }))).fields).toHaveProperty('price');
    const size = await prisma().productVariant.create({ data: { menuId: a.menu.id, productId: latte, priceDelta: 100, translations: { en: { name: 'Large' } } } });
    expect(failureOf(await run(sales.saveSet, set({ items: [{ productId: a.product.id, variantId: size.id, quantity: 1 }, { productId: cake, variantId: null, quantity: 1 }] }))).code).toBe('NOT_FOUND');
    dataOf(await run(sales.saveSet, set()));
    expect(failureOf(await run(sales.saveSet, set({ slug: 'coffee-and-cake' }))).fields).toHaveProperty('slug');
  });

  it('without the right to set prices, never changes what a set holds, when it shows, or removes it', async () => {
    const saved = dataOf(await run(sales.saveSet, set()));
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { permissionPolicy: { OWNER: { grant: [], revoke: ['content.prices'] } } } });
    owner = (await loadActor(prisma(), 'owner-a')) as Actor;
    const edit = (overrides: Record<string, unknown>) => run(sales.saveSet, set({ bundleId: saved.id, version: 1, slug: 'coffee-and-cake', ...overrides }));
    expect(failureOf(await edit({ items: [{ productId: a.product.id, variantId: null, quantity: 1 }, { productId: cake, variantId: null, quantity: 2 }], price: 700 })).code).toBe('FORBIDDEN');
    expect(failureOf(await edit({ isActive: false })).code).toBe('FORBIDDEN');
    expect(failureOf(await edit({ dayparts: ['LUNCH'] })).code).toBe('FORBIDDEN');
    expect(failureOf(await run(sales.deleteSet, { menuId: a.menu.id, bundleId: saved.id, version: 1 })).code).toBe('FORBIDDEN');
  });

  it('lets an owner without the right to set prices rename a set but not price it', async () => {
    const saved = dataOf(await run(sales.saveSet, set()));
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { permissionPolicy: { OWNER: { grant: [], revoke: ['content.prices'] } } } });
    owner = (await loadActor(prisma(), 'owner-a')) as Actor;
    expect(failureOf(await run(sales.saveSet, set({ names: { en: 'Morning set' } }))).code).toBe('FORBIDDEN');
    dataOf(await run(sales.saveSet, set({ bundleId: saved.id, version: 1, slug: 'coffee-and-cake', names: { en: 'Morning set' } })));
    expect(failureOf(await run(sales.saveSet, set({ bundleId: saved.id, version: 2, slug: 'coffee-and-cake', price: 600 }))).code).toBe('FORBIDDEN');
  });

  it('reads each set with its items and what they cost one by one', async () => {
    const saved = dataOf(await run(sales.saveSet, set()));
    const read = dataOf(await rules());
    expect(read.sets).toEqual([
      {
        id: saved.id,
        version: 1,
        slug: 'coffee-and-cake',
        names: { en: 'Coffee and cake', ar: 'قهوة وكعكة' },
        descriptions: { en: 'An espresso with a slice' },
        price: 700,
        items: expect.arrayContaining([
          { productId: a.product.id, variantId: null, quantity: 1 },
          { productId: cake, variantId: null, quantity: 1 },
        ]),
        dayparts: [],
        isActive: true,
        itemsTotal: 800,
      },
    ]);
    expect(read.products.find((p) => p.id === a.product.id)?.variants).toEqual([]);
  });
});

const offer = (overrides: Record<string, unknown> = {}) => ({
  menuId: a.menu.id,
  kind: 'DISCOUNT',
  percentOff: 20,
  productIds: [latte],
  categoryIds: [cakes],
  startsOn: '2026-10-01',
  endsOn: '2026-10-31',
  startMinute: 17 * 60,
  endMinute: 19 * 60,
  daysOfWeek: 127,
  title: { en: 'Happy hour', ar: 'الساعة السعيدة' },
  text: { en: 'Twenty percent off lattes and cakes' },
  isActive: true,
  ...overrides,
});

describe('offers', () => {
  it('schedules a happy hour that the published menu carries', async () => {
    const saved = dataOf(await run(sales.saveOffer, offer()));
    expect(await prisma().promotion.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({
      kind: 'DISCOUNT',
      percentOff: 20,
      productIds: [latte],
      categoryIds: [cakes],
      startsOn: '2026-10-01',
      endsOn: '2026-10-31',
      startMinute: 1020,
      endMinute: 1140,
      daysOfWeek: 127,
      translations: { en: { title: 'Happy hour', text: 'Twenty percent off lattes and cakes' }, ar: { title: 'الساعة السعيدة' } },
      sortOrder: 0,
    });
    await publishFixture(prisma(), a.menu.id);
    const revision = await prisma().menuRevision.findFirstOrThrow({ where: { menuId: a.menu.id }, orderBy: { number: 'desc' } });
    expect((revision.snapshot as { catalog: { promotions?: Array<{ id: string; roundTo: number }> } }).catalog.promotions).toMatchObject([{ id: saved.id, roundTo: 5 }]);
    expect(await auditActions()).toContain('offer.created');
  });

  it('edits, reorders and deletes offers', async () => {
    const first = dataOf(await run(sales.saveOffer, offer()));
    const second = dataOf(await run(sales.saveOffer, offer({ kind: 'SPECIAL', percentOff: null, title: { en: 'Chef special' } })));
    expect((await prisma().promotion.findUniqueOrThrow({ where: { id: second.id } })).sortOrder).toBe(1);
    dataOf(await run(sales.saveOffer, offer({ offerId: first.id, version: 1, percentOff: 30, isActive: false })));
    expect(await prisma().promotion.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ percentOff: 30, isActive: false, version: 2 });
    dataOf(await run(sales.reorderOffers, { menuId: a.menu.id, order: [second.id, first.id] }));
    expect((await loadDraftCatalog(prisma(), a.menu.id)).promotions.map((p) => p.id)).toEqual([second.id]);
    expect((await prisma().promotion.findMany({ orderBy: { sortOrder: 'asc' } })).map((p) => p.id)).toEqual([second.id, first.id]);
    dataOf(await run(sales.deleteOffer, { menuId: a.menu.id, offerId: first.id, version: 2 }));
    expect(await prisma().promotion.count()).toBe(1);
    expect(await auditActions()).toEqual(expect.arrayContaining(['offer.updated', 'offer.reordered', 'offer.deleted']));
  });

  it.each([
    ['no dish and no category', { productIds: [], categoryIds: [] }, 'productIds'],
    ['a discount without a percentage', { percentOff: null }, 'percentOff'],
    ['a discount of 95%', { percentOff: 95 }, 'percentOff'],
    ['a special with a percentage', { kind: 'SPECIAL', percentOff: 10 }, 'percentOff'],
    ['an end before the start', { startsOn: '2026-10-10', endsOn: '2026-10-09' }, 'endsOn'],
    ['a start time without an end', { endMinute: null }, 'endMinute'],
    ['the same start and end time', { endMinute: 17 * 60 }, 'endMinute'],
    ['no day of the week', { daysOfWeek: 0 }, 'daysOfWeek'],
    ['no title in the main language', { title: { ar: 'عرض' } }, 'title'],
    ['a date that does not exist', { startsOn: '2026-02-30' }, 'startsOn'],
  ])('refuses %s', async (_label, overrides, field) => {
    expect(failureOf(await run(sales.saveOffer, offer(overrides))).fields).toHaveProperty(field);
  });

  it('refuses a dish of another menu', async () => {
    expect(failureOf(await run(sales.saveOffer, offer({ productIds: [b.product.id] }))).code).toBe('NOT_FOUND');
  });

  it('needs the right to set prices for a discount, not for a special, and offers in the plan', async () => {
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { permissionPolicy: { OWNER: { grant: [], revoke: ['content.prices'] } } } });
    owner = (await loadActor(prisma(), 'owner-a')) as Actor;
    expect(failureOf(await run(sales.saveOffer, offer())).code).toBe('FORBIDDEN');
    dataOf(await run(sales.saveOffer, offer({ kind: 'SPECIAL', percentOff: null })));
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { plan: 'BASIC' } });
    owner = (await loadActor(prisma(), 'owner-a')) as Actor;
    expect(failureOf(await run(sales.saveOffer, offer({ kind: 'SPECIAL', percentOff: null }))).code).toBe('UPGRADE_REQUIRED');
  });

  it('stores the dishes and categories of an offer in a fixed order, so choosing them again changes nothing', async () => {
    const forward = [latte, cake].sort();
    const saved = dataOf(await run(sales.saveOffer, offer({ productIds: [...forward].reverse(), categoryIds: [cakes, a.category.id] })));
    const row = await prisma().promotion.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row.productIds).toEqual(forward);
    expect(row.categoryIds).toEqual([cakes, a.category.id].sort());
    const hash = (await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } })).draftHash;
    dataOf(await run(sales.saveOffer, offer({ offerId: saved.id, version: 1, productIds: forward, categoryIds: [a.category.id, cakes] })));
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } })).draftHash).toBe(hash);
  });

  it('without the right to set prices, edits only the words of a discount and never removes one', async () => {
    const discount = dataOf(await run(sales.saveOffer, offer()));
    const special = dataOf(await run(sales.saveOffer, offer({ kind: 'SPECIAL', percentOff: null, title: { en: 'Chef special' } })));
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { permissionPolicy: { OWNER: { grant: [], revoke: ['content.prices'] } } } });
    owner = (await loadActor(prisma(), 'owner-a')) as Actor;
    const edit = (overrides: Record<string, unknown>) => run(sales.saveOffer, offer({ offerId: discount.id, version: 1, ...overrides }));
    expect(failureOf(await edit({ categoryIds: [cakes, a.category.id] })).code).toBe('FORBIDDEN');
    expect(failureOf(await edit({ productIds: [latte, a.product.id] })).code).toBe('FORBIDDEN');
    expect(failureOf(await edit({ startsOn: null, endsOn: null })).code).toBe('FORBIDDEN');
    expect(failureOf(await edit({ startMinute: null, endMinute: null })).code).toBe('FORBIDDEN');
    expect(failureOf(await edit({ daysOfWeek: 1 })).code).toBe('FORBIDDEN');
    expect(failureOf(await edit({ isActive: false })).code).toBe('FORBIDDEN');
    dataOf(await edit({ title: { en: 'Golden hour' } }));
    expect(failureOf(await run(sales.deleteOffer, { menuId: a.menu.id, offerId: discount.id, version: 2 })).code).toBe('FORBIDDEN');
    dataOf(await run(sales.deleteOffer, { menuId: a.menu.id, offerId: special.id, version: 1 }));
  });

  it('reads every offer in its order', async () => {
    const saved = dataOf(await run(sales.saveOffer, offer()));
    expect(dataOf(await rules()).offers).toEqual([
      {
        id: saved.id,
        version: 1,
        kind: 'DISCOUNT',
        percentOff: 20,
        productIds: [latte],
        categoryIds: [cakes],
        startsOn: '2026-10-01',
        endsOn: '2026-10-31',
        startMinute: 1020,
        endMinute: 1140,
        daysOfWeek: 127,
        title: { en: 'Happy hour', ar: 'الساعة السعيدة' },
        text: { en: 'Twenty percent off lattes and cakes' },
        isActive: true,
        sortOrder: 0,
        ended: expect.any(Boolean),
      },
    ]);
  });

  it('says which offers have passed their end date, in the menu’s time zone, and names that time zone', async () => {
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const past = dataOf(await run(sales.saveOffer, offer({ startsOn: day(-10), endsOn: day(-3) })));
    const coming = dataOf(await run(sales.saveOffer, offer({ startsOn: day(-3), endsOn: day(3) })));
    const open = dataOf(await run(sales.saveOffer, offer({ startsOn: null, endsOn: null })));
    const read = dataOf(await rules());
    expect(Object.fromEntries(read.offers.map((o) => [o.id, o.ended]))).toEqual({ [past.id]: true, [coming.id]: false, [open.id]: false });
    expect(read.timeZone).toBe('Asia/Baghdad');
  });
});

describe('sales settings', () => {
  const settings = () => runQuery(prisma(), owner, salesQueries.settings, { menuId: a.menu.id });
  const save = async (overrides: Record<string, unknown> = {}) =>
    run(sales.saveSettings, {
      menuId: a.menu.id,
      version: (await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } })).version,
      priceStyle: 'plain',
      showMostOrdered: false,
      showLowStock: true,
      upsellMaxOffers: 2,
      pairingMaxOffers: 4,
      upsellDeltaCapRatio: 1.5,
      cartPairingMaxOffers: 2,
      mealCategoryIds: [cakes],
      ...overrides,
    });

  it('reads the defaults while nothing is saved', async () => {
    const read = dataOf(await settings());
    expect(read).toMatchObject({ priceStyle: 'symbol', showMostOrdered: true, showLowStock: true, upsellMaxOffers: 3, pairingMaxOffers: 3, upsellDeltaCapRatio: 0.75, cartPairingMaxOffers: 2, defaultLocale: 'en' });
    expect(read.categories).toEqual([
      { id: a.category.id, names: { en: 'Coffee' }, completesMeal: false },
      { id: cakes, names: { en: 'Cakes' }, completesMeal: false },
    ]);
    expect(read.version).toBe((await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } })).version);
  });

  it('saves the settings into the engine settings, keeping the weights, and marks the meal categories', async () => {
    await prisma().menu.update({ where: { id: a.menu.id }, data: { engineConfig: { weights: { margin: 0.9 } } } });
    dataOf(await save());
    const menu = await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } });
    expect(menu.engineConfig).toMatchObject({
      weights: { margin: 0.9 },
      upsellMaxOffers: 2,
      pairingMaxOffers: 4,
      upsellDeltaCapRatio: 1.5,
      sales: { priceStyle: 'plain', showMostOrdered: false, showLowStock: true },
    });
    expect((await prisma().category.findUniqueOrThrow({ where: { id: cakes } })).completesMeal).toBe(true);
    expect(menu.draftHash).not.toBe(menu.liveHash);
    expect(dataOf(await settings())).toMatchObject({ priceStyle: 'plain', showMostOrdered: false, upsellMaxOffers: 2 });

    dataOf(await save({ cartPairingMaxOffers: 4 }));
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } })).engineConfig).toMatchObject({ cartPairingMaxOffers: 4 });
    dataOf(await save({ cartPairingMaxOffers: 4, mealCategoryIds: [a.category.id] }));
    expect((await prisma().category.findMany({ where: { menuId: a.menu.id }, orderBy: { sortOrder: 'asc' } })).map((c) => c.completesMeal)).toEqual([true, false]);
    expect(await auditActions()).toContain('menu.sales_settings_changed');
  });

  it('writes nothing when the settings are saved unchanged', async () => {
    dataOf(await save());
    const before = await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } });
    const audits = await prisma().auditLog.count({ where: { action: 'menu.sales_settings_changed' } });
    expect(dataOf(await save())).toEqual({ version: before.version });
    const after = await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } });
    expect([after.version, after.draftHash]).toEqual([before.version, before.draftHash]);
    expect(await prisma().auditLog.count({ where: { action: 'menu.sales_settings_changed' } })).toBe(audits);
  });

  it('refuses a stale version, a category of another menu and limits out of range', async () => {
    expect(failureOf(await save({ version: 999 })).code).toBe('CONFLICT');
    expect(failureOf(await save({ mealCategoryIds: [b.category.id] })).code).toBe('NOT_FOUND');
    expect(failureOf(await save({ upsellMaxOffers: 6 })).fields).toHaveProperty('upsellMaxOffers');
    expect(failureOf(await save({ upsellDeltaCapRatio: 3 })).fields).toHaveProperty('upsellDeltaCapRatio');
  });
});

describe('the rules the Sales tab reads', () => {
  it('lists the dishes, categories and both kinds of rule with their texts', async () => {
    const up = dataOf(await run(sales.saveUpgrade, upgrade()));
    const pair = dataOf(await run(sales.savePairing, pairing()));
    const read = dataOf(await rules());
    expect(read.currency).toBe('USD');
    expect(read.products.map((p) => p.id).sort()).toEqual([a.product.id, latte, cake].sort());
    expect(read.categories.map((c) => c.id)).toEqual([a.category.id, cakes]);
    expect(read.upgrades).toEqual([
      {
        id: up.id,
        version: 1,
        sourceProductId: a.product.id,
        targetProductId: latte,
        pitch: { en: 'Make it a latte', ar: 'اجعلها لاتيه' },
        effect: { en: 'Steamed milk and a double shot' },
        priority: 75,
        dayparts: ['BREAKFAST'],
        isActive: true,
      },
    ]);
    expect(read.pairings).toEqual([
      { id: pair.id, version: 1, sourceType: 'CATEGORY', sourceId: a.category.id, targetProductId: cake, reason: { en: 'Coffee loves cake' }, weight: 50, dayparts: [], isActive: true },
    ]);
  });
});
