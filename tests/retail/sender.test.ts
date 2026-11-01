import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetailConfigError } from '@/server/retail/config';
import { createHttpRetailClient, type RetailClient } from '@/server/retail/client';
import { bumpRetailState, kickAfterCommit } from '@/server/retail/outbox';
import { claimDue, deliverOne, LEASE_MS, MAX_ATTEMPTS, nextDelayMs, runSender } from '@/server/retail/sender';
import { buildRetailState } from '@/server/retail/snapshot';
import * as retail from '@/server/studio/actions/retail';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { createPasswordUser } from '@/server/studio/auth/users';
import { runAction } from '@/server/studio/framework/action';
import { GOOD, pharmacy, prisma, resetWorld, useTestDatabase } from '../pharmacy/fixture';
import { coreProvisionInput, coreStateSchema, verifyRequest } from './contract-oracle';
import { fakeClient } from './fake-client';
import { linkOf, outboxOf, retailPlan, retailShop } from './world';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
// `after()` needs a request scope; the kick test stands in for it (by default it throws, as outside a request).
const scheduled = vi.hoisted(() => ({ tasks: [] as (() => unknown)[], mode: 'throw' as 'throw' | 'capture' }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn((task: () => unknown) => {
    if (scheduled.mode === 'throw') throw new Error('`after` was called outside a request scope');
    scheduled.tasks.push(task);
  }),
}));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const META = { ip: '203.0.113.7', userAgent: 'vitest' };
const MINUTE = 60_000;
const SYNC = 'the-sync-secret-shared-with-retails';
const CALLER = 'the-caller-secret-shared-with-retails';
const HANDOFF = 'the-handoff-secret-shared-with-retails';

/** The bump writes the real clock: the sender's clock runs a second ahead so a fresh row is due. */
const soon = (ms = 0) => new Date(Date.now() + 1000 + ms);
const bump = (restaurantId: string) => prisma().$transaction((tx) => bumpRetailState(tx, restaurantId));
const hashOf = async (restaurantId: string) => {
  const built = await prisma().$transaction((tx) => buildRetailState(tx, restaurantId));
  if (!built.ready) throw new Error('not ready');
  return built.hash;
};

async function readyShop(name: string, opts: Parameters<typeof retailShop>[1] = {}) {
  const shop = await retailShop(name, opts);
  await bump(shop.id);
  return shop;
}

/** Claims the row and delivers it: what one cron pass does for one business. */
async function deliver(client: RetailClient, restaurantId: string, now = soon()) {
  expect(await claimDue(prisma(), now, 10)).toContain(restaurantId);
  return deliverOne(prisma(), client, restaurantId, now);
}

function enableRetail() {
  vi.stubEnv('RETAIL_URL', 'https://retail.test');
  vi.stubEnv('RETAIL_SYNC_SECRET', SYNC);
  vi.stubEnv('RETAIL_CALLER_SECRET', CALLER);
  vi.stubEnv('RETAIL_HANDOFF_SECRET', HANDOFF);
}

beforeAll(() => useTestDatabase());
afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(async () => {
  scheduled.tasks = [];
  scheduled.mode = 'throw';
  await resetWorld();
  await retailPlan();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.stubEnv('RETAIL_URL', '');
});

