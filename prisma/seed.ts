import 'dotenv/config';
import { createPrisma } from '@/server/data/prisma';
import { publishMenu } from '@/server/publish/publish';
import { ATELIER } from './seed/atelier';
import { seedMenu } from './seed/apply';
import { assertSeedValid } from './seed/validate';

async function main() {
  assertSeedValid(ATELIER);
  const prisma = createPrisma();
  try {
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
    // The slug is reserved for good: the row outlives the menu, so a reseed points the same slug at the new menu.
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
