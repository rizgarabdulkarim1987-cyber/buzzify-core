import { AiTimeoutError } from '@/server/ai/errors';
import { AI_TIMEOUTS_MS } from '@/server/ai/provider/models';
import type { AiProvider, AiRequest, AiResponse } from '@/server/ai/provider/types';
import { resolveAiProvider } from '@/server/ai/settings';
import { delegates, scopedClient, type ScopedClient, type ScopedTx } from '@/server/data/tenant-db';
import { aiPricingEnv } from '@/server/env';
import { baghdadMonth, BudgetError, budgetMicroUsdFromCents, estimateCostMicroUsd, settle } from '@/server/domain/pharmacy/intake';
import { limitsOf } from '@/server/domain/pharmacy/limits';
import type { PhActor } from '../actor';
import { mayViewCost } from '../products';

/**
 * The pharmacy AI runner (R5-2, R5-3, R5-12, R5-13): the same provider and the same timeout as the cashier's `runAi`, but on
 * the pharmacy's own tables (`PhAiUsageMonth`, `PhAiReservation`, `PhAiCall`) and counted in money, not in requests.
 *
 * A call first RESERVES its worst case against the month's budget in one conditional UPDATE (`spent + reserved + worst <=
 * budget`), so concurrent calls can never pass the budget; it then calls the provider; then SETTLES in one transaction: the
 * reservation is deleted, `reserved` falls by the worst case and `spent` rises by the actual cost (at most the reservation: an
 * answer already paid for is never thrown away, the overrun is returned so the caller can audit it). A failure after the
 * reservation releases it, costing what the provider reported, if anything. The call log holds no prompt and no answer.
 *
 * Lock order (extends phase 5's, see files.ts): the month's usage row FOR UPDATE first in every transaction here, then that
 * file's reservation row. The provider is never called inside a transaction. Only this folder writes the AI tables.
 */

/** A lease older than this is stale: its worker is presumed dead (the extraction timeout is 150 s). */
export const LEASE_MS = 10 * 60_000;

type Everyone = Parameters<typeof scopedClient>[0];

/** Micro-dollars per million tokens. There is no default: production reads it from the environment or refuses. */
export interface AiPricing {
  inputPerMtok: bigint;
  outputPerMtok: bigint;
}

export type AiFailureCode = 'AI_PRICING_NOT_SET' | 'AI_NOT_IN_PLAN' | 'AI_BUDGET_REACHED' | 'EXTRACTION_IN_PROGRESS' | 'AI_TIMEOUT' | 'AI_PROVIDER_ERROR' | 'AI_REFUSED';

export interface RunArgs {
  restaurantId: string;
  fileId: string;
  purpose: 'extract';
  input: Omit<AiRequest, 'signal' | 'maxTokens' | 'purpose'>;
  maxOutputTokens: number;
  now: Date;
}

export interface RunOptions {
  /** Tests: the model to call; otherwise the platform's configured one. */
  provider?: AiProvider;
  /** Tests: a price; otherwise the environment's, and none means refusal. */
  pricing?: AiPricing | null;
  timeoutMs?: number;
  /** The caller's own abort (a cancelled request). */
  signal?: AbortSignal;
}

export type RunResult =
  | {
      ok: true;
      text: string;
      response: AiResponse;
      model: string;
      usage: { inputTokens: number; outputTokens: number };
      /** What was booked as spent: never more than the reservation. */
      costMicroUsd: bigint;
      /** What the call cost above its reservation (0 normally): for the caller's audit. */
      overrunMicroUsd: bigint;
    }
  | { ok: false; code: AiFailureCode };

const fail = (code: AiFailureCode): RunResult => ({ ok: false, code });

// Estimating -----------------------------------------------------------------------------------------------------------

/**
 * A generous upper bound of the input tokens: one token per 3 bytes of the whole serialised request (images and PDFs count as
 * their base64 text, which is far more than they cost). Text in other scripts and JSON overhead stay under it.
 */
export function estimateInputTokens(input: RunArgs['input']): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(input)) / 3);
}

/** What one call can cost at most: the estimated input plus every output token it is allowed. */
export function worstCaseMicroUsd(input: RunArgs['input'], maxOutputTokens: number, pricing: AiPricing): bigint {
  return estimateCostMicroUsd({ inputTokens: estimateInputTokens(input), outputTokens: maxOutputTokens }, pricing);
}

function pricingOf(opts: RunOptions): AiPricing | null {
  if (opts.pricing !== undefined) return opts.pricing;
  try {
    return aiPricingEnv();
  } catch {
    return null; // a half-set price is as good as none: the safe state is to refuse
  }
}

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

