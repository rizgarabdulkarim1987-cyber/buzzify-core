import 'dotenv/config';
import { createPrisma } from '@/server/data/prisma';
import { expireOpenBatches, EXPIRE_DAYS } from '@/server/pharmacy/intake/approve';
import { choosePurgeStorage } from '@/server/pharmacy/intake/purge-guard';
import { fsIntakeStorage, resolveIntakeStorage } from '@/server/pharmacy/intake/storage';
import { intakeStorageEnv } from '@/server/env';
import { describeDatabase } from './database-target';
import { DEV_DB, databaseUrl } from './db-config';

/**
 * Cancels the invoice-intake batches that were left open for 30 days: `npx tsx scripts/pharmacy-intake-expire.ts [--days N]
 * [--fs]`. Each batch is cancelled the way a person's cancel does it: its files are deleted from the private bucket FIRST,
 * then marked PURGED and their hash slot freed; the lines read stay as history. A batch whose files cannot be deleted stays open
 * for the next run. The temp folder is used only with `--fs`, against a local test database (the same guard as the purge
 * script). It prints counts only, never a name, a key or a business. Scheduling it (daily) is a launch step. The database is
 * `DATABASE_URL`; without it, outside production, the development database on `BUZZIFY_DB_PORT` (or the default port).
 */

function daysFrom(args: string[]): number {
  const at = args.indexOf('--days');
  if (at === -1) return EXPIRE_DAYS;
  const value = Number(args[at + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 3650) throw new Error('--days must be a whole number from 1 to 3650');
  return value;
}

async function main(): Promise<void> {
  const olderThanDays = daysFrom(process.argv.slice(2));
  const url = process.env.DATABASE_URL ?? (process.env.NODE_ENV === 'production' ? undefined : databaseUrl(DEV_DB));
  const prisma = createPrisma(url);
  try {
    console.log(`Database: ${describeDatabase(url ? { ...process.env, DATABASE_URL: url } : process.env)}`);
    const env = intakeStorageEnv();
    const kind = choosePurgeStorage({ r2Configured: env !== null, fsFlag: process.argv.includes('--fs'), env: process.env });
    const storage = kind === 'r2' ? resolveIntakeStorage(env, 'production') : fsIntakeStorage();
    const result = await expireOpenBatches(prisma, { now: new Date(), olderThanDays, storage });
    console.log(`Cancelled ${result.cancelled} batch(es) open for ${olderThanDays} days or more; ${result.failed} could not be cancelled (retried next run).`);
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'The expiry failed');
  process.exitCode = 1;
});
