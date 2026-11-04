import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNavCounts } from '@/server/pharmacy/nav-counts';
import * as navQueries from '@/server/pharmacy/queries/nav-counts';
import { loadActor } from '@/server/studio/auth/actor';
import { runQuery } from '@/server/studio/framework/query';
import { grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { ask, dataOf, makeBatch, makeProduct } from './stock-helpers';

const access = vi.hoisted(() => ({ current: null as null | { actor: { role: string | null; support: object | null }; place: { restaurantId: string; branchId: string | null }; userId: string } }));
const queried = vi.hoisted(() => ({ calls: 0 }));

vi.mock('@/server/pharmacy/actor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/pharmacy/actor')>()),
  getPhAccess: async () => (access.current ? { signedIn: true, actor: access.current.actor, gate: { state: 'open' }, place: access.current.place } : { signedIn: false, actor: null, gate: null, place: null }),
}));
// `query` stands in for the page loader: it counts calls and runs the real query as the person in `access`.
vi.mock('@/server/studio/framework/invoke', () => ({
  query: async (def: never, raw: unknown) => {
    queried.calls += 1;
    const { prisma: db } = await import('./fixture');
    const result = await runQuery(db(), await loadActor(db(), access.current!.userId), def, raw);
    if (!result.ok) throw new Error(`notFound (${result.error.code})`);
    return result.data;
  },
}));

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld, 60_000);

const TODAY = '2026-10-27';
const plus = (days: number) => new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

async function world() {
  const a = await pharmacy('A', { branches: 2 });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  return { a, owner, b1: a.branchIds[0]!, b2: a.branchIds[1]! };
}

const minimum = (restaurantId: string, branchId: string, productId: string, minQty: number) =>
  prisma().phProductBranch.create({ data: { restaurantId, branchId, productId, minQty } });

