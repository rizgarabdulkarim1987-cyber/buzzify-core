import { timingSafeEqual } from 'node:crypto';
import { signRequest } from '@/server/domain/link/signing';

/**
 * Signed requests between Studio and Retails, both directions (Retails' `src/server/core/signing.ts`): HMAC-SHA256, hex,
 * over `METHOD\nPATH\nTIMESTAMP\nsha256(body)`, where PATH is the pathname plus the raw query exactly as sent and the
 * body is the raw text (a GET signs the empty string). `x-bz-timestamp` is unix seconds, `x-bz-signature` the MAC.
 * `signRequest` from the Cashier link builds the same string. Pure: nothing here reads the environment or logs.
 */

export const RETAIL_MAX_SKEW_SECONDS = 120;

const TIMESTAMP = /^\d{1,12}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;

export function signRetailRequest(
  method: string,
  pathWithQuery: string,
  body: string,
  secret: string,
  now: Date = new Date(),
): { 'x-bz-timestamp': string; 'x-bz-signature': string } {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  return { 'x-bz-timestamp': timestamp, 'x-bz-signature': signRequest(secret, method, pathWithQuery, timestamp, body) };
}

export type RetailVerdict = { ok: true } | { ok: false; reason: 'MISSING' | 'SKEW' | 'BAD_SIGNATURE' };

/** Headers present, a sane timestamp within ±120 s, then every accepted secret tried in constant time, without stopping at a match. */
export function verifyRetailRequest(
  req: { method: string; pathWithQuery: string; body: string; headers: Headers },
  secrets: readonly string[],
  now: Date = new Date(),
): RetailVerdict {
  const timestamp = req.headers.get('x-bz-timestamp');
  const signature = req.headers.get('x-bz-signature');
  if (!timestamp || !signature) return { ok: false, reason: 'MISSING' };
  if (!TIMESTAMP.test(timestamp)) return { ok: false, reason: 'BAD_SIGNATURE' };
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > RETAIL_MAX_SKEW_SECONDS) return { ok: false, reason: 'SKEW' };
  if (!SIGNATURE.test(signature)) return { ok: false, reason: 'BAD_SIGNATURE' };

  const given = Buffer.from(signature, 'hex');
  let match = false;
  for (const secret of secrets) {
    const expected = Buffer.from(signRequest(secret, req.method, req.pathWithQuery, timestamp, req.body), 'hex');
    if (timingSafeEqual(given, expected)) match = true;
  }
  return match ? { ok: true } : { ok: false, reason: 'BAD_SIGNATURE' };
}
