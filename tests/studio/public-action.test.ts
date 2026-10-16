import { headers } from 'next/headers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { getPrisma } from '@/server/data/prisma';
import { invokePublic } from '@/server/studio/framework/invoke';
import { definePublicAction, runPublicAction } from '@/server/studio/framework/public';
import { StudioError } from '@/server/studio/framework/result';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData, testPrisma } from '../helpers/db';

// `invokePublic` reads the request through `headers()`, which only exists inside Next. The test stands in for it.
vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const prisma = testPrisma();
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const META = { ip: '203.0.113.7', userAgent: 'vitest', headers: new Headers({ cookie: 'a=b' }) };
const RULE = { max: 2, windowSec: 600 } as const;

const echo = definePublicAction({
  name: 'test.public.echo',
  input: z.object({ word: z.string().min(1) }),
  run: async (ctx, input) => ({ word: input.word, ip: ctx.ip, userAgent: ctx.userAgent, cookie: ctx.headers.get('cookie') }),
});

const limited = definePublicAction({
  name: 'test.public.limited',
  input: z.object({ who: z.string().min(1) }),
  rateLimit: (input, ctx) => [
    { key: `test:who:${input.who}`, rule: RULE },
    { key: `test:ip:${ctx.ip}`, rule: { max: 100, windowSec: 600 } },
  ],
  run: async () => ({ done: true }),
});

