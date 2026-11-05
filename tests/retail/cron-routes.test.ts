import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bumpRetailState } from '@/server/retail/outbox';
import { prisma, resetWorld, useTestDatabase } from '../pharmacy/fixture';
import { coreProvisionInput, verifyRequest } from './contract-oracle';
import { linkOf, outboxOf, retailPlan, retailShop } from './world';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const SECRET = 'a-cron-secret-of-more-than-thirty-two-characters';
const SYNC = 'the-sync-secret-shared-with-retails';

const ROUTES = {
  sync: () => import('@/app/api/cron/retail-sync/route'),
  reconcile: () => import('@/app/api/cron/retail-reconcile/route'),
};
type Name = keyof typeof ROUTES;

const call = async (name: Name, authorization?: string) => {
  const { GET } = await ROUTES[name]();
  return GET(new Request(`http://localhost/api/cron/retail-${name}`, { headers: authorization ? { authorization } : {} }));
};

function enableRetail() {
  vi.stubEnv('RETAIL_URL', 'https://retail.test');
  vi.stubEnv('RETAIL_SYNC_SECRET', SYNC);
  vi.stubEnv('RETAIL_CALLER_SECRET', 'the-caller-secret-shared-with-retails');
  vi.stubEnv('RETAIL_HANDOFF_SECRET', 'the-handoff-secret-shared-with-retails');
}

beforeAll(() => useTestDatabase());
afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(async () => {
  await resetWorld();
  vi.stubEnv('RETAIL_URL', '');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.stubEnv('CRON_SECRET', '');
  vi.stubEnv('RETAIL_URL', '');
});

describe.each(['sync', 'reconcile'] as const)('the retail-%s cron', (name) => {
  it('503 without CRON_SECRET', async () => {
    vi.stubEnv('CRON_SECRET', '');
    enableRetail();
    const response = await call(name, `Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('401 on a wrong bearer', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    enableRetail();
    expect((await call(name)).status).toBe(401);
    expect((await call(name, 'Bearer a-wrong-secret-of-more-than-thirty-two-characters')).status).toBe(401);
    expect((await call(name, SECRET)).status).toBe(401);
  });

  it('disabled without RETAIL_URL', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await retailPlan();
    const shop = await retailShop('Dormant');
    await prisma().$transaction((tx) => bumpRetailState(tx, shop.id));
    const response = await call(name, `Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ disabled: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(await outboxOf(shop.id)).toMatchObject({ dueVersion: 1, leasedUntil: null, lastAttemptAt: null });
  });

  it('answers 500 with a generic body when the run fails', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    enableRetail();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error(`connection refused ${SYNC}`);
    if (name === 'sync') vi.spyOn(await import('@/server/retail/sender'), 'runSender').mockRejectedValueOnce(failure);
    else vi.spyOn(await import('@/server/retail/reconcile'), 'runReconcile').mockRejectedValueOnce(failure);
    const response = await call(name, `Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(Object.keys(await response.json())).toEqual(['error']);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]![0])).not.toContain(SYNC);
  });

  it('gives itself a minute', async () => {
    expect((await ROUTES[name]()).maxDuration).toBe(60);
  });
});

describe('the retail crons with Retails configured', () => {
  it('runs and returns counts', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    enableRetail();
    await retailPlan();
    const shop = await retailShop('Live');
    await prisma().$transaction((tx) => bumpRetailState(tx, shop.id));
    const requests: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, init });
        if (init.method === 'POST') return Response.json({ businessId: 'rt-live' });
        return Response.json({ version: 1, status: 'ACTIVE', aiUsageMonth: { month: '2026-11', units: 4 } });
      }),
    );

    // The bump is stamped with the real clock: let it fall due.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const sync = await call('sync', `Bearer ${SECRET}`);
    expect(sync.status).toBe(200);
    expect(await sync.json()).toEqual({ sent: 1, waiting: 0, retried: 0, failed: 0 });
    expect(await outboxOf(shop.id)).toBeNull();

    const reconcile = await call('reconcile', `Bearer ${SECRET}`);
    expect(reconcile.status).toBe(200);
    expect(await reconcile.json()).toEqual({ checked: 1, drifted: 0, errors: 0 });
    expect(await linkOf(shop.id)).toMatchObject({ retailBusinessId: 'rt-live', remoteVersion: 1, aiUsageHalfUnits: 4, remoteStatus: 'ACTIVE' });

    expect(requests.map(({ url, init }) => `${init.method} ${url}`)).toEqual([
      'POST https://retail.test/api/core/v1/provision',
      `GET https://retail.test/api/core/v1/state?coreBusinessId=${encodeURIComponent(shop.id)}`,
    ]);
    for (const { url, init } of requests) {
      const target = new URL(url);
      const body = init.body === undefined ? '' : String(init.body);
      expect(verifyRequest({ method: String(init.method), path: target.pathname + target.search, body, headers: new Headers(init.headers) }, [SYNC])).toEqual({ ok: true });
    }
    expect(coreProvisionInput.safeParse(JSON.parse(String(requests[0]!.init.body))).success).toBe(true);
    expect(requests[1]!.init.body).toBeUndefined();
  });
});
