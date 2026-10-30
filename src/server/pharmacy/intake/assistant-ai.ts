import { randomUUID } from 'node:crypto';
import { AI_TIMEOUTS_MS } from '@/server/ai/provider/models';
import type { AiProvider, AiRequest, AiResponse } from '@/server/ai/provider/types';
import { resolveAiProvider } from '@/server/ai/settings';
import { delegates, scopedClient } from '@/server/data/tenant-db';
import { baghdadMonth, budgetMicroUsdFromCents, estimateCostMicroUsd, fitsContext } from '@/server/domain/pharmacy/intake';
import { limitsOf } from '@/server/domain/pharmacy/limits';
import { book, estimateInputTokens, isTimeout, isUnique, lockUsage, logError, pricingOf, type AiFailureCode, type AiPricing, type RunOptions } from './ai';

/**
 * The assistant's call under the SAME budget as invoice reading (R7-6; budget kind ASSISTANT): `PhAiUsageMonth`,
 * `PhAiReservation` and `PhAiCall`, with the same reserve-then-settle rule as `runPharmacyAi` (ai.ts, read its header): the worst
 * case is reserved in one conditional UPDATE, the provider is called outside any transaction, and the actual cost is booked in full.
 * It lives in this folder because only this folder writes the AI tables (enforcement).
 *
 * Differences from the extraction call: there is no file and no lease, so the reservation's `fileId` is a fresh `assistant:<uuid>`
 * (a stale one is swept as spend like any other, since no file row exists for it), and the call log's purpose is `assistant`.
 * Nothing here throws for a database or provider problem: a refusal is `{ ok: false, code }` and the assistant shows the plain tables.
 * Lock order: the month's usage row first, as in ai.ts. The call log holds no prompt and no answer.
 */

export interface AssistantCallArgs {
  restaurantId: string;
  input: Omit<AiRequest, 'signal' | 'maxTokens' | 'purpose'>;
  maxOutputTokens: number;
  now: Date;
}

export type AssistantCallOptions = Pick<RunOptions, 'provider' | 'pricing' | 'timeoutMs' | 'signal'>;

export type AssistantCallResult = { ok: true; response: AiResponse; costMicroUsd: bigint } | { ok: false; code: AiFailureCode };

const fail = (code: AiFailureCode): AssistantCallResult => ({ ok: false, code });

type Everyone = Parameters<typeof scopedClient>[0];

