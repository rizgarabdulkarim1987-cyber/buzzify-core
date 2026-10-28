import { AiTimeoutError } from '@/server/ai/errors';
import { AI_TIMEOUTS_MS } from '@/server/ai/provider/models';
import type { AiProvider, AiRequest, AiResponse } from '@/server/ai/provider/types';
import { resolveAiProvider } from '@/server/ai/settings';
import { delegates, scopedClient, type ScopedClient, type ScopedTx } from '@/server/data/tenant-db';
import { aiPricingEnv } from '@/server/env';
import {
  baghdadMonth,
  BudgetError,
  budgetMicroUsdFromCents,
  estimateCostMicroUsd,
  fitsContext,
  inputTokensUpperBound,
  settle,
  type MediaHint,
} from '@/server/domain/pharmacy/intake';
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
 * answer already paid for is never thrown away, the overrun is audited). The call log holds no prompt and no answer.
 *
 * The caller must hold the file's lease (`claimFileForExtraction` returns it); the reservation is made only while that lease is
 * still the file's, and a settle that finds it lost still books the money but reports LEASE_LOST so the caller drops the answer.
 *
 * Budget safety beats accuracy. A reservation whose worker died is NEVER given back as unspent: the sweeper books it as spend at
 * the reserved amount. Cost of being wrong: a crash before the provider was called wastes up to one worst case of the month's
 * budget (the month under-uses its budget; it never overspends). A timeout or abort, where the provider probably billed the
 * input, books the input side; a plain provider error books nothing.
 *
 * One clock: every age here is measured against the `now` the caller passes (reservations are stamped with it).
 *
 * Lock order (extends phase 5's, see files.ts): usage rows FOR UPDATE first (ascending month), then the file's reservation
 * row, then the file row (a share lock for the lease check). The provider is never called inside a transaction. Only this
 * folder writes the AI tables.
 */

/** A reservation or lease older than this is stale: its worker is presumed dead. */
export const LEASE_MS = 10 * 60_000;
/** No sweep may free anything younger than a call can legitimately run (the extraction timeout plus a margin). */
export const MIN_STALE_MS = AI_TIMEOUTS_MS.extract + 60_000;
/** A file is extracted at most this many times. */
export const MAX_ATTEMPTS = 5;

type Everyone = Parameters<typeof scopedClient>[0];

/** Micro-dollars per million tokens. There is no default: production reads it from the environment or refuses. */
export interface AiPricing {
  inputPerMtok: bigint;
  outputPerMtok: bigint;
}

export type AiFailureCode =
  | 'AI_PRICING_NOT_SET'
  | 'AI_NOT_IN_PLAN'
  | 'AI_NOT_CONFIGURED'
  | 'AI_INPUT_TOO_LARGE'
  | 'AI_BUDGET_REACHED'
  | 'EXTRACTION_IN_PROGRESS'
  | 'LEASE_LOST'
  | 'AI_TIMEOUT'
  | 'AI_PROVIDER_ERROR'
  | 'AI_REFUSED';

export interface RunArgs {
  restaurantId: string;
  fileId: string;
  /** The extraction lease `claimFileForExtraction` returned for this file. */
  lease: Date;
  purpose: 'extract';
  input: Omit<AiRequest, 'signal' | 'maxTokens' | 'purpose'>;
  /** One hint per image or PDF part of `input`, from the stored file (never from the bytes sent). */
  media?: readonly MediaHint[];
  maxOutputTokens: number;
  now: Date;
}

/** What goes into the audit trail of a call: ids, counts and amounts only (strings for bigint). */
export type CallAudit = Record<string, string | number>;

export interface RunOptions {
  /** Tests: the model to call; otherwise the platform's configured one. */
  provider?: AiProvider;
  /** Tests: a price; otherwise the environment's, and none means refusal. */
  pricing?: AiPricing | null;
  timeoutMs?: number;
  /** The caller's own abort (a cancelled request). */
  signal?: AbortSignal;
  /** Called once per call that reserved, after settling, with the figures to audit (cost, overrun). A failure here is logged, not thrown. */
  audit?: (changes: CallAudit) => Promise<void>;
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
      /** What the call cost above its reservation (0 normally). */
      overrunMicroUsd: bigint;
    }
  | { ok: false; code: AiFailureCode };

const fail = (code: AiFailureCode): RunResult => ({ ok: false, code });
const logError = (what: string, detail: Record<string, string>, error?: unknown) =>
  console.error(`[pharmacy-ai] ${what}`, { ...detail, error: error instanceof Error ? `${error.name}:${(error as { code?: string }).code ?? ''}` : '' });

// Estimating -----------------------------------------------------------------------------------------------------------

const isMedia = (c: { type: string }) => c.type === 'document' || c.type === 'image';

/**
 * An upper bound of the input tokens of `input`: its text (everything but the image and PDF parts) by bytes, its media by the
 * stored hints. `null` when the hints do not match the media parts or cannot bound them.
 */
export function estimateInputTokens(input: RunArgs['input'], media: readonly MediaHint[] = []): number | null {
  const parts = input.messages.flatMap((m) => m.content);
  if (parts.filter(isMedia).length !== media.length) return null;
  const textOnly = { ...input, messages: input.messages.map((m) => ({ ...m, content: m.content.filter((c) => !isMedia(c)) })) };
  return inputTokensUpperBound(Buffer.byteLength(JSON.stringify(textOnly)), media);
}

/** What one call can cost at most: the bounded input plus every output token it is allowed. `null` when the input cannot be bounded. */
export function worstCaseMicroUsd(input: RunArgs['input'], maxOutputTokens: number, pricing: AiPricing, media: readonly MediaHint[] = []): bigint | null {
  const inputTokens = estimateInputTokens(input, media);
  return inputTokens === null ? null : estimateCostMicroUsd({ inputTokens, outputTokens: maxOutputTokens }, pricing);
}

let pricingWarned = false;
function pricingOf(opts: RunOptions): AiPricing | null {
  if (opts.pricing !== undefined) return opts.pricing;
  try {
    return aiPricingEnv();
  } catch (error) {
    if (!pricingWarned) {
      pricingWarned = true;
      console.error('[pharmacy-ai] the AI price variables are set wrongly, so the pharmacy AI refuses to run:', error instanceof Error ? error.message : '');
    }
    return null; // a half-set price is as good as none: the safe state is to refuse
  }
}

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

// Bookkeeping ----------------------------------------------------------------------------------------------------------

/** Locks the month's usage row; every transaction here starts with this (ascending month when it needs several). */
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

type OpenReservation = { id: string; month: string; microUsd: bigint; fileId: string };

/**
 * A reservation nobody will settle becomes SPEND at the reserved amount (never unspent), logged as an ERROR call. The caller
 * holds the month's usage row. `false` when it was already gone (someone else settled or swept it).
 */
async function convertToSpend(tx: ScopedTx, restaurantId: string, reservation: OpenReservation): Promise<boolean> {
  const state = await lockUsage(tx, restaurantId, reservation.month);
  const removed = await tx.phAiReservation.deleteMany({ where: { id: reservation.id } });
  if (removed.count === 0) return false;
  await book(tx, reservation.month, state, reservation.microUsd, reservation.microUsd, { calls: 1, inputTokens: 0, outputTokens: 0 });
  await tx.phAiCall.create({ data: { restaurantId, purpose: 'extract', model: 'none', status: 'ERROR', costMicroUsd: reservation.microUsd, fileId: reservation.fileId } });
  return true;
}

type Reserved = { kind: 'reserved'; reservationId: string } | { kind: 'budget' } | { kind: 'busy' } | { kind: 'lease' };

/**
 * One transaction: lock the month(s), check the caller still holds the file's lease, book as spend a same-file reservation left
 * by an earlier holder, then reserve `worst` if the month's budget still holds it.
 */
async function reserve(scoped: ScopedClient, args: RunArgs, month: string, worst: bigint, budget: bigint): Promise<Reserved> {
  try {
    return await scoped.$transaction(async (tx): Promise<Reserved> => {
      await tx.phAiUsageMonth.createMany({ data: [{ restaurantId: args.restaurantId, month }], skipDuplicates: true });
      // A reservation of this file that predates the lease the caller holds, or is older than the lease length, belongs to a dead worker.
      const cutoff = new Date(args.now.getTime() - LEASE_MS);
      const dead = await tx.phAiReservation.findMany({
        where: { fileId: args.fileId, OR: [{ createdAt: { lt: cutoff } }, { createdAt: { lt: args.lease } }] },
        select: { id: true, month: true, microUsd: true, fileId: true },
      });
      for (const m of [...new Set([month, ...dead.map((d) => d.month)])].sort()) await lockUsage(tx, args.restaurantId, m);
      // eslint-disable-next-line no-restricted-properties -- share lock on the file row: its lease cannot change under this reservation
      const held = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "PhIntakeFile" WHERE "id" = ${args.fileId} AND "restaurantId" = ${args.restaurantId} AND "status" = 'EXTRACTING' AND "extractingSince" = ${args.lease} FOR SHARE`;
      if (held.length === 0) return { kind: 'lease' };
      for (const old of dead) await convertToSpend(tx, args.restaurantId, old);
      // The one statement that holds the budget: it adds the worst case only while spent + reserved + worst still fits.
      // eslint-disable-next-line no-restricted-properties -- the conditional increment IS the budget check; the restaurant is part of the match
      const taken = await tx.$executeRaw`UPDATE "PhAiUsageMonth" SET "reservedMicroUsd" = "reservedMicroUsd" + ${worst}, "updatedAt" = now() WHERE "restaurantId" = ${args.restaurantId} AND "month" = ${month} AND "spentMicroUsd" + "reservedMicroUsd" + ${worst} <= ${budget}`;
      if (taken === 0) return { kind: 'budget' };
      const made = await tx.phAiReservation.create({ data: { restaurantId: args.restaurantId, month, microUsd: worst, fileId: args.fileId, createdAt: args.now }, select: { id: true } });
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
 * the provider untouched; nothing here throws for a database or provider problem. The answer of a paid call is returned even when
 * booking it fails twice (the reservation is then left for the sweeper, which books it as spend).
 */
export async function runPharmacyAi(db: Everyone, args: RunArgs, opts: RunOptions = {}): Promise<RunResult> {
  const ids = { restaurantId: args.restaurantId, fileId: args.fileId };
  const pricing = pricingOf(opts);
  if (!pricing) return fail('AI_PRICING_NOT_SET');
  const inputBound = estimateInputTokens(args.input, args.media ?? []);
  if (inputBound === null || !fitsContext(inputBound, args.maxOutputTokens)) return fail('AI_INPUT_TOO_LARGE');
  const worst = estimateCostMicroUsd({ inputTokens: inputBound, outputTokens: args.maxOutputTokens }, pricing);
  const inputSide = estimateCostMicroUsd({ inputTokens: inputBound, outputTokens: 0 }, pricing);

  const scoped = scopedClient(db, { restaurantId: args.restaurantId, allBranches: true });
  let provider: AiProvider | null;
  let budget: bigint;
  let held: Reserved;
  const month = baghdadMonth(args.now);
  try {
    const limits = await limitsOf(delegates(scoped), args.restaurantId, args.now);
    budget = limits ? budgetMicroUsdFromCents(limits.aiMonthlyBudgetMinor) : 0n;
    if (budget <= 0n) return fail('AI_NOT_IN_PLAN');
    provider = opts.provider ?? (await resolveAiProvider(db));
    if (!provider) return fail('AI_NOT_CONFIGURED');
    held = await reserve(scoped, args, month, worst, budget);
  } catch (error) {
    logError('could not reserve', ids, error);
    return fail('AI_PROVIDER_ERROR');
  }
  if (held.kind === 'busy') return fail('EXTRACTION_IN_PROGRESS');
  if (held.kind === 'lease') return fail('LEASE_LOST');
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
    const callerAborted = opts.signal?.aborted === true;
    code = isTimeout(error) && !callerAborted ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR';
  }

  // What it cost. An answer: what the provider reported (none reported: the worst case). A timeout or an abort after the request
  // went out: the provider probably billed the input, so the input side. Any other error: nothing was billed.
  const reported = response !== null && (response.inputTokens > 0 || response.outputTokens > 0);
  const billedMaybe = code === 'AI_TIMEOUT' || opts.signal?.aborted === true;
  const actual = response !== null ? (reported ? estimateCostMicroUsd({ inputTokens: response.inputTokens, outputTokens: response.outputTokens }, pricing) : worst) : billedMaybe ? inputSide : 0n;
  const charged = actual < worst ? actual : worst;
  const overrunMicroUsd = actual > worst ? actual - worst : 0n;
  const inputTokens = response?.inputTokens ?? 0;
  const outputTokens = response?.outputTokens ?? 0;
  const status = code === null ? 'OK' : code === 'AI_TIMEOUT' ? 'TIMEOUT' : 'ERROR';

  const settleOnce = () =>
    scoped.$transaction(async (tx) => {
      const state = await lockUsage(tx, args.restaurantId, month);
      // Still the holder of the lease? (Read after the usage lock; a lost lease changes the answer, never the books.)
      const mine = (await tx.phIntakeFile.count({ where: { id: args.fileId, status: 'EXTRACTING', extractingSince: args.lease } })) === 1;
      const removed = await tx.phAiReservation.deleteMany({ where: { id: held.reservationId } });
      // A sweeper may have booked it as spend already (count 0): at the reserved amount, which is never below this call's charge, so nothing more is added.
      const swept = removed.count === 0;
      await book(tx, month, state, swept ? 0n : worst, swept ? 0n : charged, { calls: swept ? 0 : 1, inputTokens, outputTokens });
      await tx.phAiCall.create({
        data: { restaurantId: args.restaurantId, purpose: args.purpose, model: response?.model ?? 'none', inputTokens: response ? inputTokens : null, outputTokens: response ? outputTokens : null, ms: Date.now() - started, status, costMicroUsd: swept ? 0n : charged, fileId: args.fileId },
      });
      return mine;
    });
  let mine = true;
  let booked = false;
  for (let attempt = 1; attempt <= 2 && !booked; attempt += 1) {
    try {
      mine = await settleOnce();
      booked = true;
    } catch (error) {
      // Twice failing leaves the reservation in place: the sweeper books it as spend at the reserved amount (never unspent).
      if (attempt === 2) logError('could not settle; the reservation is left for the sweeper', ids, error);
    }
  }

  if (opts.audit) {
    await opts
      .audit({ fileId: args.fileId, status, model: response?.model ?? 'none', inputTokens, outputTokens, costMicroUsd: charged.toString(), overrunMicroUsd: overrunMicroUsd.toString(), reservedMicroUsd: worst.toString(), settled: booked ? 1 : 0 })
      .catch((error: unknown) => logError('could not audit', ids, error));
  }

  if (!mine) return fail('LEASE_LOST');
  if (code !== null || response === null) return fail(code ?? 'AI_PROVIDER_ERROR');
  const text = response.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('');
  return { ok: true, text, response, model: response.model, usage: { inputTokens, outputTokens }, costMicroUsd: charged, overrunMicroUsd };
}

// Sweeping -------------------------------------------------------------------------------------------------------------

export interface SweepResult {
  /** Reservations booked as spend. */
  swept: number;
  microUsd: bigint;
  /** One entry per reservation or business that failed; the sweep carried on past each. */
  errors: { id: string; error: string }[];
}

/**
 * Books the reservations nobody is working on as SPEND at their reserved amount (never as unspent: a crashed worker may have
 * had the provider bill it). A reservation is swept only when it is older than `olderThanMs` (never less than the extraction
 * timeout plus a margin, so a live call is never touched) AND its file is gone, no longer EXTRACTING, or holds a stale lease.
 * Task 5 calls this before each extraction and at upload; a scheduled run is a launch step. Handles up to 1000 reservations
 * per business per run; the rest wait for the next. One bad row is recorded in `errors` and the sweep goes on.
 */
export async function sweepAiReservations(db: Everyone, now: Date, olderThanMs: number = LEASE_MS): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - Math.max(olderThanMs, MIN_STALE_MS));
  const result: SweepResult = { swept: 0, microUsd: 0n, errors: [] };
  const note = (id: string, error: unknown) => {
    const text = error instanceof Error ? `${error.name}:${(error as { code?: string }).code ?? ''}` : 'unknown';
    result.errors.push({ id, error: text });
    logError('sweep failed', { id }, error);
  };
  let businesses: { id: string }[] = [];
  try {
    businesses = await db.restaurant.findMany({ where: { phAiReservations: { some: { createdAt: { lt: cutoff } } } }, select: { id: true }, orderBy: { id: 'asc' } });
  } catch (error) {
    note('businesses', error);
    return result;
  }
  for (const { id: restaurantId } of businesses) {
    const scoped = scopedClient(db, { restaurantId, allBranches: true });
    let stale: OpenReservation[];
    try {
      const old = await scoped.phAiReservation.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true, month: true, microUsd: true, fileId: true }, orderBy: { createdAt: 'asc' }, take: 1000 });
      const files = await scoped.phIntakeFile.findMany({ where: { id: { in: old.map((r) => r.fileId) } }, select: { id: true, status: true, extractingSince: true } });
      const live = new Set(files.filter((f) => f.status === 'EXTRACTING' && f.extractingSince !== null && f.extractingSince >= cutoff).map((f) => f.id));
      stale = old.filter((r) => !live.has(r.fileId));
    } catch (error) {
      note(restaurantId, error);
      continue;
    }
    for (const reservation of stale) {
      try {
        if (await scoped.$transaction((tx) => convertToSpend(tx, restaurantId, reservation))) {
          result.swept += 1;
          result.microUsd += reservation.microUsd;
        }
      } catch (error) {
        note(reservation.id, error);
      }
    }
  }
  return result;
}

// Claiming a file ------------------------------------------------------------------------------------------------------

export type ClaimResult = { ok: true; lease: Date } | { ok: false; reason: 'NOT_CLAIMABLE' | 'EXTRACTION_ATTEMPTS_EXHAUSTED' };

const claimable = (cutoff: Date) => ({ OR: [{ status: { in: ['UPLOADED', 'FAILED'] as ('UPLOADED' | 'FAILED')[] } }, { status: 'EXTRACTING' as const, extractingSince: { lt: cutoff } }] });

/**
 * Takes a file for extraction: one conditional UPDATE from UPLOADED or FAILED (or an EXTRACTING whose lease went stale) to
 * EXTRACTING, with one more attempt (at most `MAX_ATTEMPTS`). Exactly one of any number of racing callers wins, and gets the
 * lease: the `extractingSince` it set, which `runPharmacyAi` and `releaseFile` must present (a stale holder is thereby fenced off).
 */
export async function claimFileForExtraction(db: Everyone, restaurantId: string, fileId: string, now: Date, leaseMs: number = LEASE_MS): Promise<ClaimResult> {
  const scoped = scopedClient(db, { restaurantId, allBranches: true });
  const cutoff = new Date(now.getTime() - leaseMs);
  const claimed = await scoped.phIntakeFile.updateMany({
    where: { id: fileId, attempts: { lt: MAX_ATTEMPTS }, ...claimable(cutoff) },
    data: { status: 'EXTRACTING', extractingSince: now, attempts: { increment: 1 }, failureCode: null },
  });
  if (claimed.count === 1) return { ok: true, lease: now };
  const spent = await scoped.phIntakeFile.count({ where: { id: fileId, attempts: { gte: MAX_ATTEMPTS }, ...claimable(cutoff) } });
  return { ok: false, reason: spent === 1 ? 'EXTRACTION_ATTEMPTS_EXHAUSTED' : 'NOT_CLAIMABLE' };
}

export type FileOutcome = { status: 'EXTRACTED'; now: Date } | { status: 'FAILED'; failureCode: string; now: Date } | { status: 'UPLOADED'; now: Date };

/** Ends a claim: only the file's current lease holder moves it, and the lease is cleared. Anyone else gets `LEASE_LOST` and changes nothing. */
export async function releaseFile(db: Everyone, restaurantId: string, fileId: string, lease: Date, outcome: FileOutcome): Promise<'RELEASED' | 'LEASE_LOST'> {
  const scoped = scopedClient(db, { restaurantId, allBranches: true });
  const done = await scoped.phIntakeFile.updateMany({
    where: { id: fileId, status: 'EXTRACTING', extractingSince: lease },
    data: {
      status: outcome.status,
      extractingSince: null,
      failureCode: outcome.status === 'FAILED' ? outcome.failureCode : null,
      ...(outcome.status === 'EXTRACTED' ? { extractedAt: outcome.now } : {}),
    },
  });
  return done.count === 1 ? 'RELEASED' : 'LEASE_LOST';
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
