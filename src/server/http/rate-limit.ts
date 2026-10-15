export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Sliding-window limiter held in process memory. It is per server instance;
 * a shared store replaces it in the Phase 7 hardening work.
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
