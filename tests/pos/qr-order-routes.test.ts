import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as availability } from '@/app/api/[tenant]/qr-order/availability/route';
import { GET as status } from '@/app/api/[tenant]/qr-order/[publicId]/route';
import { POST as submit } from '@/app/api/[tenant]/qr-order/route';
import { publishFixture } from '../helpers/db';
import { prisma, resetWorld, restaurant, useTestDatabase } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const en = (name: string) => ({ en: { name } });

let counter = 0;
let slug = '';
let a: { id: string };
let menuId = '';
let burger = '';
let juice = '';
let cake = '';
let sizeL = '';
let cheese = '';
let ip = 0;

/** A restaurant with a published menu, a cashier subscription, QR ordering on and tables 1 to 3. */
async function world(options: { qr?: boolean; catalog?: boolean; cashier?: 'ACTIVE' | 'none' } = {}) {
  slug = `qr-a-${++counter}`;
  a = await restaurant(`QR A ${counter}`, options.cashier ?? 'ACTIVE');
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug, currency: 'IQD', locales: ['en'], defaultLocale: 'en', timezone: 'Asia/Baghdad' },
  });
  menuId = menu.id;
  await prisma().menuSlug.create({ data: { slug, menuId } });
  const category = await prisma().category.create({ data: { menuId, slug: 'food', sortOrder: 1, translations: en('Food') } });
  const product = (slugName: string, basePrice: number, name: string, extra: object = {}) =>
    prisma().product.create({ data: { menuId, categoryId: category.id, slug: slugName, sortOrder: 1, basePrice, translations: en(name), ...extra } });
  burger = (await product('burger', 5000, 'Burger')).id;
  juice = (await product('juice', 2000, 'Juice')).id;
  cake = (await product('cake', 3000, 'Cake', { isAvailable: false })).id;
  await prisma().productVariant.create({ data: { menuId, productId: burger, priceDelta: 0, isDefault: true, translations: en('Small') } });
  sizeL = (await prisma().productVariant.create({ data: { menuId, productId: burger, priceDelta: 1500, sortOrder: 1, translations: en('Large') } })).id;
  const group = await prisma().modifierGroup.create({ data: { menuId, productId: burger, minSelect: 0, maxSelect: 1, translations: en('Extras') } });
  cheese = (await prisma().modifierOption.create({ data: { menuId, groupId: group.id, priceDelta: 500, translations: en('Cheese') } })).id;
  await publishFixture(prisma(), menuId);
  await prisma().posSettings.create({
    data: { restaurantId: a.id, qrOrderingEnabled: options.qr ?? true, catalogMenuId: options.catalog === false ? null : menuId },
  });
  const areaId = (await prisma().posArea.create({ data: { restaurantId: a.id, name: 'Hall' } })).id;
  await prisma().posTable.createMany({ data: [1, 2, 3].map((number) => ({ restaurantId: a.id, areaId, number })) });
}

