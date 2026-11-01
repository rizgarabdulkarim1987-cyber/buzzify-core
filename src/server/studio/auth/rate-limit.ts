import { createHash } from 'node:crypto';
import type { PrismaClient } from '@/generated/prisma/client';

export interface RateRule {
  /** How many attempts a window allows. */
  max: number;
  windowSec: number;
}

export type RateVerdict = { allowed: true } | { allowed: false; retryAfterSec: number };

/**
 * The Studio's limits, each applied to a key such as `signin:email:owner@example.com`. Better Auth has its own limiter,
 * but it sees only requests that arrive over HTTP, and the Studio serves none of its sign-in routes over HTTP; the
 * Server Actions call `auth.api` directly and are limited here.
 */
export const RATE_RULES = {
  'signin:ip': { max: 20, windowSec: 600 },
  'signin:email': { max: 5, windowSec: 600 },
  'totp:user': { max: 5, windowSec: 300 },
  'reset:email': { max: 3, windowSec: 3600 },
  'reset:ip': { max: 20, windowSec: 3600 },
  /** A signed-in person's password checks (turning two-factor on or off, new recovery codes, a password change). */
  'reauth:user': { max: 10, windowSec: 600 },
  'invite:ip': { max: 20, windowSec: 3600 },
  /** Attempts to accept one invitation, from any address: the invitation stands for the account it makes. */
  'invite:token': { max: 10, windowSec: 3600 },
  /** Signed calls from Buzzify Retail (ai-config, identities), per calling address: Retails' own budget for Studio's calls. */
  'retail:ip': { max: 120, windowSec: 60 },
  /** Retails asking for an account for a staff email: it can make an account for any address, so it is held tighter. */
  'retail-identity:ip': { max: 30, windowSec: 600 },
  'retail-identity:email': { max: 5, windowSec: 3600 },
} as const satisfies Record<string, RateRule>;

/** Requests whose address is unknown share one bucket, rather than having no per-address limit at all. */
export const addressKey = (ip: string): string => (ip === '' ? 'unknown' : ip);

/** Longer keys are stored as their hash. An email typed into a sign-in form is chosen by whoever types it. */
const MAX_KEY_LENGTH = 200;

function storedKey(key: string): string {
  return key.length <= MAX_KEY_LENGTH ? key : `sha256:${createHash('sha256').update(key).digest('hex')}`;
}

/**
 * Counts one attempt against `key` and says whether it may go ahead. A fixed window: the first attempt opens a window
 * of `rule.windowSec` seconds, `rule.max` attempts fit in it, and the count starts again once it has passed. Refused
 * attempts are counted but do not move the end of the window, so retrying never extends a lock-out.
 *
 * Two statements, each atomic on its own, and neither can lose a count:
 *
 * 1. `updateMany ... WHERE key AND windowStart <= cutoff SET windowStart = now, count = 0` restarts an ended window.
 *    Postgres re-evaluates the `WHERE` against the row's latest committed version once it holds the row lock, so when
 *    several requests find the window ended, the first restarts it and the rest, now seeing a new `windowStart`,
 *    match nothing. The restart happens once, and it only ever zeroes a window that was over.
 * 2. `upsert` issues one native `INSERT ... ON CONFLICT (key) DO UPDATE SET count = count + 1 RETURNING *`. The
 *    increment is computed by the database from the row it has locked, not from a value this process read, so two
 *    simultaneous requests get counts n and n+1 and never n and n. The row it returns is the one this request's own
 *    increment produced, so the decision below uses the count this request was given, not a later re-read. If the row
 *    does not exist yet, the requests that race to create it meet at the unique key: one inserts (count 1), the
 *    others take the conflict branch and increment.
 *
 * A request cannot add to a window that is then restarted underneath it: its own restart check (1) runs before its
 * increment (2), and a later restart needs `windowStart` to be a full window old. Exactly `max` of any number of
 * simultaneous requests in one window are allowed. If the process dies between (1) and (2) the row holds count 0
 * for a fresh window, which is harmless.
 *
 * `now` is a parameter so tests control the clock.
 */
export async function checkRateLimit(
  prisma: Pick<PrismaClient, 'authRateLimit'>,
  key: string,
  rule: RateRule,
  now: Date,
): Promise<RateVerdict> {
  const id = storedKey(key);
  const cutoff = new Date(now.getTime() - rule.windowSec * 1000);

  await prisma.authRateLimit.updateMany({
    where: { key: id, windowStart: { lte: cutoff } },
    data: { windowStart: now, count: 0 },
  });
  const row = await prisma.authRateLimit.upsert({
    where: { key: id },
    create: { key: id, windowStart: now, count: 1 },
    update: { count: { increment: 1 } },
  });

  if (row.count <= rule.max) return { allowed: true };
  const endsAt = row.windowStart.getTime() + rule.windowSec * 1000;
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((endsAt - now.getTime()) / 1000)) };
}
