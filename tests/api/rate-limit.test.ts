import { describe, expect, it, vi } from 'vitest';
import { admitRequest, createRateLimiter } from '@/server/http/rate-limit';

describe('createRateLimiter', () => {
  it('allows up to the limit within the window, then blocks with a retry hint', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('a', 100).allowed).toBe(true);
    expect(limiter.check('a', 200).allowed).toBe(true);
    const blocked = limiter.check('a', 300);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(700);
  });

  it('frees capacity as old hits leave the window', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
    limiter.check('a', 0);
    limiter.check('a', 10);
    expect(limiter.check('a', 500).allowed).toBe(false);
    expect(limiter.check('a', 1001).allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('b', 0).allowed).toBe(true);
    expect(limiter.check('a', 1).allowed).toBe(false);
  });
});

describe('admitRequest', () => {
  const rule = { limit: 2, windowMs: 60_000 };
  const now = new Date('2026-10-22T12:00:00Z');

  /** A counter store that answers like the database: the count after this request's increment. */
  function store(counts = new Map<string, number>()) {
    return {
      authRateLimit: {
        updateMany: async () => ({ count: 0 }),
        upsert: async ({ where }: { where: { key: string } }) => {
          const count = (counts.get(where.key) ?? 0) + 1;
          counts.set(where.key, count);
          return { key: where.key, windowStart: now, count };
        },
      },
    } as unknown as Parameters<typeof admitRequest>[0];
  }

  it('refuses from the local limiter without asking the shared store', async () => {
    const local = createRateLimiter(rule);
    const shared = store();
    let asked = 0;
    const counting = {
      authRateLimit: { ...shared.authRateLimit, upsert: async (args: never) => (asked++, shared.authRateLimit.upsert(args)) },
    } as unknown as Parameters<typeof admitRequest>[0];
    await admitRequest(counting, local, 'k', rule, now);
    await admitRequest(counting, local, 'k', rule, now);
    const refused = await admitRequest(counting, local, 'k', rule, now);
    expect(refused).toEqual({ allowed: false, retryAfterMs: 60_000 });
    expect(asked).toBe(2);
  });

  it('refuses when the shared count is over the limit though this instance is not', async () => {
    const shared = store(new Map([['api:k', 2]]));
    const verdict = await admitRequest(shared, createRateLimiter(rule), 'k', rule, now);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterMs).toBe(60_000);
  });

  it('lets the request through on the local verdict when the shared store fails', async () => {
    const broken = {
      authRateLimit: {
        updateMany: async () => {
          throw new Error('connection refused');
        },
      },
    } as unknown as Parameters<typeof admitRequest>[0];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await admitRequest(broken, createRateLimiter(rule), 'k', rule, now)).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(errors).toHaveBeenCalledOnce();
    errors.mockRestore();
  });
});
