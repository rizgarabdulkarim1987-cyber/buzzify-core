import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as loyaltyCard } from '@/app/api/[tenant]/loyalty-card/route';
import { POST as submit } from '@/app/api/[tenant]/qr-order/route';
import { getTenant } from '@/server/data/public-menu';
import { delegates, scopedClient } from '@/server/data/tenant-db';
import { listPendingDetails } from '@/server/pos/customer-orders';
import { readCard } from '@/server/pos/loyalty';
import { updatePosSettings } from '@/server/studio/actions/pos';
import { acceptPosRequest } from '@/server/studio/actions/pos-requests';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { publishFixture } from '../helpers/db';
import { codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const en = (name: string) => ({ en: { name } });
const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

let counter = 0;
let slug = '';
let a: { id: string };
let cashier: Person;
let burger = '';
let juice = '';
let ip = 0;

async function world(options: { plan?: 'BASIC' | 'PRO'; loyalty?: boolean; stamps?: number } = {}) {
  slug = `loy-${++counter}`;
  a = await restaurant(`Loyalty ${counter}`);
  await prisma().restaurant.update({ where: { id: a.id }, data: { plan: options.plan ?? 'PRO' } });
  cashier = await person(`cashier-${counter}`, { staff: [a.id, 'CASHIER'] });
  const menu = await prisma().menu.create({ data: { restaurantId: a.id, name: 'm', slug, currency: 'IQD', locales: ['en'], defaultLocale: 'en', timezone: 'Asia/Baghdad' } });
  await prisma().menuSlug.create({ data: { slug, menuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: en('Food') } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: en('Burger') } })).id;
  juice = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'juice', sortOrder: 2, basePrice: 2000, translations: en('Juice') } })).id;
  await publishFixture(prisma(), menu.id);
  await prisma().posSettings.create({
    data: { restaurantId: a.id, qrOrderingEnabled: true, catalogMenuId: menu.id, loyaltyEnabled: options.loyalty ?? true, loyaltyStampsRequired: options.stamps ?? 3, loyaltyReward: 'Free juice' },
  });
  const areaId = (await prisma().posArea.create({ data: { restaurantId: a.id, name: 'Hall' } })).id;
  await prisma().posTable.createMany({ data: [1, 2].map((number) => ({ restaurantId: a.id, areaId, number })) });
}

const call = (path: string, init?: RequestInit) =>
  new Request(`http://localhost/api/${slug}/${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.0.${++ip}`, ...(init?.headers ?? {}) } });
const ctx = () => ({ params: Promise.resolve({ tenant: slug }) });
const order = (productIds: string[], card?: object, table = 1) =>
  submit(call('qr-order', { method: 'POST', body: JSON.stringify({ table, locale: 'en', cart: { lines: productIds.map((productId) => ({ productId, quantity: 1 })) }, note: '', ...(card ? { card } : {}) }) }), ctx());
const readRoute = (token: string, table = 1) => loyaltyCard(call(`loyalty-card?table=${table}`, { headers: { 'x-card-token': token } }), ctx());

/** The guest sends, the cashier accepts: the order that results, with its version. */
async function accepted(productIds: string[], card?: object, table = 1) {
  const response = await order(productIds, card, table);
  expect(response.status).toBe(201);
  const requestId = (await prisma().posCustomerOrder.findFirstOrThrow({ where: { restaurantId: a.id }, orderBy: { createdAt: 'desc' } })).id;
  const tableRow = await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id, number: table } });
  const live = await prisma().posOrder.findFirst({ where: { restaurantId: a.id, tableId: tableRow.id, status: { notIn: ['PAID', 'CANCELLED', 'REJECTED'] } } });
  const done = dataOf(await run(cashier, acceptPosRequest, { requestId, ...(live ? { expectedOrderVersion: live.version } : {}) }));
  return { requestId, orderId: done.orderId, version: done.version };
}

