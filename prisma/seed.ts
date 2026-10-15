import 'dotenv/config';
import { createPrisma } from '@/server/data/prisma';
import { ATELIER } from './seed/atelier';
import { seedRestaurant } from './seed/apply';
import { assertSeedValid } from './seed/validate';

async function main() {
  assertSeedValid(ATELIER);
  const prisma = createPrisma();
  try {
    const { restaurantId } = await seedRestaurant(prisma, ATELIER);
    console.log(`Seeded ${ATELIER.restaurant.slug} (${restaurantId}): ${ATELIER.products.length} products`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