describe('ph.nav.counts', () => {
  it('an empty pharmacy is 0 and 0', async () => {
    const { a, owner } = await world();
    expect(dataOf(await ask(owner, navQueries.navCounts, { restaurantId: a.id, now: NOW }))).toEqual({ lowStock: 0, expiring: 0 });
  });

  it('low stock counts products below their minimum, as the stock screen does', async () => {
    const { a, owner, b1 } = await world();
    const low = await makeProduct(a.id, 'Low');
    const fine = await makeProduct(a.id, 'Fine');
    const none = await makeProduct(a.id, 'NoMinimum');
    await makeBatch(a.id, b1, low.id, { lot: 'L', buckets: { available: 4 } });
    await makeBatch(a.id, b1, fine.id, { lot: 'F', buckets: { available: 20 } });
    await makeBatch(a.id, b1, none.id, { lot: 'N', buckets: { available: 0 } });
    await minimum(a.id, b1, low.id, 10);
    await minimum(a.id, b1, fine.id, 10);
    await minimum(a.id, b1, none.id, 0);
    expect(dataOf(await ask(owner, navQueries.navCounts, { restaurantId: a.id, now: NOW })).lowStock).toBe(1);
  });

  it('expiring counts batches with stock expiring within 90 days and not yet expired', async () => {
    const { a, owner, b1 } = await world();
    const p = await makeProduct(a.id, 'Panadol');
    await makeBatch(a.id, b1, p.id, { lot: 'SOON', expiry: plus(30), buckets: { available: 5 } });
    await makeBatch(a.id, b1, p.id, { lot: 'EMPTY', expiry: plus(30), buckets: {} });
    await makeBatch(a.id, b1, p.id, { lot: 'GONE', expiry: plus(-1), buckets: { available: 5 } });
    await makeBatch(a.id, b1, p.id, { lot: 'FAR', expiry: plus(120), buckets: { available: 5 } });
    await makeBatch(a.id, b1, p.id, { lot: 'D90', expiry: plus(90), buckets: { available: 5 } });
    await makeBatch(a.id, b1, p.id, { lot: 'D91', expiry: plus(91), buckets: { available: 5 } });
    await makeBatch(a.id, b1, p.id, { lot: 'TODAY', expiry: plus(0), buckets: { available: 1 } });
    expect(dataOf(await ask(owner, navQueries.navCounts, { restaurantId: a.id, now: NOW })).expiring).toBe(3);
  });

  it('matches the expiry screen: a MONTH batch counts from the start of its month', async () => {
    const { a, owner, b1 } = await world();
    const p = await makeProduct(a.id, 'Month');
    for (const [lot, end] of [['M-NOV', '2026-11-30'], ['M-JAN', '2027-01-31'], ['M-FEB', '2027-02-28']] as const) {
      const id = await makeBatch(a.id, b1, p.id, { lot, expiry: end, buckets: { available: 5 } });
      await prisma().phBatch.update({ where: { id }, data: { expiryPrecision: 'MONTH' } });
    }
    // 2027-01-01 is 66 days out (in); 2027-02-01 is 97 days out (out).
    const counts = dataOf(await ask(owner, navQueries.navCounts, { restaurantId: a.id, now: NOW }));
    expect(counts.expiring).toBe(2);
  });

  it('branchId filters; without one every branch of the person counts', async () => {
    const { a, owner, b1, b2 } = await world();
    const p = await makeProduct(a.id, 'Two');
    await makeBatch(a.id, b1, p.id, { lot: 'B1', expiry: plus(10), buckets: { available: 2 } });
    await makeBatch(a.id, b2, p.id, { lot: 'B2', expiry: plus(10), buckets: { available: 2 } });
    await minimum(a.id, b1, p.id, 5);
    const at = (branchId?: string) => ask(owner, navQueries.navCounts, { restaurantId: a.id, now: NOW, ...(branchId ? { branchId } : {}) });
    expect(dataOf(await at(b1))).toEqual({ lowStock: 1, expiring: 1 });
    expect(dataOf(await at(b2))).toEqual({ lowStock: 0, expiring: 1 });
    expect(dataOf(await at())).toEqual({ lowStock: 1, expiring: 2 });
  });
});

describe('getNavCounts (the layout call)', () => {
  it('a staff actor gets the real counts', async () => {
    const { a, owner, b1 } = await world();
    const p = await makeProduct(a.id, 'Staff');
    await makeBatch(a.id, b1, p.id, { lot: 'S', expiry: plus(10), buckets: { available: 2 } });
    access.current = { userId: owner.userId, actor: { role: 'OWNER', support: null }, place: { restaurantId: a.id, branchId: null } };
    queried.calls = 0;
    expect(await getNavCounts({ branchId: null, now: NOW })).toEqual({ lowStock: 0, expiring: 1 });
  });

  it('a support actor gets zeros without the query running (no notFound)', async () => {
    const { a } = await world();
    const support = await person('support', { superAdmin: true });
    await grant(support, a.id);
    // proves the failure the guard avoids: the query itself refuses this actor
    expect((await ask(support, navQueries.navCounts, { restaurantId: a.id, now: NOW })).ok).toBe(false);
    access.current = { userId: support.userId, actor: { role: null, support: { grantId: 'g' } }, place: { restaurantId: a.id, branchId: null } };
    queried.calls = 0;
    expect(await getNavCounts({ branchId: null, now: NOW })).toEqual({ lowStock: 0, expiring: 0 });
    expect(queried.calls).toBe(0);
  });

  it('an actor with no pharmacy role gets zeros', async () => {
    const { a } = await world();
    access.current = { userId: 'x', actor: { role: null, support: null }, place: { restaurantId: a.id, branchId: null } };
    queried.calls = 0;
    expect(await getNavCounts({ branchId: null, now: NOW })).toEqual({ lowStock: 0, expiring: 0 });
    expect(queried.calls).toBe(0);
  });
});
