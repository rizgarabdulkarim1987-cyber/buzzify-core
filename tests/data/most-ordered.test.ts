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

  it('gives the top three by guest sessions in 14 days, each with at least five', async () => {
    await adds(menuId, ids.six!, 6);
    await adds(menuId, ids.five!, 4);
    await adds(menuId, ids.five!, 1, 2, 'PAIRING_ADD');
    await adds(menuId, ids.four!, 4);
    await adds(menuId, ids.old!, 7, 15);
    await adds(menuId, ids.eight!, 8);
    await adds(otherMenuId, ids.other!, 20);
    expect(await loadMostOrdered(prisma, menuId, new Date())).toEqual([ids.eight, ids.six, ids.five]);
  });

  it('counts a guest once however often they add the dish', async () => {
    for (let i = 0; i < 6; i++) {
      await prisma.analyticsEvent.create({ data: { menuId, anonymousSessionId: 'same-guest', type: 'ADD_TO_CART', productId: ids.six!, occurredAt: new Date() } });
    }
    expect(await loadMostOrdered(prisma, menuId, new Date())).toEqual([]);
  });
});
