import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { resolvePhActor, phGate, currentPhPlaceInput } from '@/server/pharmacy/actor';
import { PH_PLACE_COOKIE, signPlaceCookie } from '@/server/pharmacy/entry';
import { invokePhQuery } from '@/server/pharmacy/invoke';
import { withPlace } from '@/server/pharmacy/place-input';
import * as productQueries from '@/server/pharmacy/queries/products';
import * as stockQueries from '@/server/pharmacy/queries/stock';
import { authEnv } from '@/server/env';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { invokePublic, invokeQuery } from '@/server/studio/framework/invoke';
import { runQuery } from '@/server/studio/framework/query';
import * as session from '@/server/studio/public-actions/session';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { Browser } from '../helpers/browser';
import { dataOf, makeBatch, makeProduct } from './stock-helpers';
import { GOOD, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';

/**
 * One pharmacy request resolves who is acting and whether the pharmacy is open once. `getPhAccess` already did, and
 * `invokePhQuery` hands that answer to the framework, which used to resolve the actor and the gate a second time. These
 * tests count the database queries of one search and one stock list before (the old composition: place, then
 * `invokeQuery`) and after (`invokePhQuery`), with `cache()` standing in for one request (a new request empties it), and
 * prove that nothing is reused by another person, another pharmacy or another request.
 */

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

/** React's `cache` outside a server render does not remember; here it remembers until `newRequest()`, as one request does. */
const requests = vi.hoisted(() => ({ stores: [] as Array<Map<string, unknown>> }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      const store = new Map<string, unknown>();
      requests.stores.push(store);
      return (...args: A): R => {
        const key = JSON.stringify(args);
        if (!store.has(key)) store.set(key, fn(...args));
        return store.get(key) as R;
      };
    },
  };
});
const newRequest = () => requests.stores.forEach((store) => store.clear());

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const makeLogged = () => new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl(TEST_DB) }), log: [{ emit: 'event' as const, level: 'query' as const }] });
let logged: ReturnType<typeof makeLogged>;
let queries: string[] = [];

interface World {
  a: Awaited<ReturnType<typeof pharmacy>>;
  b: Awaited<ReturnType<typeof pharmacy>>;
  ownerEmail: string;
  ownerId: string;
  otherId: string;
  browser: Browser;
}
let w: World;

async function signIn(browser: Browser, email: string) {
  browser.activate();
  const done = await invokePublic(session.signIn, { email, password: GOOD });
  if (!done.ok) throw new Error(`sign-in failed: ${JSON.stringify(done.error)}`);
}

const choose = (browser: Browser, userId: string, restaurantId: string, branchId: string | null) =>
  browser.jar.set(PH_PLACE_COOKIE, signPlaceCookie(authEnv().secret, userId, { restaurantId, branchId }));

beforeAll(async () => {
  useTestDatabase();
  await resetWorld();
  const a = await pharmacy('A', { branches: 2 });
  const b = await pharmacy('B');
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const other = await person('other', { membership: [b.id, 'OWNER'] });
  const p = await makeProduct(a.id, 'Panadol');
  await makeBatch(a.id, a.branchId, p.id, { buckets: { available: 20 } });
  const browser = new Browser('198.51.100.88', 'vitest request reuse');
  w = { a, b, ownerEmail: owner.email, ownerId: owner.userId, otherId: other.userId, browser };
  // From here every query is logged; the session is made through the same client.
  await prisma().$disconnect();
  logged = makeLogged();
  logged.$on('query', (event) => queries.push(event.query));
  globalForPrisma.__prisma = logged;
  await signIn(browser, owner.email);
  choose(browser, owner.userId, a.id, a.branchId);
}, 120_000);

afterAll(async () => {
  await logged.$disconnect();
  delete globalForPrisma.__prisma;
});

beforeEach(() => {
  w.browser.activate();
  newRequest();
});

/** The database queries one call makes, with a fresh request and a warm connection. */
async function measure<T>(call: () => Promise<T>): Promise<{ result: T; count: number }> {
  newRequest();
  queries = [];
  const result = await call();
  return { result, count: queries.length };
}

/** What the pharmacy's Server Actions did before: the chosen place, then the framework resolving everything again. */
async function before<I, O>(def: Parameters<typeof invokeQuery<I, O>>[0], raw: unknown) {
  const place = await currentPhPlaceInput();
  if (!place) throw new Error('no place chosen');
  return invokeQuery(def, withPlace(raw, place));
}

