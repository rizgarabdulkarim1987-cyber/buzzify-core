import 'dotenv/config';
import { createPrisma } from '@/server/data/prisma';
import { seedLoad } from './seed/load';

/**
 * `npm run db:seed:load [count]`: 1,000 restaurants with a published menu each, and 20,000 audit rows over them, for
 * trying the Studio's lists at size. It writes to whatever `DATABASE_URL` points at (the development database unless it
 * is set), replacing what an earlier run made, and never to a production one. `npm run test:load` seeds the test
 * database itself and times the lists.
 */

/** Where `DATABASE_URL` points, without its credentials, so the person can see which database this will change. */
function describeDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url || !URL.canParse(url)) return 'the development database (DATABASE_URL is not set)';
  const { hostname, port, pathname } = new URL(url);
  return `${hostname}${port ? `:${port}` : ''}${pathname}`;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('The load seed is never run in production (NODE_ENV is "production")');
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
