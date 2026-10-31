import 'dotenv/config';
import { createPrisma } from '@/server/data/prisma';
import { purgeExpiredIntakeFiles } from '@/server/pharmacy/intake/files';
import { choosePurgeStorage } from '@/server/pharmacy/intake/purge-guard';
import { fsIntakeStorage, resolveIntakeStorage } from '@/server/pharmacy/intake/storage';
import { intakeStorageEnv } from '@/server/env';
import { describeDatabase } from './database-target';
import { DEV_DB, databaseUrl } from './db-config';

/**
 * Deletes the uploaded supplier invoices that are past their 30-day retention: `npx tsx scripts/pharmacy-intake-purge.ts
 * [--limit N] [--fs]` (default 200 files per run). It deletes each object from the private bucket FIRST, then blanks the file's
 * storage key and marks it PURGED (the rows read from it stay); a refused delete leaves the file for the next run. The temp
 * folder is used only with `--fs`, against a local test database (`BUZZIFY_DB_PORT`, no `DATABASE_URL`): it can never be
 * pointed at a real database, where it would orphan the real objects. It prints counts only, never a name, a key or a business. Scheduling it
 * (daily) is a launch step. The database is `DATABASE_URL`; without it, outside production, the development database on
 * `BUZZIFY_DB_PORT` (or the default port).
 */

const DEFAULT_LIMIT = 200;

function limitFrom(args: string[]): number {
  const at = args.indexOf('--limit');
  if (at === -1) return DEFAULT_LIMIT;
  const value = Number(args[at + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 10_000) throw new Error('--limit must be a whole number from 1 to 10000');
  return value;
}

async function main(): Promise<void> {
  const limit = limitFrom(process.argv.slice(2));
  const url = process.env.DATABASE_URL ?? (process.env.NODE_ENV === 'production' ? undefined : databaseUrl(DEV_DB));
  const prisma = createPrisma(url);
  try {
    console.log(`Database: ${describeDatabase(url ? { ...process.env, DATABASE_URL: url } : process.env)}`);
    const env = intakeStorageEnv();
    const kind = choosePurgeStorage({ r2Configured: env !== null, fsFlag: process.argv.includes('--fs'), env: process.env });
    const storage = kind === 'r2' ? resolveIntakeStorage(env, 'production') : fsIntakeStorage();
    const result = await purgeExpiredIntakeFiles(prisma, { now: new Date(), limit, storage });
    console.log(`Purged ${result.purged} file(s); deleted ${result.objectsDeleted} stored object(s); ${result.failed} could not be deleted (retried next run).`);
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'The purge failed');
  process.exitCode = 1;
});
