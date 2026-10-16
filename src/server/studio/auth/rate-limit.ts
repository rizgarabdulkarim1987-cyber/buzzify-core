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
 * but it sees only requests that arrive over HTTP; the Studio's Server Actions call `auth.api` directly and are
 * limited here.
 */
export const RATE_RULES = {
  'signin:ip': { max: 20, windowSec: 600 },
  'signin:email': { max: 5, windowSec: 600 },
  'totp:user': { max: 5, windowSec: 300 },
  'reset:email': { max: 3, windowSec: 3600 },
  'invite:ip': { max: 20, windowSec: 3600 },
} as const satisfies Record<string, RateRule>;

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
 * Every check is one SQL statement, `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, so concurrent checks cannot
 * lose a count. Two requests for the same key in the same window meet at the row: the second waits for the first
 * one's row lock, then re-evaluates its update against the row the first left behind and counts on top of it, so the
 * counts are 1, 2 (never 1, 1), and exactly `max` of any number of simultaneous requests are allowed. When the old
 * window has ended, the `CASE` that restarts it is evaluated against the row as it stands once the lock is held: the
 * first request restarts the window (count 1), and the second finds a fresh window and adds to it, so the restart is
 * counted once and never twice. There is no read-then-write for another request to slip between.
 *
 * `now` is a parameter so tests control the clock. The driver adapter sends a `Date` as a UTC wall-clock string and the
 * column is `timestamp(3)` without a zone, so the cast to `timestamp` stores UTC whatever time zone the server runs in,
 * exactly as Prisma's own writes do.
 */
export async function checkRateLimit(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  key: string,
  rule: RateRule,
  now: Date,
): Promise<RateVerdict> {
  const cutoff = new Date(now.getTime() - rule.windowSec * 1000);
  // Raw SQL is banned for tenant data (see eslint.config.mjs); AuthRateLimit is a global table with no tenant, and an
  // atomic conditional restart of the window cannot be written with the query builder.
  // eslint-disable-next-line no-restricted-properties
  const rows = await prisma.$queryRaw<Array<{ windowStart: Date; count: number }>>`
    INSERT INTO "AuthRateLimit" AS r ("key", "windowStart", "count")
    VALUES (${storedKey(key)}, ${now}::timestamp, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "windowStart" = CASE WHEN r."windowStart" <= ${cutoff}::timestamp
                           THEN EXCLUDED."windowStart" ELSE r."windowStart" END,
      "count" = CASE WHEN r."windowStart" <= ${cutoff}::timestamp
                     THEN 1 ELSE r."count" + 1 END
    RETURNING "windowStart", "count"`;
  const row = rows[0];
  if (!row) throw new Error('Rate limit check returned no row');

  if (row.count <= rule.max) return { allowed: true };
  const endsAt = row.windowStart.getTime() + rule.windowSec * 1000;
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((endsAt - now.getTime()) / 1000)) };
}
