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
    const created = await prisma.restaurant.create({
      data: { slug: 'encoding-check', name, timezone: 'Asia/Baghdad', locales: ['en'] },
    });
    const found = await prisma.restaurant.findUniqueOrThrow({ where: { id: created.id } });
    expect(found.name).toBe(name);
  });
});
