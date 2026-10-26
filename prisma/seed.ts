import 'dotenv/config';
import type { PrismaClient } from '@/generated/prisma/client';
import { createPrisma } from '@/server/data/prisma';
import { publishMenu } from '@/server/publish/publish';
import { ATELIER, type SeedData } from './seed/atelier';
import { HOT_BRICK } from './seed/hot-brick';
import { MAISON } from './seed/maison';
import { NOOR } from './seed/noor';
import { ONDA } from './seed/onda';
import { RIVERLIGHT } from './seed/riverlight';
import { seedApplications } from './seed/applications';
import { seedMenu } from './seed/apply';
import { demoRestaurant } from './seed/demo-restaurant';
import { assertLocalDatabase } from './seed/local-database';
import { seedDevUsers } from './seed/users';
import { assertSeedValid } from './seed/validate';

/**
 * Decided before anything is written, so a refusal leaves the database as it was. The development users share a password
 * that `.env.example` publishes, and that file turns it on once it is copied to `.env`, so it must never reach a
 * production database or a hosted one:
 * - in production with `DEV_SEED_PASSWORD` set the whole seed stops (a deploy that has it set is wrong, whichever way it
 *   got there); with it unset the demo menus are seeded and the users are skipped;
 * - anywhere else the users need `DATABASE_URL` to point at this machine (or `ALLOW_REMOTE_DEV_SEED=1`). The demo menu
 *   alone, with `DEV_SEED_PASSWORD` unset, is not restricted to a host.
 * Returns whether the development users are to be seeded.
 */
function checkDevUsers(): boolean {
  const production = process.env.NODE_ENV === 'production';
  const passwordSet = Boolean(process.env.DEV_SEED_PASSWORD);
  if (production && passwordSet) {
    throw new Error(
      'DEV_SEED_PASSWORD is set while NODE_ENV is "production". The development users are never created in production; ' +
        'unset DEV_SEED_PASSWORD there. Nothing was changed.',
    );
  }
  if (!production && passwordSet) {
    assertLocalDatabase('Seeding the development users (DEV_SEED_PASSWORD is set)', {
      instead: 'Nothing was changed. To seed the demo menu alone, unset DEV_SEED_PASSWORD.',
    });
  }
  return !production;
}

/**
 * A reseed replaces the demo menu that has the address now (for each demo menu). The address's row outlives the menu (a deleted menu's
 * addresses stay reserved for good, so an old QR code never opens another menu), so it is checked before anything is
 * written: once the demo menu was deleted, or moved to another address that `/atelier` now redirects to, the seed
 * refuses rather than give the address to a new menu.
 */
async function checkSlugIsOurs(prisma: PrismaClient, slug: string): Promise<void> {
  const entry = await prisma.menuSlug.findUnique({ where: { slug }, select: { menuId: true, menu: { select: { slug: true } } } });
  if (!entry) return;
  if (entry.menuId === null || entry.menu === null) {
    throw new Error(
      `The address ${slug} belonged to a menu that was deleted, and stays reserved for good so its old links and QR ` +
        'codes never open another menu. The demo menu is not seeded again. Nothing was changed.',
    );
  }
  if (entry.menu.slug !== slug) {
    throw new Error(
      `The address ${slug} now redirects to the menu at ${entry.menu.slug}, and stays reserved for it. The demo menu is ` +
        'not seeded again. Nothing was changed.',
    );
  }
}

/**
 * The demo menus, each under its own restaurant: ATELIER (with the development users), the two 2b added, then the three
 * drawn with template presets (a bakery, a gelateria and a restaurant, each named "(Demo)").
 */
const DEMOS: readonly SeedData[] = [ATELIER, RIVERLIGHT, HOT_BRICK, MAISON, ONDA, NOOR];

/**
 * `--only=maison-demo,onda-demo` seeds just those demo menus and leaves the others (and the development users) as they
 * are, so adding a demo to a shared database does not replace menus someone is working with. An unknown slug refuses.
 */
function selectedDemos(argv: readonly string[]): readonly SeedData[] {
  const flag = argv.find((arg) => arg.startsWith('--only='));
  if (!flag) return DEMOS;
  const slugs = flag.slice('--only='.length).split(',').map((slug) => slug.trim()).filter(Boolean);
  const unknown = slugs.filter((slug) => !DEMOS.some((demo) => demo.restaurant.slug === slug));
  if (unknown.length > 0 || slugs.length === 0) {
    throw new Error(
      `--only names no demo menu: ${unknown.join(', ') || '(empty)'}. The demo menus are ` +
        `${DEMOS.map((demo) => demo.restaurant.slug).join(', ')}. Nothing was changed.`,
    );
  }
  return DEMOS.filter((demo) => slugs.includes(demo.restaurant.slug));
}

/** Seeds one demo menu under its restaurant and publishes it as revision 1 (guests see only what is published). */
async function seedDemo(prisma: PrismaClient, data: SeedData): Promise<{ restaurantId: string }> {
  const restaurant = await demoRestaurant(prisma, data);
  const { menuId } = await seedMenu(prisma, data, restaurant.id);
  // The slug is reserved for good: the row outlives the menu, so a reseed points the same slug at the new menu (the
  // checks before anything was written made sure it was the address of the demo menu just replaced).
  const slug = data.restaurant.slug;
  await prisma.menuSlug.upsert({ where: { slug }, create: { slug, menuId }, update: { menuId } });

  const outcome = await prisma.$transaction((tx) => publishMenu(tx, { menuId, actorId: null, note: 'Seed', now: new Date() }));
  if (!outcome.ok) {
    const blocking = outcome.issues.filter((issue) => issue.severity === 'block');
    throw new Error(`The ${slug} seed cannot be published:\n${blocking.map((i) => JSON.stringify(i)).join('\n')}`);
  }
  console.log(
    `Seeded ${slug} (${menuId}) for ${restaurant.name}: ${data.products.length} products, ` +
      `published as revision ${outcome.number} with ${outcome.warnings.length} warnings`,
  );
  return { restaurantId: restaurant.id };
}

async function main() {
  const demos = selectedDemos(process.argv.slice(2));
  for (const demo of demos) assertSeedValid(demo);
  const withDevUsers = checkDevUsers();
  const prisma = createPrisma();
  try {
    await seedApplications(prisma);
    // Every address is checked before anything is written, so a refusal leaves every menu as it was.
    for (const demo of demos) await checkSlugIsOurs(prisma, demo.restaurant.slug);
    let atelier: { restaurantId: string } | undefined;
    for (const demo of demos) {
      const seeded = await seedDemo(prisma, demo);
      if (demo === ATELIER) atelier = seeded;
    }

    // Sign-in users for development, on ATELIER: skipped without DEV_SEED_PASSWORD, and never in production.
    if (atelier && withDevUsers) await seedDevUsers(prisma, atelier.restaurantId);
    else if (atelier) console.log('Development users skipped (production).');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