const call = (path: string, init?: RequestInit & { ip?: string }) =>
  new Request(`http://localhost/api/${slug}/${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-forwarded-for': init?.ip ?? `10.2.0.${++ip}`, ...(init?.headers ?? {}) } });
const send = (body: unknown, from?: string) =>
  submit(call('qr-order', { method: 'POST', body: JSON.stringify(body), ...(from ? { ip: from } : {}) }), { params: Promise.resolve({ tenant: slug }) });
const cart = (lines: object[], extra: object = {}) => ({ table: 1, locale: 'en', cart: { lines }, note: '', ...extra });
const line = (productId: string, extra: object = {}) => ({ productId, quantity: 1, ...extra });
const read = (publicId: string, table = 1) =>
  status(call(`qr-order/${publicId}?table=${table}`), { params: Promise.resolve({ tenant: slug, publicId }) });
const available = (table = 1) => availability(call(`qr-order/availability?table=${table}`), { params: Promise.resolve({ tenant: slug }) });

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

describe('the gate', () => {
  it('is open for a cashier restaurant with QR on, its catalog menu and an existing table', async () => {
    await world();
    expect(await (await available(1)).json()).toEqual({ available: true });
    expect(await (await available(3)).json()).toEqual({ available: true });
  });

  it.each([
    ['QR ordering off', { qr: false }],
    ['another menu than the catalog menu', { catalog: false }],
    ['no cashier subscription', { cashier: 'none' as const }],
  ])('answers available:false and 404 on submit when %s', async (_name, options) => {
    await world(options);
    expect(await (await available(1)).json()).toEqual({ available: false });
    expect((await send(cart([line(juice)]))).status).toBe(404);
  });

  it('answers false for a table that does not exist, a lapsed subscription and a bad number', async () => {
    await world();
    expect(await (await available(9)).json()).toEqual({ available: false });
    expect(await (await available('x' as unknown as number)).json()).toEqual({ available: false });
    await prisma().subscription.updateMany({ where: { restaurantId: a.id }, data: { currentPeriodStart: new Date(Date.now() - 400 * 86_400_000), currentPeriodEnd: new Date(Date.now() - 365 * 86_400_000) } });
    expect(await (await available(1)).json()).toEqual({ available: false });
    expect((await send(cart([line(juice)]))).status).toBe(404);
  });

  it('answers 404 for an unknown restaurant', async () => {
    await world();
    slug = 'no-such-menu';
    expect((await send(cart([line(juice)]))).status).toBe(404);
  });
});

describe('submitting', () => {
  it('stores the Menu prices, names and options as snapshots and returns a public id', async () => {
    await world();
    const response = await send(cart([line(burger, { variantId: sizeL, optionIds: [cheese], quantity: 2, note: ' no onion ' }), line(juice)], { note: ' hurry ' }));
    expect(response.status).toBe(201);
    const { publicId } = await response.json();
    const stored = await prisma().posCustomerOrder.findUniqueOrThrow({ where: { publicId }, include: { lines: { orderBy: { nameSnapshot: 'asc' } } } });
    expect(stored).toMatchObject({ restaurantId: a.id, tableNumber: 1, status: 'PENDING', customerNote: 'hurry' });
    const [first, second] = stored.lines;
    expect(first).toMatchObject({ nameSnapshot: 'Burger', unitPriceSnapshot: 5000, quantity: 2, note: 'no onion', promoDiscountPerUnit: 0 });
    expect(first!.optionsSnapshot).toEqual([
      { id: sizeL, name: 'Large', priceDelta: 1500 },
      { id: cheese, name: 'Cheese', priceDelta: 500 },
    ]);
    expect(second).toMatchObject({ nameSnapshot: 'Juice', unitPriceSnapshot: 2000, quantity: 1 });
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'pos.request.submit' } });
    expect(audit).toMatchObject({ actorId: null, restaurantId: a.id, entityId: stored.id });
  });

  it('keeps the promotion as a discount per unit so the cashier charges what the Menu showed', async () => {
    await world();
    await prisma().promotion.create({ data: { menuId, kind: 'DISCOUNT', percentOff: 10, productIds: [juice], categoryIds: [], translations: { en: { title: 'Ten off' } } } });
    await publishFixture(prisma(), menuId, 'Promo');
    const response = await send(cart([line(juice, { quantity: 2 })]));
    expect(response.status).toBe(201);
    const stored = await prisma().posCustomerOrderLine.findFirstOrThrow({});
    expect(stored.unitPriceSnapshot).toBe(2000);
    expect(stored.promoDiscountPerUnit).toBeGreaterThan(0);
    expect(stored.promoDiscountPerUnit).toBeLessThan(2000);
  });

  it('rejects a price, a total or any unknown field in the body', async () => {
    await world();
    expect((await send(cart([line(juice, { unitPrice: 1 })]))).status).toBe(400);
    expect((await send(cart([line(juice, { price: 1 })]))).status).toBe(400);
    expect((await send({ ...cart([line(juice)]), total: 1 })).status).toBe(400);
    expect(await prisma().posCustomerOrder.count()).toBe(0);
  });

  it('refuses an unknown or unavailable product, a missing size choice or option of another product, a bundle, and too much', async () => {
    await world();
    expect((await send(cart([line('nope')]))).status).toBe(400);
    expect((await send(cart([line(cake)]))).status).toBe(400);
    expect((await send(cart([line(burger, { optionIds: ['nope'] })]))).status).toBe(400);
    expect((await send(cart([line(juice, { optionIds: [cheese] })]))).status).toBe(400);
    expect((await send(cart([line(juice, { variantId: sizeL })]))).status).toBe(400);
    const bundle = await send(cart([line(juice)], { cart: { lines: [line(juice)], bundles: [{ bundleId: 'b', quantity: 1 }] } }));
    expect(bundle.status).toBe(400);
    expect((await bundle.json()).error.code).toBe('BUNDLES_UNSUPPORTED');
    expect((await send(cart([line(juice, { quantity: 21 })]))).status).toBe(400);
    expect((await send(cart([line(juice, { note: 'x'.repeat(301) })]))).status).toBe(400);
    expect((await send(cart(Array.from({ length: 31 }, () => line(juice))))).status).toBe(400);
    expect((await send(cart([line(juice)], { note: 'x'.repeat(301) }))).status).toBe(400);
    expect((await send(cart([]))).status).toBe(400);
    expect(await prisma().posCustomerOrder.count()).toBe(0);
  });

  it('refuses a product the till switched off as sold out', async () => {
    await world();
    await prisma().posProductSetting.create({ data: { restaurantId: a.id, productId: juice, soldOutOverride: true } });
    expect((await send(cart([line(juice)]))).status).toBe(400);
  });

  it('refuses a product of another restaurant', async () => {
    await world();
    const other = await prisma().restaurant.create({ data: { name: 'Other' } });
    const otherMenu = await prisma().menu.create({ data: { restaurantId: other.id, name: 'o', slug: `other-${counter}`, currency: 'IQD', locales: ['en'], defaultLocale: 'en', timezone: 'Asia/Baghdad' } });
    const otherCategory = await prisma().category.create({ data: { menuId: otherMenu.id, slug: 'x', translations: en('x') } });
    const foreign = await prisma().product.create({ data: { menuId: otherMenu.id, categoryId: otherCategory.id, slug: 'x', basePrice: 1, translations: en('x') } });
    expect((await send(cart([line(foreign.id)]))).status).toBe(400);
  });

  it('round trips a 120-character name and a 300-character note with newlines', async () => {
    await world();
    const long = 'ن'.repeat(120);
    await prisma().product.update({ where: { id: juice }, data: { translations: en(long) } });
    await publishFixture(prisma(), menuId, 'Long');
    const note = ('س\n'.repeat(150)).slice(0, 300);
    const { publicId } = await (await send(cart([line(juice, { note })]))).json();
    const view = await (await read(publicId)).json();
    expect(view.lines[0]).toMatchObject({ name: long, note: note.trim() });
  });
});

describe('the limits', () => {
  it('stops a fourth waiting request and a sixth in ten minutes at one table', async () => {
    await world();
    for (let i = 0; i < 3; i++) expect((await send(cart([line(juice)]))).status).toBe(201);
    const fourth = await send(cart([line(juice)]));
    expect(fourth.status).toBe(429);
    expect((await fourth.json()).error.code).toBe('TOO_MANY_REQUESTS');
    // Another table is not affected.
    expect((await send(cart([line(juice)], { table: 2 }))).status).toBe(201);
    // Deciding the waiting ones frees the waiting count but not the ten-minute count.
    await prisma().posCustomerOrder.updateMany({ where: { tableNumber: 1 }, data: { status: 'REJECTED' } });
    expect((await send(cart([line(juice)]))).status).toBe(201);
    expect((await send(cart([line(juice)]))).status).toBe(201);
    expect((await send(cart([line(juice)]))).status).toBe(429);
  });

  it('frees the ten-minute count after ten minutes, and a request nobody decided stops waiting after an hour', async () => {
    await world();
    for (let i = 0; i < 5; i++) await prisma().posCustomerOrder.create({ data: { restaurantId: a.id, tableId: (await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id, number: 1 } })).id, tableNumber: 1, locale: 'en', status: 'REJECTED' } });
    expect((await send(cart([line(juice)]))).status).toBe(429);
    await prisma().posCustomerOrder.updateMany({ where: { tableNumber: 1 }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
    expect((await send(cart([line(juice)]))).status).toBe(201);
    // Three that nobody decided stop the table; after an hour they no longer count.
    await send(cart([line(juice)]));
    await send(cart([line(juice)]));
    expect((await send(cart([line(juice)]))).status).toBe(429);
    await prisma().posCustomerOrder.updateMany({ where: { tableNumber: 1, status: 'PENDING' }, data: { createdAt: new Date(Date.now() - 61 * 60_000) } });
    expect((await send(cart([line(juice)]))).status).toBe(201);
  });

  it('stops the 301st request of a restaurant in an hour', async () => {
    await world();
    const table = await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id, number: 3 } });
    await prisma().posCustomerOrder.createMany({
      data: Array.from({ length: 300 }, (_, i) => ({ restaurantId: a.id, tableId: table.id, tableNumber: 3, locale: 'en', status: 'REJECTED' as const, createdAt: new Date(Date.now() - (i % 50) * 60_000) })),
    });
    expect((await send(cart([line(juice)]))).status).toBe(429);
  });

  it('stops the eleventh submission of one address in a minute', async () => {
    await world();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await send(cart([line(juice)], { table: (i % 3) + 1 }), '10.9.9.9')).status);
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.slice(0, 10).every((code) => code === 201 || code === 429)).toBe(true);
  });
});

describe('reading the state of a request', () => {
  it('shows waiting, then accepted and rejected with the reason, only for the right table', async () => {
    await world();
    const { publicId } = await (await send(cart([line(burger, { optionIds: [cheese] })]))).json();
    expect(await (await read(publicId)).json()).toMatchObject({ status: 'PENDING', rejectReason: '', lines: [{ name: 'Burger', quantity: 1, options: ['Small', 'Cheese'], note: '' }] });
    await prisma().posCustomerOrder.updateMany({ where: { publicId }, data: { status: 'REJECTED', rejectReason: 'Kitchen closed' } });
    expect(await (await read(publicId)).json()).toMatchObject({ status: 'REJECTED', rejectReason: 'Kitchen closed' });
    await prisma().posCustomerOrder.updateMany({ where: { publicId }, data: { status: 'ACCEPTED' } });
    expect((await (await read(publicId)).json()).status).toBe('ACCEPTED');
  });

  it('answers 404 for another table, a made-up id, a missing table and a closed gate', async () => {
    await world();
    const { publicId } = await (await send(cart([line(juice)]))).json();
    expect((await read(publicId, 2)).status).toBe(404);
    expect((await read('abcdefghijkl')).status).toBe(404);
    expect((await read('x')).status).toBe(404);
    expect((await status(call(`qr-order/${publicId}`), { params: Promise.resolve({ tenant: slug, publicId }) })).status).toBe(404);
    await prisma().posSettings.updateMany({ where: { restaurantId: a.id }, data: { qrOrderingEnabled: false } });
    expect((await read(publicId)).status).toBe(404);
  });

  it('does not show another restaurant its request', async () => {
    await world();
    const { publicId } = await (await send(cart([line(juice)]))).json();
    const firstSlug = slug;
    await world();
    expect(firstSlug).not.toBe(slug);
    expect((await read(publicId)).status).toBe(404);
  });

  it('reports EXPIRED once an hour has passed', async () => {
    await world();
    const { publicId } = await (await send(cart([line(juice)]))).json();
    await prisma().posCustomerOrder.updateMany({ where: { publicId }, data: { createdAt: new Date(Date.now() - 61 * 60_000) } });
    expect((await (await read(publicId)).json()).status).toBe('EXPIRED');
  });

  it('shows no price and no staff or other table data', async () => {
    await world();
    const { publicId } = await (await send(cart([line(juice)]))).json();
    const view = await (await read(publicId)).json();
    expect(Object.keys(view).sort()).toEqual(['awaitingCaptain', 'lines', 'rejectReason', 'status']);
    expect(Object.keys(view.lines[0]).sort()).toEqual(['name', 'note', 'options', 'quantity']);
  });
});
