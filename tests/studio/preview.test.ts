import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { getCatalog, getTenant } from '@/server/data/public-menu';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as preview from '@/server/studio/queries/preview';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

const prisma = () => getPrisma();

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};

let a: Awaited<ReturnType<typeof createMenuFixture>>;
let owner: Actor;

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  a = await createMenuFixture(prisma(), 'preview-a');
  await prisma().user.create({ data: { id: 'owner-p', name: 'Owner', email: 'owner-p@example.com' } });
  await prisma().membership.create({ data: { userId: 'owner-p', restaurantId: a.restaurant.id, role: 'OWNER' } });
  owner = (await loadActor(prisma(), 'owner-p')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
});

describe('the draft preview', () => {
  it('renders the draft, not the live revision', async () => {
    await prisma().product.update({ where: { id: a.product.id }, data: { basePrice: 999 } });
    const { view, tenant } = dataOf(await runQuery(prisma(), owner, preview.draft, { menuId: a.menu.id, locale: 'en' }));
    expect(view.products[0]!.basePrice).toBe(999);
    expect(tenant).toMatchObject({ id: a.menu.id, slug: 'preview-a', revisionId: 'draft' });
    // Guests still get the published price.
    expect((await getCatalog((await getTenant('preview-a'))!)).products[0]!.basePrice).toBe(300);
  });

  it('shows what is sold out right now', async () => {
    await prisma().product.update({ where: { id: a.product.id }, data: { isAvailable: false } });
    const { view } = dataOf(await runQuery(prisma(), owner, preview.draft, { menuId: a.menu.id, locale: 'ar' }));
    expect(view.products[0]!.orderState).toBe('UNAVAILABLE');
  });

  it('shows the dish counts the owner switched on, so the switch can be seen working', async () => {
    const order = await prisma().posOrder.create({ data: { restaurantId: a.restaurant.id, number: 1 } });
    const payment = await prisma().posPayment.create({ data: { restaurantId: a.restaurant.id, orderId: order.id, method: 'CASH', amountReceived: 0, totalsSnapshot: {} } });
    await prisma().posOrderLine.create({ data: { restaurantId: a.restaurant.id, orderId: order.id, productId: a.product.id, nameSnapshot: 'x', unitPriceSnapshot: 100, quantity: 4, paymentId: payment.id } });
    await prisma().productViewTotal.create({ data: { menuId: a.menu.id, productId: a.product.id, views: 9 } });
    const off = dataOf(await runQuery(prisma(), owner, preview.draft, { menuId: a.menu.id, locale: 'en' }));
    expect(off.view.products[0]).not.toHaveProperty('counts');
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { plan: 'PRO' } });
    await prisma().menu.update({ where: { id: a.menu.id }, data: { dishCountsEnabled: true } });
    const on = dataOf(await runQuery(prisma(), owner, preview.draft, { menuId: a.menu.id, locale: 'en' }));
    expect(on.view.products[0]!.counts).toEqual({ orders: 4, views: 9 });
  });

  it('refuses a language the menu does not offer', async () => {
    await prisma().menu.update({ where: { id: a.menu.id }, data: { locales: ['en'] } });
    const result = await runQuery(prisma(), owner, preview.draft, { menuId: a.menu.id, locale: 'ckb' });
    expect(result.ok ? 'OK' : result.error.code).toBe('NOT_FOUND');
  });
});
