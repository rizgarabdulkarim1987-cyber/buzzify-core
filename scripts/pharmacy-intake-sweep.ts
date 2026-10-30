import 'dotenv/config';
import { createPrisma } from '@/server/data/prisma';
import { sweepAiReservations } from '@/server/pharmacy/intake/ai';
import { describeDatabase } from './database-target';
import { DEV_DB, databaseUrl } from './db-config';

/**
 * Books the AI reservations that nobody will settle (a worker that died between reserving and settling) as SPEND, in every
 * business: `npx tsx scripts/pharmacy-intake-sweep.ts`. A request of a person sweeps only the business that asked; this is the
 * all-business run, so a business that no one uses does not keep a reservation held for ever. Nothing is ever given back as
 * unspent (the provider may have billed the call). It prints counts only, never a name, an id or an amount per business.
 * Scheduling it (daily, with the purge and the expiry) is a launch step. The database is `DATABASE_URL`; without it, outside
 * production, the development database on `BUZZIFY_DB_PORT` (or the default port).
 */

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? (process.env.NODE_ENV === 'production' ? undefined : databaseUrl(DEV_DB));
  const prisma = createPrisma(url);
  try {
    console.log(`Database: ${describeDatabase(url ? { ...process.env, DATABASE_URL: url } : process.env)}`);
    const result = await sweepAiReservations(prisma, new Date());
    console.log(`Booked ${result.swept} stale AI reservation(s) as spend; ${result.errors.length} could not be booked (retried next run).`);
    if (result.errors.length > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'The sweep failed');
  process.exitCode = 1;
});