export async function runAssistantAi(db: Everyone, args: AssistantCallArgs, opts: AssistantCallOptions = {}): Promise<AssistantCallResult> {
  const ids = { restaurantId: args.restaurantId };
  const pricing: AiPricing | null = pricingOf(opts);
  if (!pricing) return fail('AI_PRICING_NOT_SET');
  const inputBound = estimateInputTokens(args.input);
  if (inputBound === null || !fitsContext(inputBound, args.maxOutputTokens)) return fail('AI_INPUT_TOO_LARGE');
  const worst = estimateCostMicroUsd({ inputTokens: inputBound, outputTokens: args.maxOutputTokens }, pricing);
  const inputSide = estimateCostMicroUsd({ inputTokens: inputBound, outputTokens: 0 }, pricing);

  const scoped = scopedClient(db, { restaurantId: args.restaurantId, allBranches: true });
  const month = baghdadMonth(args.now);
  const fileId = `assistant:${randomUUID()}`;
  let provider: AiProvider | null;
  let reservationId: string;
  try {
    const limits = await limitsOf(delegates(scoped), args.restaurantId, args.now);
    const budget = limits ? budgetMicroUsdFromCents(limits.aiMonthlyBudgetMinor) : 0n;
    if (budget <= 0n) return fail('AI_NOT_IN_PLAN');
    provider = opts.provider ?? (await resolveAiProvider(db));
    if (!provider) return fail('AI_NOT_CONFIGURED');
    const running = provider.modelFor?.('ask');
    if (pricing.model !== undefined && running !== undefined && running !== pricing.model) {
      logError('the price is declared for another model than the one that would run', ids);
      return fail('AI_PRICING_MODEL_MISMATCH');
    }
    const held = await scoped.$transaction(async (tx) => {
      await tx.phAiUsageMonth.createMany({ data: [{ restaurantId: args.restaurantId, month }], skipDuplicates: true });
      await lockUsage(tx, args.restaurantId, month);
      // The one statement that holds the budget: it adds the worst case only while spent + reserved + worst still fits.
      // eslint-disable-next-line no-restricted-properties -- the conditional increment IS the budget check; the restaurant is part of the match
      const taken = await tx.$executeRaw`UPDATE "PhAiUsageMonth" SET "reservedMicroUsd" = "reservedMicroUsd" + ${worst}, "updatedAt" = now() WHERE "restaurantId" = ${args.restaurantId} AND "month" = ${month} AND "spentMicroUsd" + "reservedMicroUsd" + ${worst} <= ${budget}`;
      if (taken === 0) return null;
      const made = await tx.phAiReservation.create({ data: { restaurantId: args.restaurantId, month, microUsd: worst, fileId, createdAt: args.now }, select: { id: true } });
      return made.id;
    });
    if (held === null) {
      await scoped.phAiCall.create({ data: { restaurantId: args.restaurantId, purpose: 'assistant', model: 'none', status: 'BUDGET', fileId } }).catch(() => undefined);
      return fail('AI_BUDGET_REACHED');
    }
    reservationId = held;
  } catch (error) {
    if (isUnique(error)) return fail('EXTRACTION_IN_PROGRESS');
    logError('could not reserve', ids, error);
    return fail('AI_PROVIDER_ERROR');
  }

  const started = Date.now();
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? AI_TIMEOUTS_MS.ask);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
  let response: AiResponse | null = null;
  let code: AiFailureCode | null = null;
  try {
    response = await provider.complete({ ...args.input, purpose: 'ask', maxTokens: args.maxOutputTokens, signal });
    if (response.stop === 'refusal') code = 'AI_REFUSED';
  } catch (error) {
    code = isTimeout(error) && opts.signal?.aborted !== true ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR';
  }

  // What it cost: the provider's report (none: the worst case); a timeout or abort probably billed the input; any other error, nothing.
  const reported = response !== null && (response.inputTokens > 0 || response.outputTokens > 0);
  const billedMaybe = code === 'AI_TIMEOUT' || opts.signal?.aborted === true;
  const actual = response !== null ? (reported ? estimateCostMicroUsd({ inputTokens: response.inputTokens, outputTokens: response.outputTokens }, pricing) : worst) : billedMaybe ? inputSide : 0n;
  if (actual > worst) logError('overrun: the call cost more than its reservation (the input bound was too low); the real cost is booked', ids);
  const inputTokens = response?.inputTokens ?? 0;
  const outputTokens = response?.outputTokens ?? 0;
  const status = code === null ? 'OK' : code === 'AI_TIMEOUT' ? 'TIMEOUT' : 'ERROR';
  const model = response?.model ?? 'none';

  const settleOnce = () =>
    scoped.$transaction(async (tx) => {
      const state = await lockUsage(tx, args.restaurantId, month);
      const removed = await tx.phAiReservation.deleteMany({ where: { id: reservationId } });
      // Gone: the sweeper booked it as spend (then only what the call cost above that is still owed), or an earlier attempt of this settle committed.
      if (removed.count === 0) {
        const logged = await tx.phAiCall.count({ where: { fileId, purpose: 'assistant' } });
        if (logged > 0) return;
      }
      const gone = removed.count === 0;
      const owed = gone ? (actual > worst ? actual - worst : 0n) : actual;
      await book(tx, month, state, gone ? 0n : worst, owed, { calls: gone ? 0 : 1, inputTokens, outputTokens });
      await tx.phAiCall.create({
        data: { restaurantId: args.restaurantId, purpose: 'assistant', model, inputTokens: response ? inputTokens : null, outputTokens: response ? outputTokens : null, ms: Date.now() - started, status, costMicroUsd: owed, fileId },
      });
    });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await settleOnce();
      break;
    } catch (error) {
      // Twice failing leaves the reservation for the sweeper, which books it as spend at the reserved amount (never unspent).
      if (attempt === 2) logError('could not settle; the reservation is left for the sweeper', ids, error);
    }
  }

  if (code !== null || response === null) return fail(code ?? 'AI_PROVIDER_ERROR');
  return { ok: true, response, costMicroUsd: actual };
}