describe('the sender', () => {
  it("first delivery provisions with a body Retails' coreProvisionInput accepts", async () => {
    const shop = await readyShop('First');
    const client = fakeClient();
    const now = soon();
    expect(await deliver(client, shop.id, now)).toBe('sent');

    expect(client.calls.map((call) => call.op)).toEqual(['provision']);
    const parsed = coreProvisionInput.safeParse(client.of('provision')[0]);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data!.coreBusinessId).toBe(shop.id);
    expect(parsed.data!.state.version).toBe(1);

    const link = await linkOf(shop.id);
    expect(link).toMatchObject({ retailBusinessId: `rt-${shop.id}`, acceptedVersion: 1, sentHash: await hashOf(shop.id) });
    expect(link.provisionedAt?.getTime()).toBe(now.getTime());
    expect(await outboxOf(shop.id)).toBeNull();
  });

  it('a ready shop still at version 0 is sent at version 1', async () => {
    const shop = await retailShop('Zero');
    // A row whose link never got its version (a link restored, or written by hand): the sender gives it version 1 first.
    await prisma().retailOutbox.create({ data: { restaurantId: shop.id, dueVersion: 1, nextAttemptAt: new Date() } });
    expect((await linkOf(shop.id)).stateVersion).toBe(0);
    const client = fakeClient();
    expect(await deliver(client, shop.id)).toBe('sent');
    expect(coreProvisionInput.safeParse(client.of('provision')[0]).success).toBe(true);
    expect((client.of('provision')[0] as { state: { version: number } }).state.version).toBe(1);
    expect(await linkOf(shop.id)).toMatchObject({ stateVersion: 1, acceptedVersion: 1 });
    expect(await outboxOf(shop.id)).toBeNull();
  });

  it('later deliveries push state', async () => {
    const shop = await readyShop('Later');
    const client = fakeClient();
    await deliver(client, shop.id);
    await prisma().retailLink.update({ where: { restaurantId: shop.id }, data: { aiIntake: true } });
    await bump(shop.id);
    expect(await deliver(client, shop.id)).toBe('sent');

    expect(client.calls.map((call) => call.op)).toEqual(['provision', 'pushState']);
    const parsed = coreStateSchema.safeParse(client.of('pushState')[0]);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data).toMatchObject({ coreBusinessId: shop.id, version: 2, aiIntake: true });
    expect(await linkOf(shop.id)).toMatchObject({ retailBusinessId: `rt-${shop.id}`, acceptedVersion: 2, sentHash: await hashOf(shop.id) });
    expect(await outboxOf(shop.id)).toBeNull();
  });

  it('two claims never return the same row', async () => {
    const ids: string[] = [];
    for (const name of ['A', 'B', 'C', 'D']) ids.push((await readyShop(`Claim ${name}`)).id);
    const now = soon();
    const [first, second] = await Promise.all([claimDue(prisma(), now, 10), claimDue(prisma(), now, 10)]);
    expect(first.filter((id) => second.includes(id))).toEqual([]);
    expect([...first, ...second].sort()).toEqual([...ids].sort());
    // A third claim finds every row leased.
    expect(await claimDue(prisma(), now, 10)).toEqual([]);
    const row = await outboxOf(ids[0]!);
    expect(row!.leasedUntil!.getTime()).toBe(now.getTime() + LEASE_MS);
    expect(row!.lastAttemptAt!.getTime()).toBe(now.getTime());
  });

  it('expired lease is reclaimed', async () => {
    const shop = await readyShop('Lease');
    const now = soon();
    expect(await claimDue(prisma(), now, 10)).toEqual([shop.id]);
    // The holder died mid-send: nobody else may take the row while its lease runs...
    expect(await claimDue(prisma(), new Date(now.getTime() + LEASE_MS - 1), 10)).toEqual([]);
    // ...and anyone may once it has run out.
    const later = new Date(now.getTime() + LEASE_MS + 1);
    expect(await claimDue(prisma(), later, 10)).toEqual([shop.id]);
    expect(await deliverOne(prisma(), fakeClient(), shop.id, later)).toBe('sent');
  });

  it('backoff schedule', async () => {
    const half = () => 0.5;
    expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map((n) => nextDelayMs(n, half))).toEqual([
      1, 2, 4, 8, 16, 32, 60, 60, 60,
    ].map((m) => m * MINUTE));
    // ±10 %.
    expect(nextDelayMs(1, () => 0)).toBe(0.9 * MINUTE);
    expect(nextDelayMs(1, () => 0.999999)).toBeLessThanOrEqual(1.1 * MINUTE);
    expect(nextDelayMs(1, () => 0.999999)).toBeGreaterThan(1.09 * MINUTE);
    expect(nextDelayMs(30, () => 0)).toBe(0.9 * 60 * MINUTE);

    const shop = await readyShop('Down');
    const client = fakeClient({ provision: () => ({ kind: 'retry', code: 'HTTP_503' }) });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let now = soon();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const outcome = await deliver(client, shop.id, now);
      const row = (await outboxOf(shop.id))!;
      expect(row.attempts).toBe(attempt);
      expect(row.lastError).toBe('HTTP_503');
      expect(row.leasedUntil).toBeNull();
      if (attempt < MAX_ATTEMPTS) {
        expect(outcome).toBe('retry');
        expect(row.failedAt).toBeNull();
        const expected = Math.min(2 ** (attempt - 1), 60) * MINUTE;
        const delay = row.nextAttemptAt.getTime() - now.getTime();
        expect(delay).toBeGreaterThanOrEqual(expected * 0.9);
        expect(delay).toBeLessThanOrEqual(expected * 1.1);
        // Not before it is due.
        expect(await claimDue(prisma(), new Date(row.nextAttemptAt.getTime() - 1), 10)).toEqual([]);
        now = row.nextAttemptAt;
      } else {
        expect(outcome).toBe('failed');
        expect(row.failedAt!.getTime()).toBe(now.getTime());
      }
    }
    expect(client.of('provision')).toHaveLength(MAX_ATTEMPTS);
    // A failed row is never claimed again, until a change bumps it.
    expect(await claimDue(prisma(), new Date(now.getTime() + 365 * 86_400_000), 10)).toEqual([]);
    await bump(shop.id);
    expect(await outboxOf(shop.id)).toMatchObject({ attempts: 0, failedAt: null });
  });

  it('permanent on 422 with its code', async () => {
    const shop = await readyShop('Refused');
    const client = fakeClient({ provision: () => ({ kind: 'permanent', code: 'PLAN_LIMIT' }) });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const now = soon();
    expect(await deliver(client, shop.id, now)).toBe('failed');
    const row = (await outboxOf(shop.id))!;
    expect(row).toMatchObject({ lastError: 'PLAN_LIMIT', attempts: 0, leasedUntil: null });
    expect(row.failedAt!.getTime()).toBe(now.getTime());
    expect(await claimDue(prisma(), new Date(now.getTime() + 86_400_000), 10)).toEqual([]);
    expect((await linkOf(shop.id)).retailBusinessId).toBeNull();
  });

  it('404 on state re-provisions', async () => {
    const shop = await readyShop('Restored');
    const client = fakeClient();
    await deliver(client, shop.id);
    // Retails lost the shop (restored from an older backup): the next push is a 404.
    client.answer('pushState', () => ({ kind: 'notFound' }));
    await bump(shop.id);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const now = soon();
    expect(await deliver(client, shop.id, now)).toBe('retry');
    expect((await linkOf(shop.id)).retailBusinessId).toBeNull();
    const row = (await outboxOf(shop.id))!;
    expect(row).toMatchObject({ attempts: 1, lastError: 'NOT_FOUND', failedAt: null });

    expect(await deliver(client, shop.id, row.nextAttemptAt)).toBe('sent');
    expect(client.calls.map((call) => call.op)).toEqual(['provision', 'pushState', 'provision']);
    expect(coreProvisionInput.safeParse(client.of('provision')[1]).success).toBe(true);
    expect(await linkOf(shop.id)).toMatchObject({ retailBusinessId: `rt-${shop.id}`, acceptedVersion: 2 });
    expect(await outboxOf(shop.id)).toBeNull();
  });

  it('a bump during delivery keeps the row for the newer version', async () => {
    const shop = await readyShop('Busy');
    const client = fakeClient();
    // A change commits while version 1 is on the wire.
    client.answer('provision', async (body) => {
      await bump(shop.id);
      return { kind: 'ok', body: { businessId: `rt-${(body as { coreBusinessId: string }).coreBusinessId}` } };
    });
    const now = soon();
    expect(await deliver(client, shop.id, now)).toBe('sent');
    expect(await linkOf(shop.id)).toMatchObject({ stateVersion: 2, acceptedVersion: 1 });
    const row = (await outboxOf(shop.id))!;
    expect(row).toMatchObject({ dueVersion: 2, attempts: 0, leasedUntil: null, failedAt: null });
    // Due at once, not when the lease would have run out.
    expect(await claimDue(prisma(), now, 10)).toEqual([shop.id]);
    expect(await deliverOne(prisma(), client, shop.id, now)).toBe('sent');
    expect((client.of('pushState')[0] as { version: number }).version).toBe(2);
    expect(await outboxOf(shop.id)).toBeNull();
    expect((await linkOf(shop.id)).acceptedVersion).toBe(2);

    // A failure of the older version neither spends the newer one's attempts nor delays or fails it.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const answer of [{ kind: 'retry', code: 'HTTP_503' }, { kind: 'permanent', code: 'INVALID_INPUT' }] as const) {
      await bump(shop.id);
      client.answer('pushState', async () => {
        await bump(shop.id);
        return answer;
      });
      const at = soon();
      await deliver(client, shop.id, at);
      const kept = (await outboxOf(shop.id))!;
      expect(kept).toMatchObject({ dueVersion: (await linkOf(shop.id)).stateVersion, attempts: 0, failedAt: null, leasedUntil: null });
      expect(kept.nextAttemptAt.getTime()).toBeLessThanOrEqual(at.getTime());
      client.answer('pushState', (body) => ({ kind: 'ok', body: { applied: true, version: (body as { version: number }).version } }));
      expect(await deliver(client, shop.id, at)).toBe('sent');
      expect(await outboxOf(shop.id)).toBeNull();
    }
  });

  it('waiting spends no attempt', async () => {
    const shop = await readyShop('Ownerless', { owner: false });
    const client = fakeClient();
    const now = soon();
    expect(await deliver(client, shop.id, now)).toBe('waiting');
    expect(client.calls).toEqual([]);
    const row = (await outboxOf(shop.id))!;
    expect(row).toMatchObject({ waitingFor: 'OWNER', attempts: 0, leasedUntil: null, failedAt: null });
    expect(row.nextAttemptAt.getTime()).toBe(now.getTime() + 60 * MINUTE);

    const noSub = await readyShop('Unsubscribed', { subscription: 'none' });
    expect(await deliver(client, noSub.id, now)).toBe('waiting');
    expect(await outboxOf(noSub.id)).toMatchObject({ waitingFor: 'SUBSCRIPTION', attempts: 0 });
  });

  it('resync sends a higher version', async () => {
    const shop = await readyShop('Resync');
    const client = fakeClient();
    await deliver(client, shop.id);
    const { userId } = await createPasswordUser(prisma(), { email: 'root@buzzify.test', name: 'root', password: GOOD, isSuperAdmin: true });
    await prisma().user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
    const admin = (await loadActor(prisma(), userId)) as Actor;
    const result = await runAction(prisma(), admin, retail.resync, { restaurantId: shop.id }, META);
    expect(result).toMatchObject({ ok: true, data: { version: 2 } });
    expect(await deliver(client, shop.id)).toBe('sent');
    const pushed = coreStateSchema.parse(client.of('pushState')[0]);
    expect(pushed.version).toBe(2);
    expect(pushed.version).toBeGreaterThan(1);
    expect((await linkOf(shop.id)).acceptedVersion).toBe(2);
  });

  it('a business that is no longer retail is gone and its row removed', async () => {
    const food = await pharmacy('Food', { sector: 'FOOD', subscription: 'none' });
    await prisma().retailOutbox.create({ data: { restaurantId: food.id, dueVersion: 3, nextAttemptAt: new Date() } });
    const client = fakeClient();
    expect(await deliver(client, food.id)).toBe('gone');
    expect(client.calls).toEqual([]);
    expect(await outboxOf(food.id)).toBeNull();
  });

  it('a missing setting is a retry with CONFIG', async () => {
    const shop = await readyShop('Unset');
    const client = fakeClient({
      provision: () => {
        throw new RetailConfigError('RETAIL_SYNC_SECRET');
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await deliver(client, shop.id)).toBe('retry');
    expect(await outboxOf(shop.id)).toMatchObject({ attempts: 1, lastError: 'CONFIG', failedAt: null, leasedUntil: null });
  });

  it('runSender delivers what is due and counts the outcomes', async () => {
    const good = await readyShop('Good');
    const down = await readyShop('Down');
    const refused = await readyShop('Refused');
    await readyShop('Waiting', { owner: false });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = fakeClient({
      provision: (body) => {
        const id = (body as { coreBusinessId: string }).coreBusinessId;
        if (id === down.id) return { kind: 'retry', code: 'TIMEOUT' };
        if (id === refused.id) return { kind: 'permanent', code: 'PLAN_UNAVAILABLE' };
        return { kind: 'ok', body: { businessId: `rt-${id}` } };
      },
    });
    expect(await runSender(prisma(), client, soon())).toEqual({ sent: 1, waiting: 1, retried: 1, failed: 1 });
    expect(await outboxOf(good.id)).toBeNull();
    // Nothing is due any more.
    expect(await runSender(prisma(), client, soon())).toEqual({ sent: 0, waiting: 0, retried: 0, failed: 0 });
  });

  it('logs carry no body, secret or signature', async () => {
    enableRetail();
    const shop = await readyShop('Quiet');
    const owner = await prisma().user.findFirstOrThrow({ where: { memberships: { some: { restaurantId: shop.id } } } });
    const requests: { url: string; init: RequestInit }[] = [];
    const replies = [
      () => new Response(`upstream says ${SYNC} ${owner.email}`, { status: 503 }),
      () => new Response(JSON.stringify({ ok: false, code: 'INVALID_INPUT', detail: owner.email }), { status: 400 }),
      () => {
        throw new TypeError(`connect ECONNREFUSED ${SYNC}`);
      },
      () => new Response(JSON.stringify({ ok: false, code: 'PLAN_LIMIT', detail: owner.email }), { status: 422 }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, init });
        return replies[requests.length - 1]!();
      }),
    );
    const lines: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' '));
      });
    }
    const client = createHttpRetailClient();

    const outcomes: string[] = [];
    // A bump between attempts makes each one due at once (and resets the attempts).
    for (let i = 0; i < replies.length; i += 1) {
      if (i > 0) await bump(shop.id);
      outcomes.push(await deliver(client, shop.id));
    }
    expect(outcomes).toEqual(['retry', 'failed', 'retry', 'failed']);
    expect((await outboxOf(shop.id))!.lastError).toBe('PLAN_LIMIT');

    // Every request is what Retails accepts.
    for (const { url, init } of requests) {
      const target = new URL(url);
      expect(target.origin + target.pathname).toBe('https://retail.test/api/core/v1/provision');
      expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const verdict = verifyRequest({ method: 'POST', path: target.pathname + target.search, body: String(init.body), headers: new Headers(init.headers) }, [SYNC]);
      expect(verdict).toEqual({ ok: true });
      expect(coreProvisionInput.safeParse(JSON.parse(String(init.body))).success).toBe(true);
    }

    expect(lines.length).toBeGreaterThan(0);
    const signatures = requests.map(({ init }) => new Headers(init.headers).get('x-bz-signature')!);
    for (const line of lines) {
      expect(line).toMatch(/^\[retail\.sync\] \S+ [A-Z0-9_]+$/);
      for (const secret of [SYNC, CALLER, HANDOFF, owner.email, ...signatures]) expect(line).not.toContain(secret);
      expect(line).not.toContain('{');
    }
  });

  it('the kick never waits for the network in the request', async () => {
    enableRetail();
    const shop = await readyShop('Kicked');
    let release: (value: Response) => void = () => undefined;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetch);

    // In a request: the work is handed to after() and nothing has started when the kick returns.
    scheduled.mode = 'capture';
    const registered: (() => void)[] = [];
    expect(kickAfterCommit((fn) => registered.push(fn), shop.id)).toBeUndefined();
    expect(scheduled.tasks).toHaveLength(0);
    registered.forEach((fn) => fn());
    expect(scheduled.tasks).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();

    const running = Promise.resolve(scheduled.tasks[0]!());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // While that send is on the wire a second kick finds the row leased and sends nothing.
    scheduled.mode = 'throw';
    kickAfterCommit((fn) => fn(), shop.id);
    release(new Response(JSON.stringify({ businessId: 'rt-kicked' }), { status: 200 }));
    await running;
    await vi.waitFor(async () => expect(await outboxOf(shop.id)).toBeNull());
    // Let the second kick finish looking.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await linkOf(shop.id)).retailBusinessId).toBe('rt-kicked');
  });

  it('a kick outside a request starts at once and swallows its failures', async () => {
    enableRetail();
    const shop = await readyShop('Offline');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')));
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')));
    expect(() => kickAfterCommit((fn) => fn(), shop.id)).not.toThrow();
    await vi.waitFor(async () => expect(await outboxOf(shop.id)).toMatchObject({ attempts: 1, lastError: 'NETWORK', leasedUntil: null }));
    for (const line of lines) expect(line).toMatch(/^\[retail\.sync\] \S+ [A-Z0-9_]+$/);

    // A kick whose own work throws (the database refuses) is swallowed too.
    await bump(shop.id);
    const refused = vi.spyOn(prisma(), '$queryRaw').mockRejectedValueOnce(new Error('the database is down'));
    kickAfterCommit((fn) => fn(), shop.id);
    await vi.waitFor(() => expect(refused).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lines.at(-1)).toMatch(/^\[retail\.sync\] \S+ KICK_FAILED$/);

    // Without RETAIL_URL a kick does nothing at all.
    vi.stubEnv('RETAIL_URL', '');
    scheduled.mode = 'capture';
    kickAfterCommit((fn) => fn(), shop.id);
    expect(scheduled.tasks).toHaveLength(0);
  });
});
