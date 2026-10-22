import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCronEnv } from '@/server/env';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { seedApplications } from '../../prisma/seed/applications';
import { resetTestData, testPrisma } from '../helpers/db';

// Lets one test make a single subscription's update throw, as a row the database refuses would.
const sabotage = vi.hoisted(() => ({ id: null as string | null }));
vi.mock('@/server/data/tenant-db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/data/tenant-db')>();
  return {
    ...original,
    globalDb: (prisma: Parameters<typeof original.globalDb>[0]) => {
      const db = original.globalDb(prisma);
      return new Proxy(db, {
        get(target, key, receiver) {
          if (key !== '$transaction') return Reflect.get(target, key, receiver);
          return (fn: (tx: never) => Promise<unknown>) =>
            target.$transaction(async (tx) => {
              const subscription = new Proxy(tx.subscription, {
                get(model, name, r) {
                  if (name === 'updateMany') {
                    return (args: { where: { id: string } }) => {
                      if (args.where.id === sabotage.id) throw new Error('the database refused this row');
                      return (model.updateMany as (a: unknown) => unknown)(args);
                    };
                  }
                  return Reflect.get(model, name, r);
                },
              });
              return fn(new Proxy(tx, { get: (t, k, r) => (k === 'subscription' ? subscription : Reflect.get(t, k, r)) }) as never);
            });
        },
      });
    },
  };
});

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();
const SECRET = 'a-cron-secret-of-more-than-thirty-two-characters';
const DAY = 86_400_000;

const call = async (authorization?: string) => {
  const { GET } = await import('@/app/api/cron/subscriptions/route');
  return GET(new Request('http://localhost/api/cron/subscriptions', { headers: authorization ? { authorization } : {} }));
};

async function subscribe(name: string, overrides: Record<string, unknown>) {
  const restaurant = await prisma.restaurant.create({ data: { name } });
  return prisma.subscription.create({
    data: {
      restaurantId: restaurant.id,
      applicationId: 'menu',
      planCode: 'PRO',
      period: 'MONTHLY',
      currency: 'IQD',
      priceMinor: 25000,
      currentPeriodStart: new Date(Date.now() - 31 * DAY),
      currentPeriodEnd: new Date(Date.now() - 3600_000),
      version: 1,
      status: 'ACTIVE',
      ...overrides,
    },
  });
}

const statusOf = async (id: string) => (await prisma.subscription.findUniqueOrThrow({ where: { id } })).status;

