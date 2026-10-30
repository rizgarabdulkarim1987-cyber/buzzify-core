import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import * as sales from '@/server/studio/actions/sales';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as salesQueries from '@/server/studio/queries/sales';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

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
let cake: string;

const run = <I, O>(def: ActionDef<I, O>, input: unknown, actor: Actor = owner) => runAction(prisma(), actor, def, input, META);
const rules = () => runQuery(prisma(), owner, salesQueries.rules, { menuId: a.menu.id });
const auditActions = async () => (await prisma().auditLog.findMany({ orderBy: { occurredAt: 'asc' } })).map((row) => row.action);

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'showcase-a');
  b = await createMenuFixture(prisma(), 'showcase-b');
  cake = (await prisma().product.create({ data: { menuId: a.menu.id, categoryId: a.category.id, slug: 'cake', basePrice: 500, translations: { en: { name: 'Cake' } } } })).id;
  await prisma().user.create({ data: { id: 'owner-a', name: 'Alpha Owner', email: 'owner-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'owner-a', restaurantId: a.restaurant.id, role: 'OWNER' } });
  owner = (await loadActor(prisma(), 'owner-a')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
});

const occasion = (overrides: Record<string, unknown> = {}) => ({
  menuId: a.menu.id,
  names: { en: 'Eid', ar: 'العيد' },
  startsOn: '2099-03-30',
  endsOn: '2099-04-02',
  isActive: true,
  ...overrides,
});
const card = (overrides: Record<string, unknown> = {}) => ({
  menuId: a.menu.id,
  slot: 'ABOVE_SEARCH',
  kind: 'BUFFET',
  occasionId: null,
  promotionId: null,
  bundleId: null,
  price: 15000,
  startMinute: null,
  endMinute: null,
  daysOfWeek: 127,
  title: { en: 'Friday buffet' },
  text: {},
  isActive: true,
  ...overrides,
});
const offer = (overrides: Record<string, unknown> = {}) => ({
  menuId: a.menu.id,
  kind: 'SPECIAL',
  percentOff: null,
  productIds: [a.product.id],
  categoryIds: [],
  startsOn: null,
  endsOn: null,
  startMinute: null,
  endMinute: null,
  daysOfWeek: 127,
  title: { en: 'Chef special' },
  text: {},
  isActive: true,
  ...overrides,
});
const set = (overrides: Record<string, unknown> = {}) => ({
  menuId: a.menu.id,
  names: { en: 'Coffee and cake' },
  descriptions: {},
  price: 700,
  items: [
    { productId: a.product.id, variantId: null, quantity: 1 },
    { productId: cake, variantId: null, quantity: 1 },
  ],
  dayparts: [],
  isActive: true,
  ...overrides,
});

describe('occasions', () => {
  it('creates, edits and deletes an occasion with its cards, and audits each', async () => {
    const saved = dataOf(await run(sales.saveOccasion, occasion()));
    expect(saved.version).toBe(1);
    expect(await prisma().occasion.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({
      startsOn: '2099-03-30',
      endsOn: '2099-04-02',
      isActive: true,
      translations: { en: { name: 'Eid' }, ar: { name: 'العيد' } },
    });
    const edited = dataOf(await run(sales.saveOccasion, occasion({ occasionId: saved.id, version: 1, names: { en: 'Eid al-Fitr' }, isActive: false })));
    expect(edited.version).toBe(2);
    expect(await prisma().occasion.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ isActive: false, version: 2, translations: { en: { name: 'Eid al-Fitr' } } });

    dataOf(await run(sales.saveShowcaseCard, card({ occasionId: saved.id })));
    dataOf(await run(sales.deleteOccasion, { menuId: a.menu.id, occasionId: saved.id, version: 2 }));
    expect(await prisma().occasion.count()).toBe(0);
    expect(await prisma().showcaseCard.count()).toBe(0);
    expect(await auditActions()).toEqual(expect.arrayContaining(['occasion.created', 'occasion.updated', 'occasion.deleted']));
  });

  it('refuses a stale version', async () => {
    const saved = dataOf(await run(sales.saveOccasion, occasion()));
    dataOf(await run(sales.saveOccasion, occasion({ occasionId: saved.id, version: 1, isActive: false })));
    expect(failureOf(await run(sales.saveOccasion, occasion({ occasionId: saved.id, version: 1 }))).code).toBe('CONFLICT');
    expect(failureOf(await run(sales.deleteOccasion, { menuId: a.menu.id, occasionId: saved.id, version: 1 })).code).toBe('CONFLICT');
  });

  it.each([
    ['a date that does not exist', { startsOn: '2099-02-30' }, 'startsOn'],
    ['an end before the start', { startsOn: '2099-04-02', endsOn: '2099-04-01' }, 'endsOn'],
    ['no name in the main language', { names: { ar: 'العيد' } }, 'names'],
  ])('refuses %s', async (_label, overrides, field) => {
    expect(failureOf(await run(sales.saveOccasion, occasion(overrides))).fields).toHaveProperty(field);
  });

  it("refuses another menu's occasion", async () => {
    const other = await prisma().occasion.create({ data: { menuId: b.menu.id, startsOn: '2099-01-01', endsOn: '2099-01-02', translations: { en: { name: 'B' } } } });
    expect(failureOf(await run(sales.saveOccasion, occasion({ occasionId: other.id, version: 1 }))).code).toBe('NOT_FOUND');
    expect(failureOf(await run(sales.deleteOccasion, { menuId: a.menu.id, occasionId: other.id, version: 1 })).code).toBe('NOT_FOUND');
  });
});

describe('showcase cards', () => {
  it('creates, edits and deletes a buffet card, and audits each', async () => {
    const saved = dataOf(await run(sales.saveShowcaseCard, card()));
    expect(saved.version).toBe(1);
    expect(await prisma().showcaseCard.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({
      slot: 'ABOVE_SEARCH',
      kind: 'BUFFET',
      price: 15000,
      sortOrder: 0,
      translations: { en: { title: 'Friday buffet' } },
    });
    const second = dataOf(await run(sales.saveShowcaseCard, card({ title: { en: 'Brunch' } })));
    expect((await prisma().showcaseCard.findUniqueOrThrow({ where: { id: second.id } })).sortOrder).toBe(1);
    const other = dataOf(await run(sales.saveShowcaseCard, card({ slot: 'BELOW_SEARCH' })));
    expect((await prisma().showcaseCard.findUniqueOrThrow({ where: { id: other.id } })).sortOrder).toBe(0);

    const edited = dataOf(await run(sales.saveShowcaseCard, card({ cardId: saved.id, version: 1, price: 18000, startMinute: 720, endMinute: 900 })));
    expect(edited.version).toBe(2);
    expect(await prisma().showcaseCard.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ price: 18000, startMinute: 720, endMinute: 900, version: 2 });
    expect(failureOf(await run(sales.saveShowcaseCard, card({ cardId: saved.id, version: 1 }))).code).toBe('CONFLICT');

    dataOf(await run(sales.deleteShowcaseCard, { menuId: a.menu.id, cardId: saved.id, version: 2 }));
    expect(await prisma().showcaseCard.count()).toBe(2);
    expect(await auditActions()).toEqual(expect.arrayContaining(['showcase.created', 'showcase.updated', 'showcase.deleted']));
  });

  it('carries an offer, a set and an occasion', async () => {
    const promo = dataOf(await run(sales.saveOffer, offer()));
    const bundle = dataOf(await run(sales.saveSet, set()));
    const occ = dataOf(await run(sales.saveOccasion, occasion()));
    dataOf(await run(sales.saveShowcaseCard, card({ kind: 'OFFER', promotionId: promo.id, price: null, title: {} })));
    dataOf(await run(sales.saveShowcaseCard, card({ kind: 'SET', bundleId: bundle.id, occasionId: occ.id, price: null, title: {} })));
    expect(await prisma().showcaseCard.count()).toBe(2);
  });

  it.each([
    ['an offer card without an offer', { kind: 'OFFER', price: null }, 'promotionId'],
    ['a set card without a set', { kind: 'SET', price: null }, 'bundleId'],
    ['a buffet without a title in the main language', { title: { ar: 'بوفيه' } }, 'title'],
    ['a buffet without a price', { price: null }, 'price'],
    ['a start time without an end', { startMinute: 720 }, 'endMinute'],
  ])('refuses %s', async (_label, overrides, field) => {
    expect(failureOf(await run(sales.saveShowcaseCard, card(overrides))).fields).toHaveProperty(field);
  });

  it('refuses a buffet that points at an offer, and an offer card that has a price', async () => {
    const promo = dataOf(await run(sales.saveOffer, offer()));
    expect(failureOf(await run(sales.saveShowcaseCard, card({ promotionId: promo.id }))).fields).toHaveProperty('promotionId');
    expect(failureOf(await run(sales.saveShowcaseCard, card({ kind: 'OFFER', promotionId: promo.id, price: 100 }))).fields).toHaveProperty('price');
  });

  it("refuses another menu's offer, set and occasion", async () => {
    const otherOccasion = await prisma().occasion.create({ data: { menuId: b.menu.id, startsOn: '2099-01-01', endsOn: '2099-01-02', translations: { en: { name: 'B' } } } });
    const otherOffer = await prisma().promotion.create({ data: { menuId: b.menu.id, kind: 'SPECIAL', productIds: [b.product.id], translations: { en: { title: 'B' } } } });
    const otherSet = await prisma().bundle.create({ data: { menuId: b.menu.id, slug: 'b-set', price: 1, translations: { en: { name: 'B' } } } });
    expect(failureOf(await run(sales.saveShowcaseCard, card({ occasionId: otherOccasion.id }))).code).toBe('NOT_FOUND');
    expect(failureOf(await run(sales.saveShowcaseCard, card({ kind: 'OFFER', promotionId: otherOffer.id, price: null, title: {} }))).code).toBe('NOT_FOUND');
    expect(failureOf(await run(sales.saveShowcaseCard, card({ kind: 'SET', bundleId: otherSet.id, price: null, title: {} }))).code).toBe('NOT_FOUND');
  });

  it('reorders the cards of a slot, and refuses an order that misses one', async () => {
    const one = dataOf(await run(sales.saveShowcaseCard, card()));
    const two = dataOf(await run(sales.saveShowcaseCard, card({ title: { en: 'Two' } })));
    const lone = dataOf(await run(sales.saveShowcaseCard, card({ slot: 'BELOW_SEARCH' })));
    expect(failureOf(await run(sales.reorderShowcaseCards, { menuId: a.menu.id, slot: 'ABOVE_SEARCH', order: [two.id] })).code).toBe('INVALID');
    expect(failureOf(await run(sales.reorderShowcaseCards, { menuId: a.menu.id, slot: 'ABOVE_SEARCH', order: [two.id, two.id] })).code).toBe('INVALID');
    expect(failureOf(await run(sales.reorderShowcaseCards, { menuId: a.menu.id, slot: 'ABOVE_SEARCH', order: [two.id, lone.id] })).code).toBe('NOT_FOUND');
    dataOf(await run(sales.reorderShowcaseCards, { menuId: a.menu.id, slot: 'ABOVE_SEARCH', order: [two.id, one.id] }));
    expect((await prisma().showcaseCard.findMany({ where: { slot: 'ABOVE_SEARCH' }, orderBy: { sortOrder: 'asc' } })).map((c) => c.id)).toEqual([two.id, one.id]);
    expect((await prisma().showcaseCard.findUniqueOrThrow({ where: { id: one.id } })).version).toBe(1);
    expect(await auditActions()).toContain('showcase.reordered');
  });

  it('removes the cards of an offer or a set that is deleted', async () => {
    const promo = dataOf(await run(sales.saveOffer, offer()));
    const bundle = dataOf(await run(sales.saveSet, set()));
    dataOf(await run(sales.saveShowcaseCard, card({ kind: 'OFFER', promotionId: promo.id, price: null, title: {} })));
    dataOf(await run(sales.saveShowcaseCard, card({ kind: 'SET', bundleId: bundle.id, price: null, title: {} })));
    dataOf(await run(sales.deleteOffer, { menuId: a.menu.id, offerId: promo.id, version: 1 }));
    expect(await prisma().showcaseCard.count()).toBe(1);
    dataOf(await run(sales.deleteSet, { menuId: a.menu.id, bundleId: bundle.id, version: 1 }));
    expect(await prisma().showcaseCard.count()).toBe(0);
  });

  it('is refused to someone without the right to edit content', async () => {
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { permissionPolicy: { OWNER: { grant: [], revoke: ['content.edit'] } } } });
    owner = (await loadActor(prisma(), 'owner-a')) as Actor;
    expect(failureOf(await run(sales.saveOccasion, occasion())).code).toBe('FORBIDDEN');
    expect(failureOf(await run(sales.saveShowcaseCard, card())).code).toBe('FORBIDDEN');
    expect(failureOf(await run(sales.deleteOccasion, { menuId: a.menu.id, occasionId: 'x', version: 1 })).code).toBe('FORBIDDEN');
    expect(failureOf(await run(sales.deleteShowcaseCard, { menuId: a.menu.id, cardId: 'x', version: 1 })).code).toBe('FORBIDDEN');
    expect(failureOf(await run(sales.reorderShowcaseCards, { menuId: a.menu.id, slot: 'ABOVE_SEARCH', order: [] })).code).toBe('FORBIDDEN');
  });
});