async function pay(orderId: string, expectedTotal: number, expectedVersion: number, lineIds?: string[]) {
  const paid = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion, expectedTotal, amountReceived: expectedTotal, ...(lineIds ? { lineIds } : {}) }));
  return paid;
}

const stampsOf = async (token: string) => (await prisma().posLoyaltyCard.findFirst({ where: { restaurantId: a.id, cardKey: sha(token) } }))?.stamps ?? null;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('earning a stamp', () => {
  it('gives one stamp when the order is fully paid, and keeps only the hash of the token', async () => {
    await world();
    await run(cashier, openPosShift, { openingFloat: 0 });
    const { requestId, orderId, version } = await accepted([burger], { token: TOKEN, redeem: false });
    const request = await prisma().posCustomerOrder.findUniqueOrThrow({ where: { id: requestId } });
    expect(request.cardKey).toBe(sha(TOKEN));
    expect(JSON.stringify(request)).not.toContain(TOKEN);
    expect(await stampsOf(TOKEN)).toBeNull();
    await pay(orderId, 5000, version);
    expect(await stampsOf(TOKEN)).toBe(1);
    expect(await prisma().posLoyaltyStamp.count({ where: { restaurantId: a.id, kind: 'EARN' } })).toBe(1);
  });

  it('waits for the last part of a bill paid in parts', async () => {
    await world();
    await run(cashier, openPosShift, { openingFloat: 0 });
    const { orderId, version } = await accepted([burger, juice], { token: TOKEN, redeem: false });
    const lines = await prisma().posOrderLine.findMany({ where: { orderId }, orderBy: { id: 'asc' } });
    const first = lines.find((line) => line.productId === burger)!;
    const second = lines.find((line) => line.productId === juice)!;
    const part = await pay(orderId, 5000, version, [first.id]);
    expect(await stampsOf(TOKEN)).toBeNull();
    const next = await prisma().posOrder.findUniqueOrThrow({ where: { id: orderId } });
    await pay(orderId, 2000, next.version, [second.id]);
    expect(part).toBeDefined();
    expect(await stampsOf(TOKEN)).toBe(1);
  });

  it('counts a card once for an order, however many of its requests carried it', async () => {
    await world();
    await run(cashier, openPosShift, { openingFloat: 0 });
    const first = await accepted([burger], { token: TOKEN, redeem: false });
    const second = await accepted([juice], { token: TOKEN, redeem: false });
    expect(second.orderId).toBe(first.orderId);
    const live = await prisma().posOrder.findUniqueOrThrow({ where: { id: first.orderId } });
    await pay(first.orderId, 7000, live.version);
    expect(await stampsOf(TOKEN)).toBe(1);
  });

  it('stamps nothing for a request without a card, with the program off, or on a plan without it', async () => {
    await world();
    await run(cashier, openPosShift, { openingFloat: 0 });
    const plain = await accepted([burger]);
    expect((await prisma().posCustomerOrder.findUniqueOrThrow({ where: { id: plain.requestId } })).cardKey).toBeNull();
    await pay(plain.orderId, 5000, plain.version);
    expect(await prisma().posLoyaltyCard.count()).toBe(0);

    await resetWorld();
    await world({ loyalty: false });
    await run(cashier, openPosShift, { openingFloat: 0 });
    const off = await accepted([burger], { token: TOKEN, redeem: false });
    expect((await prisma().posCustomerOrder.findUniqueOrThrow({ where: { id: off.requestId } })).cardKey).toBeNull();

    await resetWorld();
    await world({ plan: 'BASIC' });
    await run(cashier, openPosShift, { openingFloat: 0 });
    const basic = await accepted([burger], { token: TOKEN, redeem: false });
    expect((await prisma().posCustomerOrder.findUniqueOrThrow({ where: { id: basic.requestId } })).cardKey).toBeNull();
    await pay(basic.orderId, 5000, basic.version);
    expect(await prisma().posLoyaltyCard.count()).toBe(0);
  });

  it('rejects a card token that is too short or has odd characters', async () => {
    await world();
    expect((await order([burger], { token: 'short', redeem: false })).status).toBe(400);
    expect((await order([burger], { token: 'x'.repeat(20) + '!!!!', redeem: false })).status).toBe(400);
  });
});

