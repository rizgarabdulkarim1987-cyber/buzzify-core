import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as readRoute, PUT as writeRoute } from '@/app/api/[tenant]/table-basket/route';
import { POST as sendRoute } from '@/app/api/[tenant]/table-basket/send/route';
import { publishFixture } from '../helpers/db';
import { prisma, resetWorld, restaurant, useTestDatabase } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const en = (name: string) => ({ en: { name } });

let counter = 0;
let slug = '';
let restaurantId = '';
let menuId = '';
let burger = '';
let juice = '';
let cake = '';
let ip = 0;

const alice = 'alice-token-0123456789';
const bob = 'bob-token-0123456789ab';
const stranger = 'stranger-token-0123456789';

/** A restaurant with a published menu, a cashier subscription, QR ordering on and tables 1 to 3. */
async function world(options: { qr?: boolean; plan?: 'BASIC' | 'PREMIUM' } = {}) {
  slug = `basket-${++counter}`;
  const row = await restaurant(`Basket ${counter}`, 'ACTIVE');
  restaurantId = row.id;
  if (options.plan) await prisma().restaurant.update({ where: { id: restaurantId }, data: { plan: options.plan } });
  const menu = await prisma().menu.create({ data: { restaurantId, name: 'm', slug, currency: 'IQD', locales: ['en'], defaultLocale: 'en', timezone: 'Asia/Baghdad' } });
  menuId = menu.id;
  await prisma().menuSlug.create({ data: { slug, menuId } });
  const category = await prisma().category.create({ data: { menuId, slug: 'food', sortOrder: 1, translations: en('Food') } });
  const product = (slugName: string, basePrice: number, name: string, extra: object = {}) =>
    prisma().product.create({ data: { menuId, categoryId: category.id, slug: slugName, sortOrder: 1, basePrice, translations: en(name), ...extra } });
  burger = (await product('burger', 5000, 'Burger')).id;
  juice = (await product('juice', 2000, 'Juice')).id;
  cake = (await product('cake', 3000, 'Cake', { isAvailable: false })).id;
  await publishFixture(prisma(), menuId);
  await prisma().posSettings.create({ data: { restaurantId, qrOrderingEnabled: options.qr ?? true, catalogMenuId: menuId } });
  const areaId = (await prisma().posArea.create({ data: { restaurantId, name: 'Hall' } })).id;
  await prisma().posTable.createMany({ data: [1, 2, 3].map((number) => ({ restaurantId, areaId, number })) });
}

const ctx = () => ({ params: Promise.resolve({ tenant: slug }) });
const request = (path: string, init: RequestInit = {}) =>
  new Request(`http://localhost/api/${slug}/${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.3.0.${++ip}`, ...(init.headers ?? {}) } });
const read = (token: string, table = 1) => readRoute(request(`table-basket?table=${table}`, { headers: { 'x-basket-token': token } }), ctx());
const write = (token: string, lines: object[], extra: object = {}) =>
  writeRoute(request('table-basket', { method: 'PUT', body: JSON.stringify({ table: 1, token, name: '', lines, ...extra }) }), ctx());
const send = (token: string, extra: object = {}) =>
  sendRoute(request('table-basket/send', { method: 'POST', body: JSON.stringify({ table: 1, token, locale: 'en', note: '', ...extra }) }), ctx());
const line = (productId: string, quantity = 1) => ({ productId, quantity });

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

