import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as waiterCall } from '@/app/api/[tenant]/waiter-call/route';
import { getTenant } from '@/server/data/public-menu';
import { callForBill, callForWaiter, listOpenBillCalls } from '@/server/pos/bill-calls';
import { delegates, scopedClient } from '@/server/data/tenant-db';
import { publishFixture } from '../helpers/db';
import { prisma, resetWorld, restaurant, useTestDatabase } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let counter = 0;
let slug = '';
let restaurantId = '';
let ip = 0;

async function world(plan: 'BASIC' | 'PRO' = 'PRO') {
  slug = `waiter-${++counter}`;
  restaurantId = (await restaurant(`Waiter ${counter}`, 'ACTIVE')).id;
  await prisma().restaurant.update({ where: { id: restaurantId }, data: { plan } });
  const menu = await prisma().menu.create({ data: { restaurantId, name: 'm', slug, currency: 'IQD', locales: ['en'], defaultLocale: 'en', timezone: 'Asia/Baghdad' } });
  await prisma().menuSlug.create({ data: { slug, menuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: { en: { name: 'Food' } } } });
  await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: { en: { name: 'Burger' } } } });
  await publishFixture(prisma(), menu.id);
  await prisma().posSettings.create({ data: { restaurantId, qrOrderingEnabled: true, catalogMenuId: menu.id } });
  const areaId = (await prisma().posArea.create({ data: { restaurantId, name: 'Hall' } })).id;
  await prisma().posTable.createMany({ data: [1, 2].map((number) => ({ restaurantId, areaId, number })) });
}

const post = (table: number) =>
  waiterCall(
    new Request(`http://localhost/api/${slug}/waiter-call`, { method: 'POST', body: JSON.stringify({ table }), headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.6.0.${++ip}` } }),
    { params: Promise.resolve({ tenant: slug }) },
  );
const rows = () => prisma().posBillCall.findMany({ where: { restaurantId }, orderBy: { createdAt: 'asc' } });

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

describe('a guest calls a waiter', () => {
  it('leaves one unseen call of its own kind, and touches no order', async () => {
    await world();
    const table = await prisma().posTable.findFirstOrThrow({ where: { restaurantId, number: 1 } });
    const order = await prisma().posOrder.create({ data: { restaurantId, tableId: table.id, kind: 'DINE_IN', status: 'OPEN', number: 1 } });
    expect((await post(1)).status).toBe(200);
    expect((await post(1)).status).toBe(200);
    const calls = await rows();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tableNumber: 1, kind: 'WAITER', seenAt: null });
    expect((await prisma().posOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('OPEN');
    const listed = await listOpenBillCalls(delegates(scopedClient(prisma(), { restaurantId })), restaurantId);
    expect(listed.map((call) => [call.tableNumber, call.kind])).toEqual([[1, 'WAITER']]);
  });

  it('is counted apart from the bill: both can be open at once', async () => {
    await world();
    const tenant = (await getTenant(slug))!;
    await callForWaiter(prisma(), tenant, { table: 1 });
    await callForBill(prisma(), tenant, { table: 1 });
    expect((await rows()).map((call) => call.kind).sort()).toEqual(['BILL', 'WAITER']);
  });

  it('stops at three calls in ten minutes, then answers 429', async () => {
    await world();
    for (let n = 0; n < 3; n++) {
      expect((await post(2)).status).toBe(200);
      await prisma().posBillCall.updateMany({ where: { restaurantId }, data: { seenAt: new Date() } });
    }
    expect((await post(2)).status).toBe(429);
  });

  it('answers 404 on a plan without the feature, and on a table that does not exist', async () => {
    await world('BASIC');
    expect((await post(1)).status).toBe(404);
    expect(await rows()).toHaveLength(0);
    await world('PRO');
    expect((await post(9)).status).toBe(404);
  });
});
