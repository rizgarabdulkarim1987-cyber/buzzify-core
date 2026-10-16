import { randomUUID } from 'node:crypto';
import type { Locale } from '@/lib/locale';
import { createPrisma } from '@/server/data/prisma';
import { DEV_DB, databaseUrl } from '../../../scripts/db-config';
import { createMenuFixture, publishFixture } from '../../helpers/db';

/** The ids of the products of the menu that has the seeded `atelier` address now. */
export async function atelierProductIds(): Promise<string[]> {
  const prisma = createPrisma(databaseUrl(DEV_DB));
  try {
    const menu = await prisma.menu.findUnique({ where: { slug: 'atelier' }, select: { products: { select: { id: true } } } });
    if (!menu) throw new Error('There is no ATELIER menu. Run `npm run db:seed`.');
    return menu.products.map((product) => product.id);
  } finally {
    await prisma.$disconnect();
  }
}

export interface TemporaryMenu {
  /** The slug the menu was created with. */
  slug: string;
  /** The menu's name as guests see it (its restaurant's). */
  name: string;
  /** The restaurant that owns it. */
  restaurantId: string;
  /** The slug of its one product. */
  productSlug: string;
  /** Gives the menu a new slug the way a rename does: the old one stays as a `MenuSlug` row that now redirects. */
  rename(): Promise<string>;
  /** Suspends the menu. */
  suspend(): Promise<void>;
  /**
   * Deletes the menu, its slugs and its restaurant from the development database. Safe to call again, and after the menu
   * is gone: Playwright runs a describe's `afterAll` once per batch of its tests a worker runs, so a cleanup can come round
   * twice.
   */
  remove(): Promise<void>;
}

/**
 * A throwaway published menu in the development database, which the app under test reads. Tests change its slug and
 * status instead of ATELIER's, so tests running in parallel never see the seeded menu change. Slugs are unique per
 * call and never requested before the change, which matters: the app caches a slug's resolution for up to five
 * minutes, and nothing here can expire that cache, so a slug that had been visited would keep its old answer.
 * `locales` limits the languages the menu offers (all three by default).
 */
export async function createTemporaryMenu({ locales }: { locales?: Locale[] } = {}): Promise<TemporaryMenu> {
  const prisma = createPrisma(databaseUrl(DEV_DB));
  const slug = `e2e-${randomUUID().slice(0, 8)}`;
  const { restaurant, menu, product } = await createMenuFixture(prisma, slug, { publish: !locales });
  if (locales) {
    await prisma.menu.update({ where: { id: menu.id }, data: { locales, defaultLocale: locales[0] } });
    await publishFixture(prisma, menu.id);
  }

  return {
    slug,
    name: restaurant.name,
    restaurantId: restaurant.id,
    productSlug: product.slug,
    async rename() {
      const renamed = `${slug}-renamed`;
      await prisma.$transaction([
        prisma.menu.update({ where: { id: menu.id }, data: { slug: renamed } }),
        prisma.menuSlug.create({ data: { slug: renamed, menuId: menu.id } }),
      ]);
      return renamed;
    },
    async suspend() {
      await prisma.menu.update({ where: { id: menu.id }, data: { status: 'SUSPENDED' } });
    },
    async remove() {
      await prisma.$disconnect();
      // A client of its own, so a second call does not depend on the first one's having been left open.
      const db = createPrisma(databaseUrl(DEV_DB));
      try {
        // Slugs first: deleting the menu would otherwise leave them behind as tombstones. Every step matches by this
        // menu's own ids and finds nothing the second time.
        await db.menuSlug.deleteMany({ where: { OR: [{ menuId: menu.id }, { slug: { in: [slug, `${slug}-renamed`] } }] } });
        await db.menu.deleteMany({ where: { id: menu.id } });
        await db.auditLog.deleteMany({
          where: { OR: [{ menuId: menu.id }, { restaurantId: restaurant.id }, { entityId: { in: [menu.id, restaurant.id] } }] },
        });
        await db.restaurant.deleteMany({ where: { id: restaurant.id } });
      } finally {
        await db.$disconnect();
      }
    },
  };
}
