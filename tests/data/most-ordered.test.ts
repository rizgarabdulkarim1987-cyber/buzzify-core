import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadMostOrdered } from '@/server/data/most-ordered';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

/** "Most ordered" from real guest additions (docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.3). */

const prisma = testPrisma();
const DAY = 86_400_000;
let menuId = '';
let otherMenuId = '';
const ids: Record<string, string> = {};

async function adds(menu: string, productId: string, sessions: number, daysAgo = 1, type: 'ADD_TO_CART' | 'PAIRING_ADD' = 'ADD_TO_CART') {
  for (let i = 0; i < sessions; i++) {
    await prisma.analyticsEvent.create({
      data: { menuId: menu, anonymousSessionId: `${productId}-${daysAgo}-${i}`, type, productId, occurredAt: new Date(Date.now() - daysAgo * DAY) },
    });
  }
}

describe('the most ordered dishes (database)', () => {
  beforeAll(async () => {
    await resetTestData(prisma);
  });
  beforeEach(async () => {
    await resetTestData(prisma);
    const a = await createMenuFixture(prisma, 'most-a', { publish: false });
    const b = await createMenuFixture(prisma, 'most-b', { publish: false });
    menuId = a.menu.id;
    otherMenuId = b.menu.id;
    for (const slug of ['six', 'five', 'four', 'old', 'eight']) {
      ids[slug] = (await prisma.product.create({ data: { menuId, categoryId: a.category.id, slug, basePrice: 100, translations: { en: { name: slug } } } })).id;
    }
    ids.other = b.product.id;
  });
  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('gives the top three by guest sessions in 30 days, each with at least three', async () => {
    await adds(menuId, ids.six!, 6);
    await adds(menuId, ids.five!, 4);
    await adds(menuId, ids.five!, 1, 2, 'PAIRING_ADD');
    await adds(menuId, ids.four!, 4);
    await adds(menuId, ids.old!, 7, 40);
    await adds(menuId, ids.eight!, 8);
    await adds(otherMenuId, ids.other!, 20);
    expect(await loadMostOrdered(prisma, menuId, new Date())).toEqual([ids.eight, ids.six, ids.five]);
  });

  it('counts paid cashier sales, so a menu sold at the till gets its label without guests ordering', async () => {
    const restaurantId = (await prisma.menu.findUniqueOrThrow({ where: { id: menuId }, select: { restaurantId: true } })).restaurantId;
    const sold = async (productId: string, quantity: number, over: { paid?: boolean; cancelled?: boolean; daysAgo?: number } = {}) => {
      const order = await prisma.posOrder.create({ data: { restaurantId, number: Math.floor(Math.random() * 1e9), status: 'PAID' } });
      const payment = over.paid === false ? null : await prisma.posPayment.create({ data: { restaurantId, orderId: order.id, method: 'CASH', amountReceived: 100, totalsSnapshot: {} } });
      await prisma.posOrderLine.create({
        data: {
          restaurantId,
          orderId: order.id,
          productId,
          nameSnapshot: 'x',
          unitPriceSnapshot: 100,
          quantity,
          paymentId: payment?.id ?? null,
          cancelledAt: over.cancelled ? new Date() : null,
          createdAt: new Date(Date.now() - (over.daysAgo ?? 1) * DAY),
        },
      });
    };
    await sold(ids.six!, 4);
    await sold(ids.six!, 2);
    await sold(ids.five!, 9, { cancelled: true });
    await sold(ids.four!, 9, { paid: false });
    await sold(ids.old!, 9, { daysAgo: 40 });
    expect(await loadMostOrdered(prisma, menuId, new Date())).toEqual([ids.six]);
  });

  it('counts a guest once however often they add the dish', async () => {
    for (let i = 0; i < 6; i++) {
      await prisma.analyticsEvent.create({ data: { menuId, anonymousSessionId: 'same-guest', type: 'ADD_TO_CART', productId: ids.six!, occurredAt: new Date() } });
    }
    expect(await loadMostOrdered(prisma, menuId, new Date())).toEqual([]);
  });
});
