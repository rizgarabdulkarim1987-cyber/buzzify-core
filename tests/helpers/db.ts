import type { PrismaClient } from '@/generated/prisma/client';
import { createPrisma } from '@/server/data/prisma';
import { publishMenu } from '@/server/publish/publish';
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
 * Empties every table. The audit log goes first (it references nothing, so nothing removes it by cascade), then the
 * invitations. Accounts follow: memberships, then users (their sessions, accounts and two-factor rows follow by
 * cascade, but are named so a schema change cannot leave one behind), then the verification and rate-limit rows that
 * belong to no user. Menu slugs
 * go next and on their own so that tombstones (rows whose menu is already gone, `menuId` null) are removed too;
 * deleting a menu then cascades through its catalog, revisions and domains, and deleting a restaurant through its
 * branches. Later tasks add their own models to the front of this list.
 */
export async function resetTestData(prisma: PrismaClient): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.platformSetting.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.twoFactor.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.rateLimit.deleteMany();
  await prisma.authRateLimit.deleteMany();
  await prisma.menuSlug.deleteMany();
  await prisma.menu.deleteMany();
  await prisma.restaurant.deleteMany();
}

/** Publishes a menu the way the seed does, and fails the test setup if anything blocks it. */
export async function publishFixture(prisma: PrismaClient, menuId: string, note = 'Fixture') {
  const outcome = await prisma.$transaction((tx) => publishMenu(tx, { menuId, actorId: null, note, now: new Date() }));
  if (!outcome.ok) throw new Error(`Fixture menu ${menuId} cannot be published: ${JSON.stringify(outcome.issues)}`);
  return outcome;
}

/**
 * A restaurant with one menu (one category, one product priced 300) and its slug. The menu is published unless
 * `publish` is false, so `menu` is the row as it stands afterwards: PUBLISHED, with its live revision.
 */
export async function createMenuFixture(prisma: PrismaClient, slug: string, { publish = true }: { publish?: boolean } = {}) {
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
  if (publish) await publishFixture(prisma, menu.id);
  return { restaurant, menu: await prisma.menu.findUniqueOrThrow({ where: { id: menu.id } }), category, product };
}

/**
 * The ATELIER demo as `npm run db:seed` leaves it: its restaurant, its menu with the full catalog published as
 * revision 1, and the menu's reserved slug.
 */
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
  await publishFixture(prisma, menuId, 'Seed');
  return { restaurant, menuId };
}