describe('the reward', () => {
  it('is asked for only by a full card, shows on the cashier request, and spends the stamps when the order is paid', async () => {
    await world({ stamps: 3 });
    await run(cashier, openPosShift, { openingFloat: 0 });
    // An empty card cannot ask for it.
    const early = await order([burger], { token: TOKEN, redeem: true });
    expect(early.status).toBe(201);
    expect((await prisma().posCustomerOrder.findFirstOrThrow({ where: { restaurantId: a.id } })).redeemReward).toBe(false);
    await prisma().posCustomerOrder.deleteMany({ where: { restaurantId: a.id } });

    await prisma().posLoyaltyCard.create({ data: { restaurantId: a.id, cardKey: sha(TOKEN), stamps: 3 } });
    const { requestId, orderId, version } = await accepted([burger], { token: TOKEN, redeem: true });
    expect((await prisma().posCustomerOrder.findUniqueOrThrow({ where: { id: requestId } })).redeemReward).toBe(true);
    await pay(orderId, 5000, version);
    // 3 - 3 spent + 1 earned.
    expect(await stampsOf(TOKEN)).toBe(1);
    expect((await prisma().posLoyaltyStamp.findMany({ where: { restaurantId: a.id }, orderBy: { kind: 'asc' } })).map((row) => [row.kind, row.amount])).toEqual([['EARN', 1], ['SPEND', 3]]);
  });

  it('shows its text on the pending request for the cashier', async () => {
    await world({ stamps: 3 });
    await prisma().posLoyaltyCard.create({ data: { restaurantId: a.id, cardKey: sha(TOKEN), stamps: 3 } });
    expect((await order([burger], { token: TOKEN, redeem: true })).status).toBe(201);
    expect((await order([juice], { token: OTHER, redeem: true }, 2)).status).toBe(201);
    const pending = await listPendingDetails(delegates(scopedClient(prisma(), { restaurantId: a.id })), a.id);
    expect(pending.map((request) => [request.tableNumber, request.reward])).toEqual([[1, 'Free juice'], [2, null]]);
  });
});

describe('reading the card', () => {
  it('answers with the stamps, what fills a card and the reward; an unknown token reads as empty', async () => {
    await world({ stamps: 3 });
    await prisma().posLoyaltyCard.create({ data: { restaurantId: a.id, cardKey: sha(TOKEN), stamps: 3 } });
    const mine = await readRoute(TOKEN);
    expect(mine.status).toBe(200);
    expect(await mine.json()).toEqual({ stamps: 3, required: 3, reward: 'Free juice', full: true });
    expect(await (await readRoute(OTHER)).json()).toEqual({ stamps: 0, required: 3, reward: 'Free juice', full: false });
  });

  it('answers 404 when the program is off, the plan lacks it, or the table is unknown, and 400 without a good token', async () => {
    await world({ loyalty: false });
    expect((await readRoute(TOKEN)).status).toBe(404);
    await resetWorld();
    await world({ plan: 'BASIC' });
    expect((await readRoute(TOKEN)).status).toBe(404);
    await resetWorld();
    await world();
    expect((await readRoute(TOKEN, 99)).status).toBe(404);
    expect((await readRoute('short')).status).toBe(400);
  });

  it('never shows one restaurant the card of another, even with the same token', async () => {
    await world({ stamps: 3 });
    await prisma().posLoyaltyCard.create({ data: { restaurantId: a.id, cardKey: sha(TOKEN), stamps: 2 } });
    const mine = (await getTenant(slug))!;
    expect((await readCard(prisma(), mine, { table: 1, token: TOKEN })).stamps).toBe(2);

    const otherSlug = `loy-other-${counter}`;
    const b = await restaurant('Other');
    await prisma().restaurant.update({ where: { id: b.id }, data: { plan: 'PRO' } });
    const menu = await prisma().menu.create({ data: { restaurantId: b.id, name: 'm', slug: otherSlug, currency: 'IQD', locales: ['en'], defaultLocale: 'en', timezone: 'Asia/Baghdad' } });
    await prisma().menuSlug.create({ data: { slug: otherSlug, menuId: menu.id } });
    const food = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: en('Food') } });
    await prisma().product.create({ data: { menuId: menu.id, categoryId: food.id, slug: 'tea', sortOrder: 1, basePrice: 1000, translations: en('Tea') } });
    await publishFixture(prisma(), menu.id);
    await prisma().posSettings.create({ data: { restaurantId: b.id, qrOrderingEnabled: true, catalogMenuId: menu.id, loyaltyEnabled: true, loyaltyReward: 'x' } });
    const areaId = (await prisma().posArea.create({ data: { restaurantId: b.id, name: 'Hall' } })).id;
    await prisma().posTable.create({ data: { restaurantId: b.id, areaId, number: 1 } });
    const theirs = (await getTenant(otherSlug))!;
    expect((await readCard(prisma(), theirs, { table: 1, token: TOKEN })).stamps).toBe(0);
  });
});

