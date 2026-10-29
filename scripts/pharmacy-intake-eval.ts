import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { createPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import type { PhActor } from '@/server/pharmacy/actor';
import { extractFile } from '@/server/pharmacy/intake/extract';
import { admitFile, commitFile, createBatch, newFileId, prepareFile } from '@/server/pharmacy/intake/files';
import { fsIntakeStorage, intakeKey } from '@/server/pharmacy/intake/storage';
import { getBatch } from '@/server/pharmacy/intake/batches';
import { phScopedClient } from '@/server/studio/framework/access';
import { databaseTarget, describeDatabase } from './database-target';
import { DEV_DB, TEST_DB, databaseUrl } from './db-config';
import {
  compareInvoice,
  evalRefusal,
  guessedCount,
  parseTruth,
  percentile,
  renderTable,
  SAFETY_FLAG,
  tally,
  type Cell,
  type InvoiceRead,
  type Scalar,
} from './pharmacy-intake-eval-lib';

/**
 * Measures the invoice reading on REAL invoices: `npx tsx scripts/pharmacy-intake-eval.ts <folder> [--truth truth.csv]
 * [--budget-cents N] [--keep] --i-know-this-is-not-production`.
 *
 * The folder holds the invoice files (jpg, png, webp, pdf) and `truth.csv` (columns: file, supplierName, invoiceNumber,
 * invoiceDate, currency, total, lines; `lines` is a JSON array of {name, strength, form, pack, quantity, bonus, unitCost,
 * lineTotal, lot, expiry}; an empty cell or a missing key means "not on the paper"; money in minor units: whole dinars for IQD,
 * cents for USD). It runs the REAL pipeline (type, size and quality checks, storage, the configured AI provider, the budget) in
 * a throwaway business and prints, per field, how many cells were CORRECT / NULL_CORRECT / NULL_MISSED / WRONG / GUESSED, the
 * cost and the p95 time. Exit code 1 when any GUESSED cell exists, 2 when a file could not be read at all.
 *
 * It writes to a database and spends the AI key, so it refuses to run unless the flag is given, and refuses production, a
 * deployment and any database that is not on this machine and named *test or *eval (see `evalRefusal`). The database is
 * `DATABASE_URL` if set, else the local test database on `BUZZIFY_DB_PORT`. The provider and its key are the platform's
 * (the saved AI settings or ANTHROPIC_API_KEY / OPENAI_API_KEY), and `AI_PRICE_INPUT_USD_MICRO_PER_MTOK`,
 * `AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK` and `AI_PRICE_MODEL` (the model they are the price of) must be set. Files are kept in the temp folder adapter, never in the production bucket.
 * The throwaway business is deleted at the end unless `--keep`.
 */

const KINDS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);

