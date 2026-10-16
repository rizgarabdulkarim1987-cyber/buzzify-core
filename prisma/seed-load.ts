import 'dotenv/config';
import { createPrisma } from '@/server/data/prisma';
import { describeDatabase } from '../scripts/database-target';
import { assertLocalDatabase } from './seed/local-database';
import { seedLoad } from './seed/load';

/**
 * `npm run db:seed:load [count]`: 1,000 restaurants with a published menu each, and 20,000 audit rows over them, for
 * trying the Studio's lists at size. It writes to whatever `DATABASE_URL` points at (the development database unless it
 * is set), replacing what an earlier run made. It refuses a production environment and a database on another host
 * (`ALLOW_REMOTE_DEV_SEED=1` overrides the second), before it connects. `npm run test:load` seeds the test
 * database itself and times the lists.
 */

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('The load seed is never run in production (NODE_ENV is "production")');
  assertLocalDatabase('The load seed');
  const arg = process.argv[2];
  const count = arg === undefined ? 1000 : Number(arg);
  if (!Number.isInteger(count) || count < 1 || count > 9999) throw new Error('Give the number of restaurants as a whole number from 1 to 9999');

  const prisma = createPrisma();
  try {
    console.log(`Database: ${describeDatabase()}`);
    const started = performance.now();
    const seeded = await seedLoad(prisma, count);
    console.log(
      `Seeded ${seeded.restaurants} restaurants, ${seeded.menus} published menus and ${seeded.auditRows} audit rows ` +
        `in ${((performance.now() - started) / 1000).toFixed(1)} s`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