// Bookkeeping ----------------------------------------------------------------------------------------------------------

/** Locks the month's usage row; every transaction here starts with this. */
async function lockUsage(tx: ScopedTx, restaurantId: string, month: string): Promise<{ spent: bigint; reserved: bigint }> {
  // eslint-disable-next-line no-restricted-properties -- row lock on the business's month row; the restaurant is part of the match
  const rows = await tx.$queryRaw<{ spent: bigint; reserved: bigint }[]>`SELECT "spentMicroUsd" AS spent, "reservedMicroUsd" AS reserved FROM "PhAiUsageMonth" WHERE "restaurantId" = ${restaurantId} AND "month" = ${month} FOR UPDATE`;
  if (rows.length === 0) throw new BudgetError('UNKNOWN_RESERVATION');
  return rows[0]!;
}

/** Ends a reservation of `held` micro-dollars (0 when it is already gone) and books `charged` as spent, plus the usage counters. */
async function book(
  tx: ScopedTx,
  month: string,
  state: { spent: bigint; reserved: bigint },
  held: bigint,
  charged: bigint,
  counters: { calls: number; inputTokens: number; outputTokens: number },
): Promise<void> {
  const next = held > 0n ? settle(state, held, charged) : { spent: state.spent + charged, reserved: state.reserved };
  await tx.phAiUsageMonth.updateMany({
    where: { month },
    data: {
      spentMicroUsd: next.spent,
      reservedMicroUsd: next.reserved,
      calls: { increment: counters.calls },
      inputTokens: { increment: counters.inputTokens },
      outputTokens: { increment: counters.outputTokens },
    },
  });
}

type Reserved = { kind: 'reserved'; reservationId: string } | { kind: 'budget' } | { kind: 'busy' };

/** One transaction: free a stale reservation of this file, then reserve `worst` if the month's budget still holds it. */
async function reserve(scoped: ScopedClient, args: RunArgs, month: string, worst: bigint, budget: bigint): Promise<Reserved> {
  try {
    return await scoped.$transaction(async (tx): Promise<Reserved> => {
      await tx.phAiUsageMonth.createMany({ data: [{ restaurantId: args.restaurantId, month }], skipDuplicates: true });
      await lockUsage(tx, args.restaurantId, month);
      // A reservation left by a worker that died: older than the lease, so its funds go back before this call asks for its own.
      const cutoff = new Date(args.now.getTime() - LEASE_MS);
      // eslint-disable-next-line no-restricted-properties -- deletes this business's stale reservation of this file and returns what it held
      const stale = await tx.$queryRaw<{ month: string; microUsd: bigint }[]>`DELETE FROM "PhAiReservation" WHERE "restaurantId" = ${args.restaurantId} AND "fileId" = ${args.fileId} AND "createdAt" < ${cutoff} RETURNING "month", "microUsd"`;
      for (const old of stale) {
        const state = await lockUsage(tx, args.restaurantId, old.month);
        await book(tx, old.month, state, old.microUsd, 0n, { calls: 0, inputTokens: 0, outputTokens: 0 });
      }
      // The one statement that holds the budget: it adds the worst case only while spent + reserved + worst still fits.
      // eslint-disable-next-line no-restricted-properties -- the conditional increment IS the budget check; the restaurant is part of the match
      const taken = await tx.$executeRaw`UPDATE "PhAiUsageMonth" SET "reservedMicroUsd" = "reservedMicroUsd" + ${worst}, "updatedAt" = now() WHERE "restaurantId" = ${args.restaurantId} AND "month" = ${month} AND "spentMicroUsd" + "reservedMicroUsd" + ${worst} <= ${budget}`;
      if (taken === 0) return { kind: 'budget' };
      const made = await tx.phAiReservation.create({ data: { restaurantId: args.restaurantId, month, microUsd: worst, fileId: args.fileId }, select: { id: true } });
      return { kind: 'reserved', reservationId: made.id };
    });
  } catch (error) {
    // A live reservation of this file exists (the transaction, budget increase included, is rolled back).
    if (isUnique(error)) return { kind: 'busy' };
    throw error;
  }
}

// Running --------------------------------------------------------------------------------------------------------------

const isTimeout = (error: unknown) => error instanceof AiTimeoutError || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'));

/**
 * One extraction call under the budget. Refusals before the call come back as `{ ok: false, code }` with nothing reserved and
 * the provider untouched. The answer of a paid call is always returned, even when booking it fails (the reservation is then
 * left for `reclaimStaleReservations`).
 */