describe('the owner switch', () => {
  const base = { serviceRatePercent: 0, taxRatePercent: 0, enabledPaymentMethods: ['CASH'], tableRingMinutes: 60, kitchenPrintEnabled: false, kitchenScreenEnabled: false, qrOrderingEnabled: true, takeawayEnabled: false, deliveryEnabled: false, complaintsEnabled: false, idleMinutes: 15, requireApproval: true };

  it('cannot be switched on by a plan without the stamp card, and is saved on a plan that has it', async () => {
    await world({ plan: 'BASIC', loyalty: false });
    const settings = await prisma().posSettings.findFirstOrThrow({ where: { restaurantId: a.id } });
    const input = { ...base, loyaltyEnabled: true, loyaltyStampsRequired: 5, loyaltyReward: 'Free tea', version: settings.version };
    const manager = await person('loyalty-manager', { staff: [a.id, 'MANAGER'] });
    expect(failureOf(await run(manager, updatePosSettings, input)).code).toBe('UPGRADE_REQUIRED');
    expect((await prisma().posSettings.findFirstOrThrow({ where: { restaurantId: a.id } })).loyaltyEnabled).toBe(false);

    await prisma().restaurant.update({ where: { id: a.id }, data: { plan: 'PRO' } });
    expect(codeOf(await run(manager, updatePosSettings, input))).toBe('OK');
    const saved = await prisma().posSettings.findFirstOrThrow({ where: { restaurantId: a.id } });
    expect([saved.loyaltyEnabled, saved.loyaltyStampsRequired, saved.loyaltyReward]).toEqual([true, 5, 'Free tea']);
  });

  it('refuses a stamp count outside 3 to 20 and a switch on with no reward text', async () => {
    await world({ loyalty: false });
    const manager = await person('loyalty-manager', { staff: [a.id, 'MANAGER'] });
    const version = (await prisma().posSettings.findFirstOrThrow({ where: { restaurantId: a.id } })).version;
    expect(codeOf(await run(manager, updatePosSettings, { ...base, loyaltyEnabled: false, loyaltyStampsRequired: 2, loyaltyReward: '', version }))).toBe('INVALID');
    expect(codeOf(await run(manager, updatePosSettings, { ...base, loyaltyEnabled: false, loyaltyStampsRequired: 21, loyaltyReward: '', version }))).toBe('INVALID');
    expect(failureOf(await run(manager, updatePosSettings, { ...base, loyaltyEnabled: true, loyaltyStampsRequired: 5, loyaltyReward: '', version }))).toBeDefined();
  });
});