describe('one request resolves the actor and the gate once', () => {
  it('a product search makes fewer queries than the old composition, and answers the same', async () => {
    const old = await measure(() => before(productQueries.search, { q: 'pana' }));
    const now = await measure(() => invokePhQuery(productQueries.search, { q: 'pana' }));
    console.info(`[request-reuse] ph.products.search: ${old.count} queries before, ${now.count} after`);
    expect(dataOf(now.result)).toEqual(dataOf(old.result));
    expect(dataOf(now.result).length).toBeGreaterThan(0);
    // The framework's second resolution of the person, the restaurant, its branches, the gate and the subscription: 9 queries.
    expect(now.count).toBeLessThanOrEqual(old.count - 9);
  });

  it('a stock list makes fewer queries than the old composition, and answers the same', async () => {
    const input = { onlyWithStock: true };
    const old = await measure(() => before(stockQueries.balances, input));
    const now = await measure(() => invokePhQuery(stockQueries.balances, input));
    console.info(`[request-reuse] ph.stock.balances: ${old.count} queries before, ${now.count} after`);
    expect(dataOf(now.result)).toEqual(dataOf(old.result));
    expect(dataOf(now.result).items.length).toBeGreaterThan(0);
    expect(now.count).toBeLessThanOrEqual(old.count - 9);
  });

  it('resolves the actor and the gate once for the whole request', async () => {
    const { count } = await measure(() => invokePhQuery(productQueries.search, { q: 'pana' }));
    expect(count).toBeGreaterThan(0);
    // The access reads that identify the person in the pharmacy and open the gate appear once each.
    const reads = (table: string) => queries.filter((sql) => new RegExp(`FROM "public"."${table}"`).test(sql) && /SELECT/.test(sql)).length;
    expect(reads('Subscription')).toBe(1);
    expect(reads('PhStaff')).toBe(1);
  });
});

describe('nothing is reused across people, pharmacies or requests', () => {
  const actorOf = async (userId: string) => (await loadActor(prisma(), userId)) as Actor;

  it('a resolution made for another person is ignored', async () => {
    const owner = await actorOf(w.ownerId);
    const other = await actorOf(w.otherId);
    const known = {
      actor: (await resolvePhActor(prisma(), w.ownerId, { restaurantId: w.a.id, now: NOW }))!,
      gate: await phGate(prisma(), w.a.id, NOW),
    };
    const input = { restaurantId: w.a.id, branchId: w.a.branchId, q: 'pana' };
    // The owner of A, with their own resolution: answered.
    expect((await runQuery(prisma(), owner, productQueries.search, input, { phAccess: known })).ok).toBe(true);
    // The owner of B, carrying the owner of A's resolution: they are not a member of A, so it is refused.
    const refused = await runQuery(prisma(), other, productQueries.search, input, { phAccess: known });
    expect(refused).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it("a resolution made for another pharmacy is ignored, so the named pharmacy's own check runs", async () => {
    const owner = await actorOf(w.ownerId);
    const otherActor = (await resolvePhActor(prisma(), w.otherId, { restaurantId: w.b.id, now: NOW }))!;
    const known = { actor: otherActor, gate: await phGate(prisma(), w.b.id, NOW) };
    // The owner of A names B's pharmacy while carrying B's owner's resolution: neither the person nor the pharmacy match.
    const input = { restaurantId: w.b.id, q: 'pana' };
    expect(await runQuery(prisma(), owner, productQueries.search, input, { phAccess: known })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('a resolution never carries a closed gate or a missing role past the checks', async () => {
    const owner = await actorOf(w.ownerId);
    const known = {
      actor: (await resolvePhActor(prisma(), w.ownerId, { restaurantId: w.a.id, now: NOW }))!,
      gate: { state: 'closed', reason: 'planInactive' } as const,
    };
    expect(await runQuery(prisma(), owner, productQueries.search, { restaurantId: w.a.id, q: 'pana' }, { phAccess: known })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    // A branch the person does not use is still refused with the resolution in hand.
    const wrongBranch = { actor: { ...known.actor, allBranches: false, branchIds: [w.a.branchId] }, gate: { state: 'open' } as const };
    expect(await runQuery(prisma(), owner, productQueries.search, { restaurantId: w.a.id, branchId: w.a.branchIds[1], q: 'pana' }, { phAccess: wrongBranch })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('the next request resolves again: a person removed after one request is refused in the next', async () => {
    const first = await measure(() => invokePhQuery(productQueries.search, { q: 'pana' }));
    expect(first.result.ok).toBe(true);
    await prisma().user.update({ where: { id: w.ownerId }, data: { deactivatedAt: NOW } });
    try {
      newRequest();
      // The session of a deactivated person gives no actor at all.
      expect((await invokePhQuery(productQueries.search, { q: 'pana' })).ok).toBe(false);
    } finally {
      await prisma().user.update({ where: { id: w.ownerId }, data: { deactivatedAt: null } });
    }
    newRequest();
    expect((await invokePhQuery(productQueries.search, { q: 'pana' })).ok).toBe(true);
  });

  it('a closed pharmacy stays closed for a request that reuses the resolution', async () => {
    await prisma().subscription.updateMany({ where: { restaurantId: w.a.id }, data: { status: 'CANCELLED', cancelledAt: new Date(NOW.getTime() - 400 * 86_400_000) } });
    try {
      newRequest();
      expect(await invokePhQuery(productQueries.search, { q: 'pana' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    } finally {
      await prisma().subscription.updateMany({ where: { restaurantId: w.a.id }, data: { status: 'ACTIVE', cancelledAt: null } });
    }
  });
});
