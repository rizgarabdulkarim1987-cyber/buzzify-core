import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextCounterIn } from '@/server/pos/counter';
import { closePosShift, openPosShift } from '@/server/studio/actions/pos-shifts';
import { posShift } from '@/server/studio/queries/pos';
import { ask, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let cashier: Person;
let other: Person;
let bCashier: Person;
let manager: Person;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Close A');
  b = await restaurant('Close B');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  other = await person('other', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  bCashier = await person('bcashier', { staff: [b.id, 'CASHIER'] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const open = async (who: Person, openingFloat = 50_000) => dataOf(await run(who, openPosShift, { openingFloat })).shiftId;
const close = async (who: Person, shiftId: string, countedCash: number) => dataOf(await run(who, closePosShift, { shiftId, countedCash, note: '' }));

describe('the blind count', () => {
  it('keeps the expected cash out of an open shift and shows it once the shift is closed', async () => {
    const shiftId = await open(cashier);
    const live = dataOf(await ask(cashier, posShift, { shiftId }));
    expect(live.expectedCash).toBeNull();
    expect(live.shift.expectedCashAtClose).toBeNull();
    const done = await close(cashier, shiftId, 49_000);
    expect(done).toMatchObject({ expected: 50_000, counted: 49_000, difference: -1_000 });
    const frozen = dataOf(await ask(cashier, posShift, { shiftId }));
    expect(frozen.expectedCash).toBe(50_000);
    expect(frozen.shift.difference).toBe(-1_000);
  });
});

describe('Z numbers', () => {
  it('numbers closed shifts one after another per restaurant, starting at 1', async () => {
    const s1 = await open(cashier);
    const s2 = await open(other);
    expect((await close(cashier, s1, 50_000)).zNumber).toBe(1);
    expect((await close(other, s2, 50_000)).zNumber).toBe(2);
    const s3 = await open(bCashier);
    expect((await close(bCashier, s3, 50_000)).zNumber).toBe(1);
    expect(dataOf(await ask(manager, posShift, { shiftId: s2 })).shift.zNumber).toBe(2);
  });

  it('never gives two shifts closing at the same moment the same number', async () => {
    const s1 = await open(cashier);
    const s2 = await open(other);
    const results = await Promise.all([run(cashier, closePosShift, { shiftId: s1, countedCash: 50_000, note: '' }), run(other, closePosShift, { shiftId: s2, countedCash: 50_000, note: '' })]);
    const numbers = results.map((r) => dataOf(r).zNumber).sort();
    expect(numbers).toEqual([1, 2]);
  });

  it('gives a shift closed before numbering no Z number', async () => {
    const user = await person('legacy', { staff: [a.id, 'CASHIER'] });
    const legacy = await prisma().posShift.create({
      data: { restaurantId: a.id, userId: user.userId, openingFloat: 0, closedAt: new Date(), closedByUserId: user.userId, countedCash: 0, expectedCashAtClose: 0, difference: 0 },
    });
    expect(dataOf(await ask(manager, posShift, { shiftId: legacy.id })).shift.zNumber).toBeNull();
  });
});

describe('nextCounterIn', () => {
  it('counts up from 1 per restaurant and name', async () => {
    expect(await nextCounterIn(prisma(), a.id, 'z')).toBe(1);
    expect(await nextCounterIn(prisma(), a.id, 'z')).toBe(2);
    expect(await nextCounterIn(prisma(), a.id, 'other')).toBe(1);
    expect(await nextCounterIn(prisma(), b.id, 'z')).toBe(1);
  });
});