beforeAll(async () => {
  requireTestDb();
  await resetTestData(prisma);
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('definePublicAction', () => {
  it('refuses a definition without a name, a Zod input or a run function', () => {
    expect(() => definePublicAction({ name: '', input: z.object({}), run: async () => 1 })).toThrow(/needs a name/);
    expect(() => definePublicAction({ name: 'x', input: {} as never, run: async () => 1 })).toThrow(/Zod input/);
    expect(() => definePublicAction({ name: 'x', input: z.object({}), run: undefined as never })).toThrow(/run function/);
  });

  it('is marked as public, so an action definition cannot be run as one', async () => {
    expect(echo.kind).toBe('public');
    const asAction = { ...echo, kind: 'action' } as never;
    expect(await runPublicAction(prisma, asAction, { word: 'x' }, META)).toMatchObject({ ok: false, error: { code: 'INVALID' } });
  });
});

describe('runPublicAction', () => {
  it('runs without an actor and hands the handler the address, the browser and the headers', async () => {
    expect(await runPublicAction(prisma, echo, { word: 'hi' }, META)).toEqual({
      ok: true,
      data: { word: 'hi', ip: '203.0.113.7', userAgent: 'vitest', cookie: 'a=b' },
    });
  });

  it('caps a long address and browser string, as for actions', async () => {
    const result = await runPublicAction(prisma, echo, { word: 'hi' }, { ...META, ip: 'i'.repeat(100), userAgent: 'u'.repeat(900) });
    expect(result.ok && [result.data.ip.length, result.data.userAgent.length]).toEqual([64, 512]);
  });

  it('reports input that fails the schema as INVALID with its fields, and does not run the handler', async () => {
    const result = await runPublicAction(prisma, limited, { who: '' }, META);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { who: expect.any(String) } } });
    expect(await prisma.authRateLimit.count()).toBe(0);
  });

  it('returns a StudioError the handler throws as its result', async () => {
    const refuses = definePublicAction({
      name: 'test.public.refuses',
      input: z.object({}),
      run: async () => {
        throw new StudioError('CONFLICT', 'Already done', { why: 'because' });
      },
    });
    expect(await runPublicAction(prisma, refuses, {}, META)).toEqual({
      ok: false,
      error: { code: 'CONFLICT', message: 'Already done', fields: { why: 'because' } },
    });
  });

  it('answers any other error with a generic INVALID and logs the action name, never the input', async () => {
    const breaks = definePublicAction({
      name: 'test.public.breaks',
      input: z.object({ secret: z.string() }),
      run: async () => {
        throw new Error('disk on fire');
      },
    });
    const result = await runPublicAction(prisma, breaks, { secret: 'hunter2-hunter2' }, META);
    expect(result).toEqual({ ok: false, error: { code: 'INVALID', message: 'Something went wrong' } });
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join('\n');
    expect(logged).toContain('test.public.breaks');
    expect(logged).not.toContain('hunter2');
  });

  describe('rate limits', () => {
    it('counts every check on every call, and refuses once any of them is over', async () => {
      const results = [];
      for (let i = 0; i < 3; i += 1) results.push(await runPublicAction(prisma, limited, { who: 'ann' }, META));
      expect(results.map((r) => (r.ok ? 'OK' : r.error.code))).toEqual(['OK', 'OK', 'RATE_LIMITED']);

      const refused = results[2];
      expect(refused && !refused.ok && refused.error.fields?.retryAfterSec).toMatch(/^\d+$/);
      // The attempt that was refused still counted against the other limit.
      const [byWho, byIp] = await Promise.all([
        prisma.authRateLimit.findUniqueOrThrow({ where: { key: 'test:who:ann' } }),
        prisma.authRateLimit.findUniqueOrThrow({ where: { key: 'test:ip:203.0.113.7' } }),
      ]);
      expect([byWho.count, byIp.count]).toEqual([3, 3]);
    });

    it('keeps one subject apart from another', async () => {
      await runPublicAction(prisma, limited, { who: 'bo' }, META);
      await runPublicAction(prisma, limited, { who: 'bo' }, META);
      expect(await runPublicAction(prisma, limited, { who: 'cy' }, META)).toMatchObject({ ok: true });
    });

    it('does not run the handler once refused', async () => {
      const run = vi.fn(async () => 1);
      const guarded = definePublicAction({
        name: 'test.public.guarded',
        input: z.object({}),
        rateLimit: () => [{ key: 'test:guarded', rule: { max: 1, windowSec: 600 } }],
        run,
      });
      await runPublicAction(prisma, guarded, {}, META);
      await runPublicAction(prisma, guarded, {}, META);
      expect(run).toHaveBeenCalledTimes(1);
    });
  });

  describe('audit', () => {
    it('writes a row for a person who is not signed in, with the request address and browser and no secrets', async () => {
      await prisma.user.create({ data: { id: 'user-1', name: 'Una', email: 'una@example.com' } });
      const audited = definePublicAction({
        name: 'test.public.audited',
        input: z.object({}),
        run: async (ctx) => ctx.audit('user-1', { action: 'account.test', entityType: 'User', entityId: 'user-1' }),
      });
      await runPublicAction(prisma, audited, {}, META);
      expect(await prisma.auditLog.findFirstOrThrow()).toMatchObject({
        actorId: 'user-1',
        action: 'account.test',
        entityType: 'User',
        entityId: 'user-1',
        ip: '203.0.113.7',
        userAgent: 'vitest',
        restaurantId: null,
        menuId: null,
      });
    });
  });
});

describe('invokePublic', () => {
  beforeAll(() => {
    vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  });

  afterAll(async () => {
    await getPrisma().$disconnect();
    delete globalForPrisma.__prisma;
    vi.unstubAllEnvs();
  });

  it('runs the action for the current request: its address, its browser and its headers', async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers({ 'x-forwarded-for': '198.51.100.4, 10.0.0.1', 'user-agent': 'Mozilla/5.0 (test)', cookie: 'k=v' }) as never,
    );
    expect(await invokePublic(echo, { word: 'yes' })).toEqual({
      ok: true,
      data: { word: 'yes', ip: '198.51.100.4', userAgent: 'Mozilla/5.0 (test)', cookie: 'k=v' },
    });
  });

  it('takes its input as unknown from the browser and lets the schema read it', async () => {
    vi.mocked(headers).mockResolvedValue(new Headers() as never);
    expect(await invokePublic(echo, 'not an object')).toMatchObject({ ok: false, error: { code: 'INVALID' } });
    expect(await invokePublic(echo, undefined)).toMatchObject({ ok: false, error: { code: 'INVALID' } });
  });
});
