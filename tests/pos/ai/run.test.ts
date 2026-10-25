import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { baghdadMonthOf } from '@/lib/baghdad';
import { AiLimitReachedError, AiNotEnabledError, AiOutputRejectedError, AiTimeoutError, AiUnavailableError } from '@/server/ai/errors';
import { writeAiPackage } from '@/server/ai/package';
import { FakeProvider } from '@/server/ai/provider/fake';
import { setAiProviderForTests } from '@/server/ai/provider';
import { runAi } from '@/server/ai/run';
import { getAiUsage, releaseAiRequest, reserveAiRequest } from '@/server/ai/usage';
import { prisma, resetWorld, restaurant, useTestDatabase } from '../fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const NOW = new Date('2026-10-25T09:00:00Z');

let a: { id: string };
let b: { id: string };
let fake: FakeProvider;
const env = (id: string) => ({ db: prisma(), restaurantId: id, staffId: 'staff-1' });
const say = (text: string) => ({ response: { content: [{ type: 'text' as const, text }] } });

beforeAll(() => useTestDatabase());

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Run A');
  b = await restaurant('Run B');
  fake = new FakeProvider();
  setAiProviderForTests(fake);
});

afterEach(() => setAiProviderForTests(undefined));

afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const usage = (id: string) => getAiUsage(prisma(), id, 0, NOW);

describe('the usage counter', () => {
  it('reserves up to the limit and refuses the next', async () => {
    await reserveAiRequest(prisma(), a.id, 2, NOW);
    await reserveAiRequest(prisma(), a.id, 2, NOW);
    await expect(reserveAiRequest(prisma(), a.id, 2, NOW)).rejects.toBeInstanceOf(AiLimitReachedError);
    expect((await usage(a.id)).used).toBe(2);
  });

  it('holds the limit under five concurrent reservations', async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => reserveAiRequest(prisma(), a.id, 2, NOW)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect((await usage(a.id)).used).toBe(2);
  });

  it('starts a new Baghdad month at zero, counts per restaurant, and never releases below zero', async () => {
    await reserveAiRequest(prisma(), a.id, 5, new Date('2026-10-31T20:00:00Z'));
    await reserveAiRequest(prisma(), a.id, 5, new Date('2026-10-31T21:30:00Z'));
    expect((await prisma().posAiUsageMonth.findMany({ where: { restaurantId: a.id }, orderBy: { month: 'asc' } })).map((r) => [r.month, r.requests])).toEqual([
      ['2026-10', 1],
      ['2026-11', 1],
    ]);
    await reserveAiRequest(prisma(), b.id, 5, NOW);
    expect((await usage(a.id)).used).toBe(1);
    expect((await usage(b.id)).used).toBe(1);
    const month = baghdadMonthOf(NOW);
    await releaseAiRequest(prisma(), b.id, month);
    await releaseAiRequest(prisma(), b.id, month);
    expect((await usage(b.id)).used).toBe(0);
    expect((await usage(a.id)).used).toBe(1);
  });
});

describe('runAi', () => {
  it('refuses with the package off: no provider call, no usage row, no call row', async () => {
    await expect(runAi(env(a.id), { feature: 'ASK', now: NOW, work: async () => 1 })).rejects.toBeInstanceOf(AiNotEnabledError);
    expect(fake.calls).toHaveLength(0);
    expect(await prisma().posAiUsageMonth.count()).toBe(0);
    expect(await prisma().posAiCall.count()).toBe(0);
  });

  it('is unavailable without a provider and reserves nothing', async () => {
    await writeAiPackage(prisma(), a.id, { enabled: true, monthlyLimit: 5 });
    setAiProviderForTests(null);
    await expect(runAi(env(a.id), { feature: 'ASK', now: NOW, work: async () => 1 })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(await prisma().posAiUsageMonth.count()).toBe(0);
  });

  it('writes one OK row with model and tokens and adds the tokens to the month', async () => {
    await writeAiPackage(prisma(), a.id, { enabled: true, monthlyLimit: 5 });
    fake.enqueue(say('hello'));
    const out = await runAi(env(a.id), {
      feature: 'ASK',
      now: NOW,
      work: async (call) => (await call({ purpose: 'phrase', system: 'x\nAnswer in: en', messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }], maxTokens: 10 })).content,
    });
    expect(out).toEqual([{ type: 'text', text: 'hello' }]);
    const rows = await prisma().posAiCall.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ restaurantId: a.id, staffId: 'staff-1', feature: 'ASK', status: 'OK', model: 'fake' });
    expect(rows[0]!.inputTokens).toBeGreaterThan(0);
    const month = await prisma().posAiUsageMonth.findFirstOrThrow({ where: { restaurantId: a.id } });
    expect(month).toMatchObject({ requests: 1 });
    expect(month.inputTokens).toBe(rows[0]!.inputTokens);
  });

  it('gives the reservation back when the provider never answers', async () => {
    await writeAiPackage(prisma(), a.id, { enabled: true, monthlyLimit: 5 });
    fake.enqueue('timeout');
    await expect(
      runAi(env(a.id), { feature: 'SUMMARY', now: NOW, work: (call) => call({ purpose: 'phrase', system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }], maxTokens: 10 }) }),
    ).rejects.toBeInstanceOf(AiTimeoutError);
    expect((await prisma().posAiCall.findFirstOrThrow()).status).toBe('TIMEOUT');
    expect((await usage(a.id)).used).toBe(0);
  });

  it('still counts a request whose answer the work rejects', async () => {
    await writeAiPackage(prisma(), a.id, { enabled: true, monthlyLimit: 5 });
    fake.enqueue(say('987654'));
    await expect(
      runAi(env(a.id), {
        feature: 'ASK',
        now: NOW,
        work: async (call) => {
          await call({ purpose: 'phrase', system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }], maxTokens: 10 });
          throw new AiOutputRejectedError();
        },
      }),
    ).rejects.toBeInstanceOf(AiOutputRejectedError);
    expect((await prisma().posAiCall.findFirstOrThrow()).status).toBe('REJECTED_OUTPUT');
    expect((await usage(a.id)).used).toBe(1);
  });

  it('never stores the question in the call row', async () => {
    await writeAiPackage(prisma(), a.id, { enabled: true, monthlyLimit: 5 });
    await runAi(env(a.id), { feature: 'ASK', now: NOW, work: (call) => call({ purpose: 'phrase', system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'SECRET-QUESTION-TEXT' }] }], maxTokens: 10 }) });
    expect(JSON.stringify(await prisma().posAiCall.findMany())).not.toContain('SECRET-QUESTION-TEXT');
  });

  it('answers the limit before calling the provider', async () => {
    await writeAiPackage(prisma(), a.id, { enabled: true, monthlyLimit: 0 });
    await expect(runAi(env(a.id), { feature: 'ASK', now: NOW, work: async () => 1 })).rejects.toBeInstanceOf(AiLimitReachedError);
    expect(fake.calls).toHaveLength(0);
  });
});
