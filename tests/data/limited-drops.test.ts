import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getCatalog, getTenant } from '@/server/data/public-menu';
import { applyDrops, dropState } from '@/server/domain/drops';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

const HOUR = 3_600_000;
const NOW = new Date('2026-11-01T12:00:00.000Z');
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString();

describe('the window of a drop', () => {
  it('is soon before it begins, live inside it and over from its end', () => {
    expect(dropState(at(1), at(3), NOW)).toBe('soon');
    expect(dropState(at(-1), at(3), NOW)).toBe('live');
    expect(dropState(at(-3), at(0), NOW)).toBe('over');
    expect(dropState(at(0), at(1), NOW)).toBe('live');
  });

  it('hides a dish outside its window, keeps the end of one inside it, and is ignored by a plan without drops', () => {
    const base = { isAvailable: true, isHidden: false, stockCount: null };
    const overlay = {
      products: {
        soon: { ...base, dropStartsAt: at(1), dropEndsAt: at(2) },
        live: { ...base, dropStartsAt: at(-1), dropEndsAt: at(2) },
        over: { ...base, dropStartsAt: at(-3), dropEndsAt: at(-1) },
        plain: { ...base, stockCount: 4 },
      },
      options: {},
    };
    const on = applyDrops(overlay, NOW, true).products;
    expect([on.soon?.isHidden, on.live?.isHidden, on.over?.isHidden, on.plain?.isHidden]).toEqual([true, false, true, false]);
    expect(on.live?.dropEndsAt).toBe(at(2));
    expect(on.plain?.stockCount).toBe(4);
    const off = applyDrops(overlay, NOW, false).products;
    expect(Object.values(off).every((entry) => !entry.isHidden && entry.dropEndsAt === undefined)).toBe(true);
  });
});

describe('a limited drop on the menu guests are served', () => {
  let a: Awaited<ReturnType<typeof createMenuFixture>>;
  const window = (startHours: number, endHours: number) => ({ dropStartsAt: new Date(Date.now() + startHours * HOUR), dropEndsAt: new Date(Date.now() + endHours * HOUR) });
  const served = async () => (await getCatalog((await getTenant('limited-drops'))!)).products.find((product) => product.id === a.product.id);

  beforeEach(async () => {
    await resetTestData(prisma);
    a = await createMenuFixture(prisma, 'limited-drops');
  });

  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('is served only inside its window, with its end', async () => {
    await prisma.product.update({ where: { id: a.product.id }, data: window(1, 2) });
    expect(await served()).toBeUndefined();
    await prisma.product.update({ where: { id: a.product.id }, data: window(-1, 1) });
    const live = await served();
    expect(live?.dropEndsAt).toBeDefined();
    await prisma.product.update({ where: { id: a.product.id }, data: window(-3, -1) });
    expect(await served()).toBeUndefined();
  });

  it('is served as an ordinary dish on a plan without limited drops', async () => {
    await prisma.product.update({ where: { id: a.product.id }, data: window(-3, -1) });
    await prisma.restaurant.update({ where: { id: a.restaurant.id }, data: { plan: 'BASIC' } });
    const dish = await served();
    expect(dish).toBeDefined();
    expect(dish?.dropEndsAt).toBeUndefined();
  });

  it('refuses a window with one end, or one that ends before it begins', async () => {
    const [from, to] = [new Date(Date.now() + HOUR), new Date(Date.now() + 2 * HOUR)];
    await expect(prisma.product.update({ where: { id: a.product.id }, data: { dropStartsAt: from } })).rejects.toThrow();
    await expect(prisma.product.update({ where: { id: a.product.id }, data: { dropStartsAt: to, dropEndsAt: from } })).rejects.toThrow();
  });
});
