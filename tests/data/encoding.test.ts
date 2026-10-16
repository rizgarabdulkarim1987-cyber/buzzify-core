import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetTestData, testPrisma } from '../helpers/db';

const prisma = testPrisma();

describe('database encoding', () => {
  beforeAll(async () => {
    await resetTestData(prisma);
  });
  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('stores and returns Arabic and Sorani text unchanged', async () => {
    const name = 'قهوة ئێسپرێسۆ ☕ Café';
    const restaurant = await prisma.restaurant.create({ data: { name, city: 'هەولێر' } });
    const menu = await prisma.menu.create({
      data: { restaurantId: restaurant.id, slug: 'encoding-check', name, timezone: 'Asia/Baghdad', locales: ['en'] },
    });
    const foundRestaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id: restaurant.id } });
    const foundMenu = await prisma.menu.findUniqueOrThrow({ where: { id: menu.id } });
    expect(foundRestaurant.name).toBe(name);
    expect(foundRestaurant.city).toBe('هەولێر');
    expect(foundMenu.name).toBe(name);
  });
});
