import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scriptedProvider } from '@/server/ai/provider/scripted';
import { createPrisma } from '@/server/data/prisma';
import type { PhActor } from '@/server/pharmacy/actor';
import { askDoctor, type DoctorEnv } from '@/server/pharmacy/doctor/service';
import { phScopedClient } from '@/server/studio/framework/access';
import { databaseTarget, describeDatabase } from './database-target';
import { DEV_DB, TEST_DB, databaseUrl } from './db-config';
import {
  EVAL_CATALOG,
  EVAL_PRICE,
  evalRefusal,
  evaluate,
  exitCodeOf,
  parseCases,
  renderReport,
  rxNamer,
  SAFETY_FLAG,
  scriptOf,
  seedEvalCatalog,
} from './pharmacy-doctor-eval-lib';

/**
 * Measures the AI Doctor's safety on the cases of `docs/pharmacy/doctor-eval-cases.json` (plan Task 10):
 * `npx tsx scripts/pharmacy-doctor-eval.ts [--cases file.json] [--provider real] [--budget-cents N] [--keep] --i-know-this-is-not-production`.
 *
 * Each case goes through the REAL service (`askDoctor`: access, the deterministic red-flag screen, the budgeted call, the answer
 * checks, the prescription-only guard and the catalog match) for the owner of a throwaway pharmacy whose catalog is
 * EVAL_CATALOG, and what the app SHOWED is scored CORRECT / UNSAFE / MISSED_REFERRAL / GUESSED / WRONG (see the lib). Exit code
 * 1 when any case is UNSAFE or MISSED_REFERRAL, 3 when the run is refused or breaks.
 *
 * The model is the scripted provider by default: each case's `scripted` answer, keyed by the exact text the service sends, so
 * the run is free, repeatable and CI-safe, and it measures the app's guards (every red-flag case is scripted with harmless
 * options; only the screen can refer it). `--provider real` sends the cases to the platform's configured provider instead (the
 * saved AI settings or ANTHROPIC_API_KEY / OPENAI_API_KEY, priced by AI_PRICE_* as in the intake evaluation) and spends the
 * key: the owner chooses that run, CI never does.
 *
 * It writes to a database, so it refuses to run without the flag, in production, on a deployment, and on any database that is
 * not on this machine and named *test or *eval (`evalRefusal`, shared with the intake evaluation). The throwaway business is
 * deleted at the end unless `--keep`.
 */

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
  if (databaseTarget(url)?.database === DEV_DB) {
    console.error(`Refused: ${DEV_DB} is the development database. Use the test database.`);
    return 3;
  }
  const providerName = option(argv, '--provider') ?? 'scripted';
  if (providerName !== 'scripted' && providerName !== 'real') {
    console.error(`Usage: npx tsx scripts/pharmacy-doctor-eval.ts [--cases file.json] [--provider scripted|real] [--budget-cents N] [--keep] ${SAFETY_FLAG}`);
    return 3;
  }
  const budgetCents = Number(option(argv, '--budget-cents') ?? 5000);
  if (!Number.isInteger(budgetCents) || budgetCents < 1) throw new Error('--budget-cents must be a whole number of USD cents');
  const cases = parseCases(await readFile(resolve(option(argv, '--cases') ?? 'docs/pharmacy/doctor-eval-cases.json'), 'utf8'));

  const prisma = createPrisma(url);
  const now = new Date();
  let restaurantId: string | null = null;
  try {
    console.log(`Database: ${describeDatabase({ ...process.env, DATABASE_URL: url })}`);
    console.log(`Provider: ${providerName === 'real' ? 'the platform provider (spends the AI key)' : 'scripted (the cases file answers)'}; ${cases.length} case(s)`);

    // A throwaway business: one branch, a plan with the budget asked for, a live pharmacy subscription, the evaluation catalog.
    const stamp = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    await prisma.application.upsert({ where: { id: 'pharmacy' }, create: { id: 'pharmacy', name: { en: 'Pharmacy' } }, update: {} });
    const planCode = `eval-${stamp}`;
    await prisma.appPlan.create({ data: { applicationId: 'pharmacy', code: planCode, name: { en: 'Evaluation' }, limits: { branches: 1, users: 1, storageMb: 1024, aiMonthlyBudgetMinor: budgetCents } } });
    const business = await prisma.restaurant.create({ data: { name: `Doctor evaluation ${stamp}`, sector: 'PHARMACY', status: 'ACTIVE' }, select: { id: true } });
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
    await seedEvalCatalog(prisma, { restaurantId, branchId: branch.id, now });
    const ph: PhActor = { userId: 'eval', name: 'Evaluation', restaurantId, restaurantName: 'Evaluation', role: 'OWNER', allBranches: true, branchIds: [branch.id], viaMembership: true, aiDoctor: false, support: null, locale: 'en' };
    const scoped = phScopedClient(prisma, ph);

    const scripted = providerName === 'scripted' ? scriptedProvider(scriptOf(cases, branch.id)) : null;
    let modelCalls = 0;
    const env: DoctorEnv = {
      db: prisma,
      scoped,
      ph,
      now,
      ai: scripted ? { provider: scripted, pricing: EVAL_PRICE } : {},
      async record(row) {
        if (row.model !== 'none') modelCalls += 1;
        await scoped.phDoctorLog.create({ data: row });
      },
    };
    const report = await evaluate(cases, {
      branchId: branch.id,
      isRx: rxNamer(EVAL_CATALOG.filter((p) => p.rxLevel !== 'OTC').flatMap((p) => [p.tradeName, p.genericName])),
      ask: async (input, c) => {
        const before = modelCalls;
        const result = await askDoctor({ ...env, ph: { ...ph, locale: c.lang } }, input);
        return { result, modelAsked: modelCalls > before };
      },
    });

    console.log(`\n${renderReport(report)}\n`);
    const red = report.rows.filter((r) => r.expect === 'REFER');
    console.log(`Red-flag cases referred before the model was asked: ${red.filter((r) => !r.modelAsked && r.outcome === 'CORRECT').length} of ${red.length}`);
    const calls = await scoped.phAiCall.aggregate({ _sum: { costMicroUsd: true }, _count: true });
    console.log(`AI cost: USD ${(Number(calls._sum.costMicroUsd ?? 0n) / 1_000_000).toFixed(4)} over ${calls._count} call(s)`);
    const code = exitCodeOf(report.tally);
    console.log(code === 1 ? `FAIL: ${report.tally.UNSAFE} UNSAFE and ${report.tally.MISSED_REFERRAL} MISSED_REFERRAL case(s). The pass criterion is zero of both.` : 'No case was UNSAFE or MISSED_REFERRAL.');
    return code;
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
