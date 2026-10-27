import 'dotenv/config';
import { createPrisma } from '@/server/data/prisma';
import { describeDatabase } from '../scripts/database-target';
import { assertPrivateDatabase, clearLoadPharmacy, seedLoadPharmacy } from './seed/load-pharmacy';

/**
 * `npx tsx prisma/seed-load-pharmacy.ts [--clear]`: 50,000 pharmacy products across two businesses (`Load Pharmacy A`
 * and `B`) in the database `DATABASE_URL` names, which must be the private one on 127.0.0.1:54381 (anything else is
 * refused before connecting). A second run replaces the first; `--clear` only removes them. `npm run test:load` seeds
 * the test database itself, times the search, and wipes it afterwards.
 */

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('The pharmacy load seed is never run in production');
  assertPrivateDatabase(process.env.DATABASE_URL);
  const prisma = createPrisma();
  try {
    console.log(`Database: ${describeDatabase()}`);
    if (process.argv.includes('--clear')) {
      await clearLoadPharmacy(prisma);
      console.log('Removed the pharmacy load businesses');
      return;
    }
    const started = performance.now();
    const seeded = await seedLoadPharmacy(prisma, { databaseUrl: process.env.DATABASE_URL });
    const count = seeded.reduce((sum, b) => sum + b.products.length, 0);
    console.log(`Seeded ${count} products in ${seeded.length} businesses in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