export async function runPharmacyAi(db: Everyone, args: RunArgs, opts: RunOptions = {}): Promise<RunResult> {
  const pricing = pricingOf(opts);
  if (!pricing) return fail('AI_PRICING_NOT_SET');
  const scoped = scopedClient(db, { restaurantId: args.restaurantId, allBranches: true });
  const limits = await limitsOf(delegates(scoped), args.restaurantId, args.now);
  const budget = limits ? budgetMicroUsdFromCents(limits.aiMonthlyBudgetMinor) : 0n;
  if (budget <= 0n) return fail('AI_NOT_IN_PLAN');
  const provider = opts.provider ?? (await resolveAiProvider(db));
  if (!provider) return fail('AI_PROVIDER_ERROR');

  const month = baghdadMonth(args.now);
  const worst = worstCaseMicroUsd(args.input, args.maxOutputTokens, pricing);
  const held = await reserve(scoped, args, month, worst, budget);
  if (held.kind === 'busy') return fail('EXTRACTION_IN_PROGRESS');
  if (held.kind === 'budget') {
    await scoped.phAiCall.create({ data: { restaurantId: args.restaurantId, purpose: args.purpose, model: 'none', status: 'BUDGET', fileId: args.fileId } }).catch(() => undefined);
    return fail('AI_BUDGET_REACHED');
  }

  const started = Date.now();
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? AI_TIMEOUTS_MS[args.purpose]);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
  let response: AiResponse | null = null;
  let code: AiFailureCode | null = null;
  try {
    response = await provider.complete({ ...args.input, purpose: args.purpose, maxTokens: args.maxOutputTokens, signal });
    if (response.stop === 'refusal') code = 'AI_REFUSED';
  } catch (error) {
    code = isTimeout(error) && !opts.signal?.aborted ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR';
  }

  // What it cost: what the provider reported; a provider that answered without usage is charged the worst case; no answer, nothing.
  const reported = response !== null && (response.inputTokens > 0 || response.outputTokens > 0);
  const actual = response === null ? 0n : reported ? estimateCostMicroUsd({ inputTokens: response.inputTokens, outputTokens: response.outputTokens }, pricing) : worst;
  const charged = actual < worst ? actual : worst;
  const overrunMicroUsd = actual > worst ? actual - worst : 0n;
  const inputTokens = response?.inputTokens ?? 0;
  const outputTokens = response?.outputTokens ?? 0;
  const status = code === null ? 'OK' : code === 'AI_TIMEOUT' ? 'TIMEOUT' : 'ERROR';

  try {
    await scoped.$transaction(async (tx) => {
      const state = await lockUsage(tx, args.restaurantId, month);
      const removed = await tx.phAiReservation.deleteMany({ where: { id: held.reservationId } });
      // A sweeper may have returned the funds already (count 0): then only the spend is booked.
      await book(tx, month, state, removed.count === 1 ? worst : 0n, charged, { calls: 1, inputTokens, outputTokens });
      await tx.phAiCall.create({
        data: { restaurantId: args.restaurantId, purpose: args.purpose, model: response?.model ?? 'none', inputTokens: response ? inputTokens : null, outputTokens: response ? outputTokens : null, ms: Date.now() - started, status, costMicroUsd: charged, fileId: args.fileId },
      });
    });
  } catch {
    // Bookkeeping failed: the reservation stays for the sweeper, and the paid answer is not lost.
  }

  if (code !== null || response === null) return fail(code ?? 'AI_PROVIDER_ERROR');
  const text = response.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('');
  return { ok: true, text, response, model: response.model, usage: { inputTokens, outputTokens }, costMicroUsd: charged, overrunMicroUsd };
}

// Sweeping -------------------------------------------------------------------------------------------------------------

/**
 * Returns the funds of reservations nobody is working on: the file is gone, is no longer EXTRACTING, or its lease is older
 * than `olderThanMs`. The money goes back to the pool and is never counted as spend. Safe to run at any time and from
 * several places: each reservation is released once (a repeat finds it gone).
 */
