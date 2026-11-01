import type { PrismaClient } from '@/generated/prisma/client';
import { clientIp } from '@/server/http/client-ip';
import { readBodyWithLimit } from '@/server/http/route';
import { addressKey, checkRateLimit, RATE_RULES } from '@/server/studio/auth/rate-limit';
import { retailConfig } from './config';
import { verifyRetailRequest } from './signing';

/**
 * What every call Buzzify Retail makes to Studio (`/api/retail/v1/*`, signed with its `CORE_OUT_SECRET`) goes through,
 * in this order: the link must be on (503), the raw body is read up to 16 KiB (413) but not parsed, the signature over
 * `METHOD`, pathname + raw query, timestamp and that raw text is checked against `RETAIL_CALLER_SECRET` (and the
 * previous one during a rotation) (401), and only then is the calling address counted (429). So nothing an unsigned
 * caller sends is parsed or written. Error bodies are a code only; nothing here logs.
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

export async function admitRetailCall(prisma: PrismaClient, request: Request, now: Date): Promise<Admitted> {
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

  const ip = addressKey(clientIp(request.headers));
  const limit = await checkRateLimit(prisma, `retail:ip:${ip}`, RATE_RULES['retail:ip'], now);
  if (!limit.allowed) return { ok: false, response: rateLimited(limit.retryAfterSec) };
  return { ok: true, body, ip };
}
