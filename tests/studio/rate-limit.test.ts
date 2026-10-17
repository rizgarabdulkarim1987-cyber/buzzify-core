import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { checkRateLimit, RATE_RULES } from '@/server/studio/auth/rate-limit';
import { resetTestData, testPrisma } from '../helpers/db';

const prisma = testPrisma();
const T0 = new Date('2026-03-01T10:00:00.000Z');
const after = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(async () => {
  await resetTestData(prisma);
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('checkRateLimit', () => {
  const rule = { max: 3, windowSec: 60 };

  it('allows up to max in a window, then refuses with a retry time, then resets', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect(await checkRateLimit(prisma, 'k', rule, after(i * 1000))).toEqual({ allowed: true });
    }
    // The window opened at T0 and closes at T0 + 60 s, however late in it the refusal comes.
    expect(await checkRateLimit(prisma, 'k', rule, after(3000))).toEqual({ allowed: false, retryAfterSec: 57 });
    expect(await checkRateLimit(prisma, 'k', rule, after(20_000))).toEqual({ allowed: false, retryAfterSec: 40 });
    expect(await checkRateLimit(prisma, 'k', rule, after(59_500))).toEqual({ allowed: false, retryAfterSec: 1 });

    // At the end of the window the count starts again.
    expect(await checkRateLimit(prisma, 'k', rule, after(60_000))).toEqual({ allowed: true });
    expect(await checkRateLimit(prisma, 'k', rule, after(60_001))).toEqual({ allowed: true });
    expect(await checkRateLimit(prisma, 'k', rule, after(60_002))).toEqual({ allowed: true });
    expect(await checkRateLimit(prisma, 'k', rule, after(60_003))).toEqual({ allowed: false, retryAfterSec: 60 });
  });

  it('does not extend the window when a refused attempt keeps trying', async () => {
    for (let i = 0; i < 3; i += 1) await checkRateLimit(prisma, 'k', rule, T0);
    for (let i = 0; i < 20; i += 1) {
      expect((await checkRateLimit(prisma, 'k', rule, after(30_000 + i))).allowed).toBe(false);
    }
    expect(await checkRateLimit(prisma, 'k', rule, after(60_000))).toEqual({ allowed: true });
  });

  it('keeps each key in its own window', async () => {
    for (let i = 0; i < 3; i += 1) await checkRateLimit(prisma, 'signin:email:a@example.com', rule, T0);
    expect((await checkRateLimit(prisma, 'signin:email:a@example.com', rule, T0)).allowed).toBe(false);
    expect(await checkRateLimit(prisma, 'signin:email:b@example.com', rule, T0)).toEqual({ allowed: true });
    expect(await checkRateLimit(prisma, 'signin:ip:a@example.com', rule, T0)).toEqual({ allowed: true });
  });

  it('applies the rule it is given, so a looser rule on the same key reads the same count', async () => {
    for (let i = 0; i < 3; i += 1) await checkRateLimit(prisma, 'k', rule, T0);
    expect((await checkRateLimit(prisma, 'k', { max: 3, windowSec: 60 }, T0)).allowed).toBe(false);
    expect((await checkRateLimit(prisma, 'k', { max: 10, windowSec: 60 }, T0)).allowed).toBe(true);
  });

  it('stores the window start exactly and the count of the current window', async () => {
    await checkRateLimit(prisma, 'k', rule, T0);
    await checkRateLimit(prisma, 'k', rule, after(5000));
    const row = await prisma.authRateLimit.findUniqueOrThrow({ where: { key: 'k' } });
    expect(row.windowStart.toISOString()).toBe(T0.toISOString());
    expect(row.count).toBe(2);
  });

  it('counts requests that arrive at the same moment exactly once each, so no more than max get through', async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => checkRateLimit(prisma, 'burst', { max: 7, windowSec: 60 }, T0)));
    expect(results.filter((r) => r.allowed)).toHaveLength(7);
    expect(results.filter((r) => !r.allowed)).toHaveLength(23);
    expect((await prisma.authRateLimit.findUniqueOrThrow({ where: { key: 'burst' } })).count).toBe(30);
  });

  it('opens one new window, not several, when concurrent requests arrive after the old one ended', async () => {
    const burst = { max: 7, windowSec: 60 };
    for (let i = 0; i < 7; i += 1) await checkRateLimit(prisma, 'burst', burst, T0);
    const results = await Promise.all(Array.from({ length: 30 }, () => checkRateLimit(prisma, 'burst', burst, after(61_000))));
    expect(results.filter((r) => r.allowed)).toHaveLength(7);
    const row = await prisma.authRateLimit.findUniqueOrThrow({ where: { key: 'burst' } });
    expect(row.windowStart.toISOString()).toBe(after(61_000).toISOString());
    expect(row.count).toBe(30);
  });

  it('accepts a key of any length, as sign-in input is chosen by the caller of the page', async () => {
    const long = `signin:email:${'a'.repeat(5000)}@example.com`;
    expect(await checkRateLimit(prisma, long, rule, T0)).toEqual({ allowed: true });
    expect(await checkRateLimit(prisma, long, rule, T0)).toEqual({ allowed: true });
    expect(await checkRateLimit(prisma, `${long}x`, rule, T0)).toEqual({ allowed: true });
    expect(await prisma.authRateLimit.count()).toBe(2);
  });
});

describe('RATE_RULES', () => {
  it('has the Studio rules', () => {
    expect(RATE_RULES).toEqual({
      'signin:ip': { max: 20, windowSec: 600 },
      'signin:email': { max: 5, windowSec: 600 },
      'totp:user': { max: 5, windowSec: 300 },
      'reset:email': { max: 3, windowSec: 3600 },
      'reset:ip': { max: 20, windowSec: 3600 },
      'reauth:user': { max: 10, windowSec: 600 },
      'invite:ip': { max: 20, windowSec: 3600 },
      'invite:token': { max: 10, windowSec: 3600 },
    });
  });
});
