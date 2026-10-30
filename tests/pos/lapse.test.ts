import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { baghdadDayOf } from '@/lib/baghdad';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { openPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { closePosShift, openPosShift } from '@/server/studio/actions/pos-shifts';
import { posBoard, posDailyReport, posOpenShifts, posShift } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const DAY = 86_400_000;

let a: { id: string };
let cashier: Person;
let manager: Person;
let tableId: string;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Lapse A');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 2 });
  tableId = (await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id } })).id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

/** Ends the Cashier subscription long enough ago to be past any grace. */
const lapse = () =>
  prisma().subscription.updateMany({
    where: { restaurantId: a.id, applicationId: 'cashier' },
    data: { status: 'ACTIVE', currentPeriodStart: new Date(Date.now() - 400 * DAY), currentPeriodEnd: new Date(Date.now() - 365 * DAY) },
  });

describe('a lapsed Cashier subscription', () => {
  it('still lets a shift be closed, read and reported', async () => {
    const shiftId = dataOf(await run(cashier, openPosShift, { openingFloat: 1_000 })).shiftId;
    await lapse();
    expect(dataOf(await ask(cashier, posShift, { shiftId })).expectedCash).toBeNull();
    expect(dataOf(await ask(manager, posOpenShifts, {})).shifts).toHaveLength(1);
    expect(codeOf(await ask(manager, posDailyReport, { day: baghdadDayOf(new Date()) }) as never)).toBe('OK');
    expect(dataOf(await run(cashier, closePosShift, { shiftId, countedCash: 1_000, note: '' })).difference).toBe(0);
  });

  it('refuses everything else: opening a shift, opening an order, paying, the board', async () => {
    await lapse();
    expect(codeOf(await run(cashier, openPosShift, { openingFloat: 0 }))).toBe('FORBIDDEN');
    expect(codeOf(await run(cashier, openPosOrder, { tableId }))).toBe('FORBIDDEN');
    expect(codeOf(await run(cashier, payPosOrder, { orderId: 'x', expectedVersion: 1, expectedTotal: 0, amountReceived: 0 }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(cashier, posBoard, {}) as never)).toBe('FORBIDDEN');
  });

  it('lets nothing through once the restaurant itself is suspended', async () => {
    const shiftId = dataOf(await run(cashier, openPosShift, { openingFloat: 0 })).shiftId;
    await lapse();
    await prisma().restaurant.update({ where: { id: a.id }, data: { status: 'SUSPENDED' } });
    expect(codeOf(await run(cashier, closePosShift, { shiftId, countedCash: 0, note: '' }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(cashier, posShift, { shiftId }) as never)).toBe('FORBIDDEN');
    expect(codeOf(await ask(manager, posDailyReport, { day: baghdadDayOf(new Date()) }) as never)).toBe('FORBIDDEN');
  });

  it('still keeps the role check: a cashier cannot read the report', async () => {
    await lapse();
    expect(codeOf(await ask(cashier, posDailyReport, { day: baghdadDayOf(new Date()) }) as never)).toBe('FORBIDDEN');
  });
});
