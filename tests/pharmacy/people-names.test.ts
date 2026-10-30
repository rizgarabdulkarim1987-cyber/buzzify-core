import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as peopleQueries from '@/server/pharmacy/queries/people';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { ask, codeOf, dataOf } from './stock-helpers';

/**
 * The names behind the ids on the shift, sale and return screens: only people of the asking business (staff of the
 * pharmacy or its Studio members), only the name (never an email), at most 50 ids, any pharmacy role, no support actor.
 */

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld);

async function world() {
  const a = await pharmacy('A', { branches: 2 });
  const b = await pharmacy('B');
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [a.branchIds[0]!]] });
  const foreign = await person('foreign', { staff: [b.id, 'CASHIER', [b.branchId]] });
  const nobody = await person('nobody');
  return { a, b, owner, cashier, foreign, nobody };
}

describe('ph.people.names', () => {
  it('names the staff and the owner of the business, and nobody else, and never an email', async () => {
    const w = await world();
    const ids = [w.owner.userId, w.cashier.userId, w.foreign.userId, w.nobody.userId, 'not-a-user'];
    const got = dataOf(await ask(w.cashier, peopleQueries.names, { restaurantId: w.a.id, ids }));
    expect(got.names).toEqual({ [w.owner.userId]: 'owner person', [w.cashier.userId]: 'cashier person' });
    expect(JSON.stringify(got)).not.toContain('@');
  });

  it('keeps naming a person who was switched off from the pharmacy (their history stays readable)', async () => {
    const w = await world();
    await prisma().phStaff.updateMany({ where: { userId: w.cashier.userId }, data: { deactivatedAt: NOW } });
    const got = dataOf(await ask(w.owner, peopleQueries.names, { restaurantId: w.a.id, ids: [w.cashier.userId] }));
    expect(got.names[w.cashier.userId]).toBe('cashier person');
  });

  it('another business asking for these ids gets none of them', async () => {
    const w = await world();
    const got = dataOf(await ask(w.foreign, peopleQueries.names, { restaurantId: w.b.id, ids: [w.owner.userId, w.cashier.userId] }));
    expect(got.names).toEqual({});
    expect(codeOf(await ask(w.foreign, peopleQueries.names, { restaurantId: w.a.id, ids: [w.owner.userId] }))).not.toBe('OK');
  });

  it('refuses no ids, more than 50, and a person with no role here', async () => {
    const w = await world();
    expect(codeOf(await ask(w.owner, peopleQueries.names, { restaurantId: w.a.id, ids: [] }))).toBe('INVALID');
    expect(codeOf(await ask(w.owner, peopleQueries.names, { restaurantId: w.a.id, ids: Array.from({ length: 51 }, (_, i) => `u${i}`) }))).toBe('INVALID');
    expect(codeOf(await ask(w.nobody, peopleQueries.names, { restaurantId: w.a.id, ids: [w.owner.userId] }))).not.toBe('OK');
  });

  it('refuses a stock-only role', async () => {
    const w = await world();
    const stock = await person('stock', { staff: [w.a.id, 'STOCK', [w.a.branchIds[0]!]] });
    expect(codeOf(await ask(stock, peopleQueries.names, { restaurantId: w.a.id, ids: [w.owner.userId] }))).toBe('FORBIDDEN');
  });

  it('answers the same ids once', async () => {
    const w = await world();
    const got = dataOf(await ask(w.owner, peopleQueries.names, { restaurantId: w.a.id, ids: [w.cashier.userId, w.cashier.userId] }));
    expect(Object.keys(got.names)).toEqual([w.cashier.userId]);
  });
});
