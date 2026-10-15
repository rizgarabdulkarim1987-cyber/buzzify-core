import type { PrismaClient } from '@/generated/prisma/client';
import { createPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';

export function requireTestDb(): void {
  if (process.env.TEST_DB_UNAVAILABLE) {
    throw new Error(`Test database unavailable: ${process.env.TEST_DB_UNAVAILABLE}. Run \`npm run db:up\`.`);
  }
}

export function testPrisma(): PrismaClient {
  requireTestDb();
  return createPrisma(databaseUrl(TEST_DB));
}

export async function resetTestData(prisma: PrismaClient): Promise<void> {
  await prisma.restaurant.deleteMany();
}

export async function createRestaurantFixture(prisma: PrismaClient, slug: string) {
  const restaurant = await prisma.restaurant.create({
    data: {
      slug,
      name: `Restaurant ${slug}`,
      currency: 'USD',
      defaultLocale: 'en',
      locales: ['en', 'ar', 'ckb'],
      timezone: 'Asia/Baghdad',
    },
  });
  const category = await prisma.category.create({
    data: { restaurantId: restaurant.id, slug: 'coffee', translations: { en: { name: 'Coffee' } } },
  });
  const product = await prisma.product.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: category.id,
      slug: `${slug}-espresso`,
      basePrice: 300,
      translations: { en: { name: 'Espresso', description: 'Short and strong' } },
    },
  });
  return { restaurant, category, product };
}
