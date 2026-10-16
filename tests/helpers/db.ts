import type { PrismaClient } from '@/generated/prisma/client';
import { createPrisma } from '@/server/data/prisma';
import { seedMenu } from '../../prisma/seed/apply';
import { ATELIER } from '../../prisma/seed/atelier';
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

/**
 * Empties every table. Menu slugs go first and on their own so that tombstones (rows whose menu is already gone,
 * `menuId` null) are removed too; deleting a menu then cascades through its catalog, revisions and domains, and
 * deleting a restaurant through its branches. Later tasks add their own models to the front of this list.
 */
export async function resetTestData(prisma: PrismaClient): Promise<void> {
  await prisma.menuSlug.deleteMany();
  await prisma.menu.deleteMany();
  await prisma.restaurant.deleteMany();
}

export async function createMenuFixture(prisma: PrismaClient, slug: string) {
  const restaurant = await prisma.restaurant.create({ data: { name: `Restaurant ${slug}` } });
  const menu = await prisma.menu.create({
    data: {
      restaurantId: restaurant.id,
      name: `Menu ${slug}`,
      slug,
      currency: 'USD',
      defaultLocale: 'en',
      locales: ['en', 'ar', 'ckb'],
      timezone: 'Asia/Baghdad',
    },
  });
  await prisma.menuSlug.create({ data: { slug, menuId: menu.id } });
  const category = await prisma.category.create({
    data: { menuId: menu.id, slug: 'coffee', translations: { en: { name: 'Coffee' } } },
  });
  const product = await prisma.product.create({
    data: {
      menuId: menu.id,
      categoryId: category.id,
      slug: `${slug}-espresso`,
      basePrice: 300,
      translations: { en: { name: 'Espresso', description: 'Short and strong' } },
    },
  });
  return { restaurant, menu, category, product };
}

/** The ATELIER demo: its restaurant, its published menu with the full catalog, and the menu's reserved slug. */
export async function seedAtelier(prisma: PrismaClient) {
  const restaurant = await prisma.restaurant.create({
    data: { name: ATELIER.profile.name, type: ATELIER.profile.type, city: ATELIER.profile.city, country: ATELIER.profile.country },
  });
  const { menuId } = await seedMenu(prisma, ATELIER, restaurant.id);
  await prisma.menuSlug.upsert({
    where: { slug: ATELIER.restaurant.slug },
    create: { slug: ATELIER.restaurant.slug, menuId },
    update: { menuId },
  });
  return { restaurant, menuId };
}
