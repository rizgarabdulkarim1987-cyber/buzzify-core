import 'dotenv/config';
import type { PrismaClient } from '@/generated/prisma/client';
import { createPrisma } from '@/server/data/prisma';
import { publishMenu } from '@/server/publish/publish';
import { ATELIER } from './seed/atelier';
import { seedMenu } from './seed/apply';
import { assertLocalDatabase } from './seed/local-database';
import { seedDevUsers } from './seed/users';
import { assertSeedValid } from './seed/validate';

/**
 * Decided before anything is written, so a refusal leaves the database as it was. The development users share a password
 * that `.env.example` publishes, and that file turns it on once it is copied to `.env`, so it must never reach a
 * production database or a hosted one:
 * - in production with `DEV_SEED_PASSWORD` set the whole seed stops (a deploy that has it set is wrong, whichever way it
 *   got there); with it unset the demo menu is seeded and the users are skipped;
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
 * A reseed replaces the demo menu that has the address now. The address's row outlives the menu (a deleted menu's
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

async function main() {
  assertSeedValid(ATELIER);
  const withDevUsers = checkDevUsers();
  const prisma = createPrisma();
  try {
    await checkSlugIsOurs(prisma, ATELIER.restaurant.slug);
    const { profile } = ATELIER;
    // Reseeding replaces the menu but keeps the restaurant (and so its client number), found by name.
    const restaurant =
      (await prisma.restaurant.findFirst({ where: { name: profile.name }, orderBy: { createdAt: 'asc' } })) ??
      (await prisma.restaurant.create({
        data: {
          name: profile.name,
          type: profile.type,
          description: profile.description,
          city: profile.city,
          country: profile.country,
          phone: profile.phone,
          whatsapp: profile.whatsapp,
          socialLinks: profile.instagram ? { instagram: profile.instagram } : {},
        },
      }));

    const { menuId } = await seedMenu(prisma, ATELIER, restaurant.id);
    // The slug is reserved for good: the row outlives the menu, so a reseed points the same slug at the new menu (the
    // check above made sure it was the address of the demo menu just replaced, not a deleted or moved menu's).
    const slug = ATELIER.restaurant.slug;
    await prisma.menuSlug.upsert({ where: { slug }, create: { slug, menuId }, update: { menuId } });

    // Guests see only what is published, so the demo menu goes live as revision 1.
    const outcome = await prisma.$transaction((tx) =>
      publishMenu(tx, { menuId, actorId: null, note: 'Seed', now: new Date() }),
    );
    if (!outcome.ok) {
      const blocking = outcome.issues.filter((issue) => issue.severity === 'block');
      throw new Error(`The ${slug} seed cannot be published:\n${blocking.map((i) => JSON.stringify(i)).join('\n')}`);
    }

    // Sign-in users for development: skipped without DEV_SEED_PASSWORD, and never in production.
    if (withDevUsers) await seedDevUsers(prisma, restaurant.id);
    else console.log('Development users skipped (production).');

    console.log(
      `Seeded ${slug} (${menuId}) for ${restaurant.name}: ${ATELIER.products.length} products, ` +
        `published as revision ${outcome.number} with ${outcome.warnings.length} warnings`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