describe('sharing a table', () => {
  it('lets two guests each fill their own part, and each sees both, priced by the server', async () => {
    await world();
    expect((await write(alice, [line(burger, 2)], { name: 'Alice' })).status).toBe(204);
    expect((await write(bob, [line(juice)])).status).toBe(204);

    const forAlice = await (await read(alice)).json();
    expect(forAlice.parts.map((part: { mine: boolean; name: string }) => [part.mine, part.name])).toEqual([
      [true, 'Alice'],
      [false, ''],
    ]);
    expect(forAlice.parts[0].lines[0]).toMatchObject({ name: 'Burger', quantity: 2, total: 10_000 });
    expect(forAlice.total).toBe(12_000);
    // Bob reads the same basket with the roles turned round, and nobody's token or hash is in it.
    const forBob = await (await read(bob)).json();
    expect(forBob.parts.map((part: { mine: boolean }) => part.mine)).toEqual([false, true]);
    expect(JSON.stringify(forBob)).not.toMatch(/ownerKey|token/i);
  });

  it('writes only the caller’s own part, and removes it when sent empty', async () => {
    await world();
    await write(alice, [line(burger)]);
    await write(bob, [line(juice)]);
    await write(bob, [line(juice, 3)]);
    const view = await (await read(alice)).json();
    expect(view.parts[0].lines).toHaveLength(1);
    expect(view.parts[0].lines[0]).toMatchObject({ name: 'Burger', quantity: 1 });
    expect(view.parts[1].lines[0]).toMatchObject({ name: 'Juice', quantity: 3 });
    await write(bob, []);
    expect((await (await read(alice)).json()).parts).toHaveLength(1);
  });

  it('refuses a dish the menu does not offer, and a table of too many guests', async () => {
    await world();
    expect((await write(alice, [line(cake)])).status).toBe(400);
    for (let guest = 0; guest < 12; guest++) expect((await write(`guest-token-${String(guest).padStart(10, '0')}`, [line(juice)])).status).toBe(204);
    expect((await write(alice, [line(juice)])).status).toBe(409);
  });

  it('keeps each restaurant’s tables apart', async () => {
    await world();
    await write(alice, [line(burger)]);
    const first = slug;
    await world();
    expect((await (await read(alice)).json()).parts).toEqual([]);
    slug = first;
    expect((await (await read(alice)).json()).parts).toHaveLength(1);
  });
});

describe('the gate', () => {
  it.each([
    ['a plan without the table basket', { plan: 'BASIC' as const }],
    ['QR ordering switched off', { qr: false }],
  ])('answers 404 on every call with %s', async (_name, options) => {
    await world(options);
    expect((await read(alice)).status).toBe(404);
    expect((await write(alice, [line(burger)])).status).toBe(404);
    expect((await send(alice)).status).toBe(404);
  });

  it('needs a table and a token that look right', async () => {
    await world();
    expect((await readRoute(request('table-basket?table=1'), ctx())).status).toBe(400);
    expect((await read('short')).status).toBe(400);
  });
});

describe('sending for the table', () => {
  it('sends every part as one order the server prices, and every phone can follow it', async () => {
    await world();
    await write(alice, [line(burger, 2)]);
    await write(bob, [line(juice)]);
    const response = await send(bob, { note: 'No ice' });
    expect(response.status).toBe(201);
    const { publicId } = await response.json();

    const requests = await prisma().posCustomerOrder.findMany({ where: { restaurantId }, include: { lines: true } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ publicId, tableNumber: 1, customerNote: 'No ice' });
    expect(requests[0]!.lines.map((l) => [l.nameSnapshot, l.quantity, l.unitPriceSnapshot]).sort()).toEqual([
      ['Burger', 2, 5000],
      ['Juice', 1, 2000],
    ]);

    expect((await (await read(alice)).json()).sent).toEqual({ publicId });
    expect((await (await read(alice)).json()).parts).toEqual([]);
    // Nothing is left to send, and a second tap does not send the same dishes twice.
    expect((await send(alice)).status).toBe(400);
    expect(await prisma().posCustomerOrder.count({ where: { restaurantId } })).toBe(1);
  });

  it('is for a guest of the table only, and needs something to send', async () => {
    await world();
    await write(alice, [line(burger)]);
    expect((await send(stranger)).status).toBe(400);
    await write(alice, []);
    expect((await send(alice)).status).toBe(400);
    expect(await prisma().posCustomerOrder.count({ where: { restaurantId } })).toBe(0);
  });

  it('lets a guest start a new basket after the order was sent', async () => {
    await world();
    await write(alice, [line(burger)]);
    await send(alice);
    await write(alice, [line(juice)]);
    const view = await (await read(alice)).json();
    expect(view.parts[0].lines[0].name).toBe('Juice');
    expect(view.sent).toBeNull();
  });
});