export async function reclaimStaleReservations(db: Everyone, now: Date, olderThanMs: number = LEASE_MS): Promise<{ released: number; microUsd: bigint }> {
  const cutoff = new Date(now.getTime() - olderThanMs);
  let released = 0;
  let microUsd = 0n;
  const businesses = await db.restaurant.findMany({ where: { phAiReservations: { some: {} } }, select: { id: true }, orderBy: { id: 'asc' } });
  for (const { id: restaurantId } of businesses) {
    const scoped = scopedClient(db, { restaurantId, allBranches: true });
    const open = await scoped.phAiReservation.findMany({ select: { id: true, month: true, microUsd: true, fileId: true }, orderBy: { createdAt: 'asc' }, take: 1000 });
    const files = await scoped.phIntakeFile.findMany({ where: { id: { in: open.map((r) => r.fileId) } }, select: { id: true, status: true, extractingSince: true } });
    const live = new Set(files.filter((f) => f.status === 'EXTRACTING' && f.extractingSince !== null && f.extractingSince >= cutoff).map((f) => f.id));
    for (const reservation of open) {
      if (live.has(reservation.fileId)) continue;
      const done = await scoped.$transaction(async (tx) => {
        const state = await lockUsage(tx, restaurantId, reservation.month);
        const removed = await tx.phAiReservation.deleteMany({ where: { id: reservation.id } });
        if (removed.count === 0) return false;
        await book(tx, reservation.month, state, reservation.microUsd, 0n, { calls: 0, inputTokens: 0, outputTokens: 0 });
        return true;
      });
      if (done) {
        released += 1;
        microUsd += reservation.microUsd;
      }
    }
  }
  return { released, microUsd };
}

// Claiming a file ------------------------------------------------------------------------------------------------------

/**
 * Takes a file for extraction: one conditional UPDATE from UPLOADED or FAILED (or an EXTRACTING whose lease went stale) to
 * EXTRACTING, with the lease set to `now` and one more attempt. Exactly one of any number of racing callers gets `true`.
 */
export async function claimFileForExtraction(db: Everyone, restaurantId: string, fileId: string, now: Date, leaseMs: number = LEASE_MS): Promise<boolean> {
  const scoped = scopedClient(db, { restaurantId, allBranches: true });
  const cutoff = new Date(now.getTime() - leaseMs);
  const claimed = await scoped.phIntakeFile.updateMany({
    where: { id: fileId, OR: [{ status: { in: ['UPLOADED', 'FAILED'] } }, { status: 'EXTRACTING', extractingSince: { lt: cutoff } }] },
    data: { status: 'EXTRACTING', extractingSince: now, attempts: { increment: 1 }, failureCode: null },
  });
  return claimed.count === 1;
}

export type FileOutcome = { status: 'EXTRACTED'; now: Date } | { status: 'FAILED'; failureCode: string; now: Date } | { status: 'UPLOADED'; now: Date };

/** Ends a claim: only a file that is EXTRACTING moves, and its lease is cleared. `false` when it was not being extracted. */
export async function releaseFile(db: Everyone, restaurantId: string, fileId: string, outcome: FileOutcome): Promise<boolean> {
  const scoped = scopedClient(db, { restaurantId, allBranches: true });
  const done = await scoped.phIntakeFile.updateMany({
    where: { id: fileId, status: 'EXTRACTING' },
    data: {
      status: outcome.status,
      extractingSince: null,
      failureCode: outcome.status === 'FAILED' ? outcome.failureCode : null,
      ...(outcome.status === 'EXTRACTED' ? { extractedAt: outcome.now } : {}),
    },
  });
  return done.count === 1;
}

// Reading --------------------------------------------------------------------------------------------------------------

export interface UsageView {
  month: string;
  calls: number;
  inputTokens: string;
  outputTokens: string;
  /** Money keys only for a role with `cost.view`. */
  budgetMicroUsd?: string;
  spentMicroUsd?: string;
  reservedMicroUsd?: string;
  remainingMicroUsd?: string;
}

/** This Baghdad month's AI usage of the actor's business, as strings (bigint-safe over the wire). */
export async function usageView(scoped: ScopedClient, ph: PhActor, now: Date): Promise<UsageView> {
  const month = baghdadMonth(now);
  const row = await scoped.phAiUsageMonth.findFirst({ where: { month }, select: { spentMicroUsd: true, reservedMicroUsd: true, calls: true, inputTokens: true, outputTokens: true } });
  const view: UsageView = { month, calls: row?.calls ?? 0, inputTokens: (row?.inputTokens ?? 0n).toString(), outputTokens: (row?.outputTokens ?? 0n).toString() };
  if (!mayViewCost(ph)) return view;
  const limits = await limitsOf(delegates(scoped), ph.restaurantId, now);
  const budget = limits ? budgetMicroUsdFromCents(limits.aiMonthlyBudgetMinor) : 0n;
  const spent = row?.spentMicroUsd ?? 0n;
  const reserved = row?.reservedMicroUsd ?? 0n;
  const remaining = budget - spent - reserved;
  return {
    ...view,
    budgetMicroUsd: budget.toString(),
    spentMicroUsd: spent.toString(),
    reservedMicroUsd: reserved.toString(),
    remainingMicroUsd: (remaining > 0n ? remaining : 0n).toString(),
  };
}
