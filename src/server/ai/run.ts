import type { PosAiFeature } from '@/generated/prisma/client';
import type { AnyDb } from '@/server/data/tenant-db';
import { AiOutputRejectedError, AiProviderError, AiRefusedError, AiTimeoutError, AiUnavailableError, AiUnreadableError } from './errors';
import { requireAi } from './package';
import { AI_TIMEOUTS_MS } from './provider/models';
import { resolveAiProvider } from './settings';
import type { AiRequest, AiResponse } from './provider/types';
import { addAiTokens, releaseAiRequest, reserveAiRequest } from './usage';

/** Who an AI operation runs for: the restaurant's database handle (plain, not a transaction) and the person who started it. */
export interface AiEnv {
  db: AnyDb;
  restaurantId: string;
  staffId: string | null;
}

export type AiCaller = (req: Omit<AiRequest, 'signal'>) => Promise<AiResponse>;

/**
 * Wraps one user-started AI operation in the same sequence every time: package check, provider present, usage reservation,
 * the work (each model call with its own timeout), then exactly one metadata row. A reservation is given back when the
 * provider never answered. The row holds no prompt, answer, tool result or file.
 */
export async function runAi<T>(env: AiEnv, opts: { feature: PosAiFeature; now?: Date; work: (call: AiCaller) => Promise<T> }): Promise<T> {
  const pkg = await requireAi(env.db, env.restaurantId);
  const provider = await resolveAiProvider(env.db);
  if (!provider) throw new AiUnavailableError('No AI provider is configured');
  const now = opts.now ?? new Date();
  const { month } = await reserveAiRequest(env.db, env.restaurantId, pkg.monthlyLimit, now);

  const started = Date.now();
  let responded = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let toolCalls = 0;
  let model = 'none';
  const call: AiCaller = async (req) => {
    let res: AiResponse;
    try {
      res = await provider.complete({ ...req, signal: AbortSignal.timeout(AI_TIMEOUTS_MS[req.purpose]) });
    } catch (error) {
      if (error instanceof AiUnavailableError) throw error;
      throw new AiProviderError(error instanceof Error ? error.name : null);
    }
    responded = true;
    inputTokens += res.inputTokens;
    outputTokens += res.outputTokens;
    model = res.model;
    toolCalls += res.content.filter((c) => c.type === 'tool_use').length;
    if (res.stop === 'refusal') throw new AiRefusedError();
    return res;
  };

  let status: 'OK' | 'PROVIDER_ERROR' | 'TIMEOUT' | 'REFUSED' | 'REJECTED_OUTPUT' = 'OK';
  try {
    return await opts.work(call);
  } catch (error) {
    status =
      error instanceof AiTimeoutError ? 'TIMEOUT' : error instanceof AiRefusedError ? 'REFUSED' : error instanceof AiOutputRejectedError || error instanceof AiUnreadableError ? 'REJECTED_OUTPUT' : 'PROVIDER_ERROR';
    throw error;
  } finally {
    // Each write stands alone: a failed bookkeeping write must neither hide the real error nor keep a request that was never answered.
    if (!responded) await releaseAiRequest(env.db, env.restaurantId, month).catch(() => undefined);
    await env.db.posAiCall.create({ data: { restaurantId: env.restaurantId, staffId: env.staffId, feature: opts.feature, model, status, inputTokens, outputTokens, toolCalls, ms: Date.now() - started } }).catch(() => undefined);
    await addAiTokens(env.db, env.restaurantId, month, inputTokens, outputTokens).catch(() => undefined);
  }
}