beforeEach(async () => {
  sabotage.id = null;
  await resetTestData(prisma);
  await seedApplications(prisma);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('parseCronEnv', () => {
  it('treats an unset or empty secret as none, and refuses a short one', () => {
    expect(parseCronEnv({})).toEqual({ secret: null });
    expect(parseCronEnv({ CRON_SECRET: '  ' })).toEqual({ secret: null });
    expect(parseCronEnv({ CRON_SECRET: SECRET })).toEqual({ secret: SECRET });
    expect(() => parseCronEnv({ CRON_SECRET: 'short' })).toThrow(/at least 32/);
  });
});

describe('the subscriptions cron', () => {
  it('answers 503 when no secret is configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 401 without the secret or with a wrong one', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    expect((await call()).status).toBe(401);
    expect((await call('Bearer a-wrong-secret-of-more-than-thirty-two-characters')).status).toBe(401);
    expect((await call(SECRET)).status).toBe(401);
  });

  it('sweeps the lifecycle with the right secret, writing a system event per step', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    // Ended an hour ago: enters grace. Ended 30 days ago: past its 7 grace days, so it passes through grace to expiry.
    const graced = await subscribe('Graced', {});
    const expired = await subscribe('Expired', { currentPeriodEnd: new Date(Date.now() - 30 * DAY) });
    const trial = await subscribe('Trial', { status: 'TRIAL', trialEndsAt: new Date(Date.now() - 3600_000) });
    const fresh = await subscribe('Fresh', { currentPeriodEnd: new Date(Date.now() + 10 * DAY) });

    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ graced: 1, expired: 2, failed: 0 });
    expect(await statusOf(graced.id)).toBe('GRACE');
    expect(await statusOf(expired.id)).toBe('EXPIRED');
    expect(await statusOf(trial.id)).toBe('EXPIRED');
    expect(await statusOf(fresh.id)).toBe('ACTIVE');

    const events = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: expired.id }, orderBy: { id: 'asc' } });
    expect(events.map((e) => [e.type, e.fromStatus, e.toStatus, e.actorId])).toEqual([
      ['ENTERED_GRACE', 'ACTIVE', 'GRACE', null],
      ['EXPIRED', 'GRACE', 'EXPIRED', null],
    ]);
    expect(await prisma.subscriptionEvent.count({ where: { subscriptionId: fresh.id } })).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: graced.id } })).version).toBe(2);

    // A second run finds nothing left to do.
    expect(await (await call(`Bearer ${SECRET}`)).json()).toEqual({ graced: 0, expired: 0, failed: 0 });
  });

  it('counts one failing row as failed and still sweeps the others', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    const bad = await subscribe('Bad', { currentPeriodEnd: new Date(Date.now() - 2 * 3600_000) });
    const good = await subscribe('Good', {});
    const other = await subscribe('Other', { currentPeriodEnd: new Date(Date.now() - 30 * DAY) });
    sabotage.id = bad.id;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await call(`Bearer ${SECRET}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ graced: 1, expired: 1, failed: 1 });
      expect(await statusOf(bad.id)).toBe('ACTIVE');
      expect(await statusOf(good.id)).toBe('GRACE');
      expect(await statusOf(other.id)).toBe('EXPIRED');
      expect(await prisma.subscriptionEvent.count({ where: { subscriptionId: bad.id } })).toBe(0);
      expect(errors.mock.calls.some((c) => String(c[0]).includes(bad.id))).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });

  it('skips, and does not fail, a row an owner changed after it was read', async () => {
    const { sweepOne } = await import('@/server/studio/services/billing-sweep');
    const sub = await subscribe('Raced', {});
    // The sweep read version 1; a payment lands before its update.
    await prisma.subscription.update({ where: { id: sub.id }, data: { version: 2, currentPeriodEnd: new Date(Date.now() + 30 * DAY) } });
    expect(await sweepOne(prisma, sub, new Date())).toBeNull();
    expect(await statusOf(sub.id)).toBe('ACTIVE');
    expect(await prisma.subscriptionEvent.count({ where: { subscriptionId: sub.id } })).toBe(0);
  });

  it('answers 500 with a JSON error, logged once, when the sweep cannot read its candidates', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    const sweep = await import('@/server/studio/services/billing-sweep');
    const probe = vi.spyOn(sweep, 'sweepSubscriptions').mockRejectedValueOnce(new Error('connection refused'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await call(`Bearer ${SECRET}`);
      expect(response.status).toBe(500);
      expect(response.headers.get('content-type')).toMatch(/json/);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ error: 'The subscription sweep failed' });
      expect(errors).toHaveBeenCalledTimes(1);
    } finally {
      probe.mockRestore();
      errors.mockRestore();
    }
  });

  it('keeps 200 with the counts, and logs one summary line, when only some rows failed', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    const sweep = await import('@/server/studio/services/billing-sweep');
    const probe = vi.spyOn(sweep, 'sweepSubscriptions').mockResolvedValueOnce({ graced: 1, expired: 0, failed: 2 });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await call(`Bearer ${SECRET}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ graced: 1, expired: 0, failed: 2 });
      expect(errors).toHaveBeenCalledTimes(1);
      expect(String(errors.mock.calls[0][0])).toMatch(/2 .*failed/i);
    } finally {
      probe.mockRestore();
      errors.mockRestore();
    }
  });

  it('gives itself a minute', async () => {
    expect((await import('@/app/api/cron/subscriptions/route')).maxDuration).toBe(60);
  });
});