function option(args: string[], name: string): string | null {
  const at = args.indexOf(name);
  return at === -1 ? null : (args[at + 1] ?? null);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const url = process.env.DATABASE_URL ?? databaseUrl(TEST_DB);
  const refusal = evalRefusal({ argv, env: process.env, target: databaseTarget(url) });
  if (refusal) {
    console.error(refusal);
    return 3;
  }
  const folder = argv.find((a) => !a.startsWith('--') && a !== option(argv, '--truth') && a !== option(argv, '--budget-cents'));
  if (!folder) {
    console.error(`Usage: npx tsx scripts/pharmacy-intake-eval.ts <folder> [--truth truth.csv] [--budget-cents N] [--keep] ${SAFETY_FLAG}`);
    return 3;
  }
  if (databaseTarget(url)?.database === DEV_DB) {
    console.error(`Refused: ${DEV_DB} is the development database. Use the test database.`);
    return 3;
  }
  const budgetCents = Number(option(argv, '--budget-cents') ?? 5000);
  if (!Number.isInteger(budgetCents) || budgetCents < 1) throw new Error('--budget-cents must be a whole number of USD cents');

  const root = resolve(folder);
  const truth = parseTruth(await readFile(resolve(option(argv, '--truth') ?? join(root, 'truth.csv')), 'utf8'));
  const present = new Set((await readdir(root)).filter((f) => KINDS.has(extname(f).toLowerCase())));
  const missing = truth.filter((t) => !present.has(t.file)).map((t) => t.file);
  if (missing.length > 0) throw new Error(`The truth file names files that are not in the folder: ${missing.join(', ')}`);
  const unlisted = [...present].filter((f) => !truth.some((t) => t.file === f));
  if (unlisted.length > 0) console.warn(`Skipping ${unlisted.length} file(s) without a truth row: ${unlisted.join(', ')}`);

  const prisma = createPrisma(url);
  const storage = fsIntakeStorage();
  const now = new Date();
  let restaurantId: string | null = null;
  try {
    console.log(`Database: ${describeDatabase({ ...process.env, DATABASE_URL: url })}`);

    // A throwaway business: one branch, a plan with the budget asked for, a live pharmacy subscription.
    const stamp = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    await prisma.application.upsert({ where: { id: 'pharmacy' }, create: { id: 'pharmacy', name: { en: 'Pharmacy' } }, update: {} });
    const planCode = `eval-${stamp}`;
    await prisma.appPlan.create({ data: { applicationId: 'pharmacy', code: planCode, name: { en: 'Evaluation' }, limits: { branches: 1, users: 1, storageMb: 1024, aiMonthlyBudgetMinor: budgetCents } } });
    const business = await prisma.restaurant.create({ data: { name: `Intake evaluation ${stamp}`, sector: 'PHARMACY', status: 'ACTIVE' }, select: { id: true } });
    restaurantId = business.id;
    const branch = await prisma.branch.create({ data: { restaurantId, name: 'Evaluation branch', sortOrder: 0 }, select: { id: true } });
    await prisma.subscription.create({
      data: {
        restaurantId,
        applicationId: 'pharmacy',
        planCode,
        status: 'ACTIVE',
        period: 'MONTHLY',
        currency: 'IQD',
        priceMinor: 0,
        currentPeriodStart: new Date(now.getTime() - 86_400_000),
        currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
        graceDays: 7,
        version: 1,
      },
    });
    const ph: PhActor = { userId: 'eval', name: 'Evaluation', restaurantId, restaurantName: 'Evaluation', role: 'OWNER', allBranches: true, branchIds: [branch.id], viaMembership: true, support: null, locale: 'en' };
    const scoped = phScopedClient(prisma, ph);
    const writer = scopedClient(prisma, { restaurantId, allBranches: true });

    const cells: Cell[] = [];
    const millis: number[] = [];
    const unread: string[] = [];
    for (const [index, t] of truth.entries()) {
      const bytes = await readFile(join(root, t.file));
      const batch = await writer.$transaction((tx) => createBatch(tx, { restaurantId: restaurantId!, branchId: branch.id, userId: 'eval', clientKey: `eval-${stamp}-${index + 1}` }));
      let fileId: string;
      try {
        const file = await prepareFile({ bytes });
        fileId = newFileId();
        const admission = await admitFile(writer, { restaurantId, branchId: branch.id, batchId: batch.id, file, now });
        if (admission.kind === 'duplicate') throw new Error('the same file appears twice in the folder');
        const storageKey = admission.kind === 'store' ? intakeKey(restaurantId, fileId) : null;
        if (storageKey) await storage.put(storageKey, file.bytes, file.mediaType);
        const added = await writer.$transaction((tx) => commitFile(tx, { restaurantId: restaurantId!, branchId: branch.id, userId: 'eval', batchId: batch.id, file, now, fileId, storageKey }));
        if (added.status === 'REJECTED_QUALITY') {
          unread.push(`${t.file} (rejected by the quality check: ${added.reasons.join(', ')})`);
          continue;
        }
      } catch (error) {
        unread.push(`${t.file} (${error instanceof Error ? error.message : 'not accepted'})`);
        continue;
      }
      const started = performance.now();
      const out = await extractFile(prisma, { ph, scoped, branchId: branch.id, fileId, audit: () => undefined }, { storage });
      millis.push(performance.now() - started);
      if (out.status !== 'EXTRACTED') {
        unread.push(`${t.file} (${out.failureCode ?? out.status})`);
        continue;
      }
      // What the model said, not what a person later edits: the stored extraction.
      const read = await getBatch(writer, batch.id, branch.id, true, now);
      const said: InvoiceRead = {
        header: Object.fromEntries(Object.entries(read.header.extracted).map(([k, v]) => [k, (typeof v === 'string' || typeof v === 'number' ? v : null) as Scalar])),
        lines: read.rows.filter((r) => !r.removed).map((r) => Object.fromEntries(Object.entries(r.extracted).map(([k, v]) => [k, (typeof v === 'string' || typeof v === 'number' ? v : null) as Scalar]))),
      };
      cells.push(...compareInvoice(t, said, now));
      console.log(`${t.file}: read ${out.rowCount} line(s)`);
    }

    const totals = tally(cells);
    console.log(`\n${renderTable(totals)}\n`);
    const calls = await writer.phAiCall.aggregate({ _sum: { costMicroUsd: true }, _count: true });
    const cost = Number(calls._sum.costMicroUsd ?? 0n) / 1_000_000;
    console.log(`Files: ${truth.length}; read: ${millis.length}; not read: ${unread.length}`);
    for (const line of unread) console.log(`  not read: ${line}`);
    console.log(`AI cost: USD ${cost.toFixed(4)} over ${calls._count} call(s); p95 time ${(percentile(millis, 0.95) / 1000).toFixed(1)} s`);
    const guessed = guessedCount(totals);
    console.log(guessed > 0 ? `FAIL: ${guessed} cell(s) were GUESSED (a value where the paper has none). The pass criterion is zero.` : 'No cell was GUESSED.');
    return guessed > 0 ? 1 : unread.length > 0 ? 2 : 0;
  } finally {
    if (restaurantId && !argv.includes('--keep')) {
      try {
        // The subscription is not removed with its business (the database restricts it), so it goes first, then the plan made for this run.
        await prisma.subscription.deleteMany({ where: { restaurantId } });
        await prisma.restaurant.delete({ where: { id: restaurantId } });
        await prisma.appPlan.deleteMany({ where: { applicationId: 'pharmacy', code: { startsWith: 'eval-' }, name: { equals: { en: 'Evaluation' } } } });
      } catch {
        console.error(`Could not delete the throwaway business ${restaurantId}; remove it by hand.`);
      }
    }
    await prisma.$disconnect();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 3;
  },
);