describe('what the Sales tab reads for the showcase', () => {
  it('lists occasions and cards with the reason a card is hidden', async () => {
    const ended = dataOf(await run(sales.saveOccasion, occasion({ names: { en: 'Old' }, startsOn: '2000-01-01', endsOn: '2000-01-05' })));
    const upcoming = dataOf(await run(sales.saveOccasion, occasion({ names: { en: 'Soon' } })));
    const off = dataOf(await run(sales.saveOccasion, occasion({ names: { en: 'Off' }, startsOn: '2000-01-01', endsOn: '2099-12-31', isActive: false })));
    const running = dataOf(await run(sales.saveOccasion, occasion({ names: { en: 'Now' }, startsOn: '2000-01-01', endsOn: '2099-12-31' })));
    const promoOff = dataOf(await run(sales.saveOffer, offer({ isActive: false })));
    const promoEnded = dataOf(await run(sales.saveOffer, offer({ startsOn: '2000-01-01', endsOn: '2000-01-02' })));
    const promoLive = dataOf(await run(sales.saveOffer, offer()));
    const bundleOff = dataOf(await run(sales.saveSet, set({ isActive: false })));
    const bundleLive = dataOf(await run(sales.saveSet, set({ names: { en: 'Live set' } })));
    const bundleSoldOut = dataOf(await run(sales.saveSet, set({ names: { en: 'Sold out set' } })));
    await prisma().product.update({ where: { id: cake }, data: { isAvailable: false } });
    // The live set uses the same dishes, so make a second one with fresh dishes that stay available.
    const tea = (await prisma().product.create({ data: { menuId: a.menu.id, categoryId: a.category.id, slug: 'tea', basePrice: 400, translations: { en: { name: 'Tea' } } } })).id;
    const water = (await prisma().product.create({ data: { menuId: a.menu.id, categoryId: a.category.id, slug: 'water', basePrice: 400, translations: { en: { name: 'Water' } } } })).id;
    const available = dataOf(await run(sales.saveSet, set({ names: { en: 'Tea set' }, price: 500, items: [{ productId: tea, variantId: null, quantity: 1 }, { productId: water, variantId: null, quantity: 1 }] })));

    const make = async (overrides: Record<string, unknown>) => dataOf(await run(sales.saveShowcaseCard, card({ price: null, title: {}, ...overrides }))).id;
    const ids = {
      occEnded: await make({ occasionId: ended.id, kind: 'BUFFET', price: 1, title: { en: 'x' } }),
      occUpcoming: await make({ occasionId: upcoming.id, kind: 'BUFFET', price: 1, title: { en: 'x' } }),
      occOff: await make({ occasionId: off.id, kind: 'BUFFET', price: 1, title: { en: 'x' } }),
      occRunning: await make({ occasionId: running.id, kind: 'BUFFET', price: 1, title: { en: 'x' } }),
      offerOff: await make({ kind: 'OFFER', promotionId: promoOff.id }),
      offerEnded: await make({ kind: 'OFFER', promotionId: promoEnded.id }),
      offerLive: await make({ kind: 'OFFER', promotionId: promoLive.id }),
      setOff: await make({ kind: 'SET', bundleId: bundleOff.id }),
      setUnavailable: await make({ kind: 'SET', bundleId: bundleSoldOut.id }),
      setLive: await make({ kind: 'SET', bundleId: available.id }),
    };
    void bundleLive;

    const read = dataOf(await rules());
    expect(read.occasions.map((o) => o.names.en).sort()).toEqual(['Now', 'Off', 'Old', 'Soon']);
    expect(read.occasions.find((o) => o.id === running.id)).toMatchObject({ version: 1, startsOn: '2000-01-01', endsOn: '2099-12-31', isActive: true });
    const reason = (id: string) => read.showcase.find((c) => c.id === id)?.hiddenReason;
    expect(reason(ids.occEnded)).toBe('OCCASION_ENDED');
    expect(reason(ids.occUpcoming)).toBe('OCCASION_UPCOMING');
    expect(reason(ids.occOff)).toBe('OCCASION_OFF');
    expect(reason(ids.occRunning)).toBeNull();
    expect(reason(ids.offerOff)).toBe('OFFER_OFF');
    expect(reason(ids.offerEnded)).toBe('OFFER_ENDED');
    expect(reason(ids.offerLive)).toBeNull();
    expect(reason(ids.setOff)).toBe('SET_OFF');
    expect(reason(ids.setUnavailable)).toBe('SET_UNAVAILABLE');
    expect(reason(ids.setLive)).toBeNull();
    expect(read.showcase.find((c) => c.id === ids.occRunning)).toMatchObject({ slot: 'ABOVE_SEARCH', kind: 'BUFFET', price: 1, version: 1, isActive: true, title: { en: 'x' } });
  });

  it('marks offer and set cards hidden by the plan when it leaves out timed offers and smart selling', async () => {
    const promo = dataOf(await run(sales.saveOffer, offer()));
    const bundle = dataOf(await run(sales.saveSet, set()));
    const offerCard = dataOf(await run(sales.saveShowcaseCard, card({ kind: 'OFFER', promotionId: promo.id, price: null, title: {} }))).id;
    const setCard = dataOf(await run(sales.saveShowcaseCard, card({ kind: 'SET', bundleId: bundle.id, price: null, title: {} }))).id;
    const buffet = dataOf(await run(sales.saveShowcaseCard, card())).id;
    const reason = async (id: string) => dataOf(await rules()).showcase.find((c) => c.id === id)?.hiddenReason;
    expect(await reason(offerCard)).toBeNull();
    expect(await reason(setCard)).toBeNull();

    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { plan: 'BASIC' } });
    expect(dataOf(await rules()).upgrade.allowed).not.toEqual(expect.arrayContaining(['selling.offers']));
    expect(await reason(offerCard)).toBe('PLAN');
    expect(await reason(setCard)).toBe('PLAN');
    expect(await reason(buffet)).toBeNull();
  });
});

describe('a set for several people', () => {
  it('stores the number of people and returns it', async () => {
    const saved = dataOf(await run(sales.saveSet, set({ people: 4 })));
    expect((await prisma().bundle.findUniqueOrThrow({ where: { id: saved.id } })).people).toBe(4);
    expect(dataOf(await rules()).sets[0]?.people).toBe(4);
    dataOf(await run(sales.saveSet, set({ bundleId: saved.id, version: 1, slug: 'coffee-and-cake', people: null })));
    expect((await prisma().bundle.findUniqueOrThrow({ where: { id: saved.id } })).people).toBeNull();
    const updates = await prisma().auditLog.findMany({ where: { action: 'set.updated' } });
    expect(JSON.stringify(updates.map((row) => row.changes))).toContain('people');
  });

  it('keeps a set without people at null, and refuses 1 and 13', async () => {
    const saved = dataOf(await run(sales.saveSet, set()));
    expect((await prisma().bundle.findUniqueOrThrow({ where: { id: saved.id } })).people).toBeNull();
    expect(failureOf(await run(sales.saveSet, set({ people: 1 }))).code).toBe('INVALID');
    expect(failureOf(await run(sales.saveSet, set({ people: 13 }))).code).toBe('INVALID');
  });
});
