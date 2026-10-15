import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '@/server/http/rate-limit';

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
