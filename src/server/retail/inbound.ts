import { createHash } from 'node:crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import { clientIp } from '@/server/http/client-ip';
import { readBodyWithLimit } from '@/server/http/route';
import { addressKey, checkRateLimit, RATE_RULES } from '@/server/studio/auth/rate-limit';
import { retailConfig } from './config';
import { RETAIL_MAX_SKEW_SECONDS, verifyRetailRequest } from './signing';

/**
 * What every call Buzzify Retail makes to Studio (`/api/retail/v1/*`, signed with its `CORE_OUT_SECRET`) goes through,
 * in this order: the link must be on (503), the raw body is read up to 16 KiB (413) but not parsed, the signature over
 * `METHOD`, pathname + raw query, timestamp and that raw text is checked against `RETAIL_CALLER_SECRET` (and the
 * previous one during a rotation) (401), and only then is the calling address counted (429). So nothing an unsigned
 * caller sends is parsed or written. Error bodies are a code only; nothing here logs.
 *
 * Options, for the sign-in form's calls (`/credentials*`):
 * - `bucket`: the per-address count to use instead of `retail:ip`, so a burst of sign-ins cannot use up the budget the
 *   ai-config polls and the staff identity calls share (and the other way round);
 * - `once`: a signature is good for one call. Its hash is kept as a count (`retail-sig:`) for RETAIL_REPLAY_WINDOW_SEC,
 *   longer than a timestamp is accepted either side of now, so the same signed request sent again is refused (401)
 *   instead of being answered a second time. Only for calls whose body is unique by design (a fresh nonce in each):
 *   two GETs of one path signed in the same second have the same signature and are both genuine.
 */

export const RETAIL_INBOUND_MAX_BYTES = 16 * 1024;

const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } as const;

/** A JSON answer that no cache keeps and no browser sniffs. */
export function retailJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...HEADERS, ...headers } });
}

/** An error answer: its code, nothing else. */
export const retailRefusal = (status: number, code: string, headers: Record<string, string> = {}): Response =>
  retailJson({ code }, status, headers);

export const rateLimited = (retryAfterSec: number): Response =>
  retailRefusal(429, 'RATE_LIMITED', { 'retry-after': String(retryAfterSec) });

export type Admitted = { ok: true; body: string; ip: string } | { ok: false; response: Response };

/** Longer than a signature's whole life (RETAIL_MAX_SKEW_SECONDS either side of now). */
export const RETAIL_REPLAY_WINDOW_SEC = 2 * RETAIL_MAX_SKEW_SECONDS;
export const REPLAY_KEY_PREFIX = 'retail-sig:';

const replayKey = (signature: string) => `${REPLAY_KEY_PREFIX}${createHash('sha256').update(signature.toLowerCase(), 'utf8').digest('hex')}`;

/** Spends a signature: true the first time it is seen within RETAIL_REPLAY_WINDOW_SEC, false for every repeat. Atomic. */
export async function spendSignature(prisma: Pick<PrismaClient, 'authRateLimit'>, signature: string, now: Date): Promise<boolean> {
  return (await checkRateLimit(prisma, replayKey(signature), { max: 1, windowSec: RETAIL_REPLAY_WINDOW_SEC }, now)).allowed;
}

/** Deletes the spent-signature marks older than `before` (the cron job; a mark is useless once its signature is too old). */
export async function pruneSpentSignatures(prisma: Pick<PrismaClient, 'authRateLimit'>, before: Date): Promise<number> {
  const { count } = await prisma.authRateLimit.deleteMany({ where: { key: { startsWith: REPLAY_KEY_PREFIX }, windowStart: { lt: before } } });
  return count;
}

export type AdmitOptions = { bucket?: 'retail:ip' | 'retail-signin:ip'; once?: boolean };

export async function admitRetailCall(prisma: PrismaClient, request: Request, now: Date, options: AdmitOptions = {}): Promise<Admitted> {
  const config = retailConfig();
  if (!config.enabled) return { ok: false, response: retailRefusal(503, 'UNAVAILABLE') };
  let secrets: string[];
  try {
    secrets = config.callerSecrets;
  } catch {
    return { ok: false, response: retailRefusal(503, 'UNAVAILABLE') };
  }

  const body = await readBodyWithLimit(request, RETAIL_INBOUND_MAX_BYTES);
  if (body === null) return { ok: false, response: retailRefusal(413, 'TOO_LARGE') };

  const url = new URL(request.url);
  const verdict = verifyRetailRequest({ method: request.method, pathWithQuery: url.pathname + url.search, body, headers: request.headers }, secrets, now);
  if (!verdict.ok) return { ok: false, response: retailRefusal(401, 'UNAUTHORIZED') };
  if (options.once && !(await spendSignature(prisma, request.headers.get('x-bz-signature') ?? '', now))) {
    return { ok: false, response: retailRefusal(401, 'UNAUTHORIZED') };
  }

  const bucket = options.bucket ?? 'retail:ip';
  const ip = addressKey(clientIp(request.headers));
  const limit = await checkRateLimit(prisma, `${bucket}:${ip}`, RATE_RULES[bucket], now);
  if (!limit.allowed) return { ok: false, response: rateLimited(limit.retryAfterSec) };
  return { ok: true, body, ip };
}
