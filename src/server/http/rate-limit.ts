import type { PrismaClient } from '@/generated/prisma/client';
import { checkRateLimit } from '@/server/studio/auth/rate-limit';

export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Sliding-window limiter held in process memory, so it is per server instance. `admitRequest` uses it as the cheap
 * first gate in front of the shared count.
 */
export function createRateLimiter(options: { limit: number; windowMs: number }) {
  const hits = new Map<string, number[]>();

  return {
    check(key: string, nowMs: number): RateLimitVerdict {
      const cutoff = nowMs - options.windowMs;
      const recent = (hits.get(key) ?? []).filter((time) => time > cutoff);
      if (recent.length >= options.limit) {
        hits.set(key, recent);
        return { allowed: false, retryAfterMs: Math.max(0, (recent[0] as number) + options.windowMs - nowMs) };
      }
      recent.push(nowMs);
      hits.set(key, recent);
      if (hits.size > 5000) {
        for (const [candidate, times] of hits) {
          if ((times[times.length - 1] ?? 0) <= cutoff) hits.delete(candidate);
        }
      }
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}

/** Shared counts of the public API live beside the Studio's, under this prefix, so they can be pruned on their own. */
export const PUBLIC_KEY_PREFIX = 'api:';

/**
 * Whether one request to the public API may go ahead, under a limit that holds across every server instance. The local
 * limiter answers first: a client it refuses is over the limit everywhere, and refusing it costs no database round
 * trip. A request it lets through is counted in the database (`checkRateLimit`, a fixed window shared by all
 * instances), and the shared verdict decides. If the count cannot be read the local verdict stands: guests keep their
 * menu when the counter fails, and each instance still limits on its own.
 */
export async function admitRequest(
  prisma: Pick<PrismaClient, 'authRateLimit'>,
  local: ReturnType<typeof createRateLimiter>,
  key: string,
  rule: { limit: number; windowMs: number },
  now: Date,
): Promise<RateLimitVerdict> {
  const verdict = local.check(key, now.getTime());
  if (!verdict.allowed) return verdict;
  try {
    const shared = await checkRateLimit(
      prisma,
      `${PUBLIC_KEY_PREFIX}${key}`,
      { max: rule.limit, windowSec: Math.ceil(rule.windowMs / 1000) },
      now,
    );
    return shared.allowed ? verdict : { allowed: false, retryAfterMs: shared.retryAfterSec * 1000 };
  } catch (error) {
    console.error('Public API rate limit: the shared count failed, using this instance only', error);
    return verdict;
  }
}

/**
 * Deletes the public API's shared counts whose window opened before `before`. A count lives on after its window ends
 * (the next request restarts it), so without this every address that ever called the API would keep a row.
 */
export async function prunePublicRateLimits(prisma: Pick<PrismaClient, 'authRateLimit'>, before: Date): Promise<number> {
  const { count } = await prisma.authRateLimit.deleteMany({
    where: { key: { startsWith: PUBLIC_KEY_PREFIX }, windowStart: { lt: before } },
  });
  return count;
}
