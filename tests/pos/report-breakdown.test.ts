import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRangeReport } from '@/server/pos/range-report';
import { posBreakdown } from '@/server/studio/queries/pos-breakdown';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let sara: Person;
let omar: Person;
let manager: Person;
let bSara: Person;
let n = 0;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  n = 0;
  a = await restaurant('Breakdown A');
  b = await restaurant('Breakdown B');
  sara = await person('sara', { staff: [a.id, 'CASHIER'] });
  omar = await person('omar', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  bSara = await person('bsara', { staff: [b.id, 'CASHIER'] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

interface Line {
  name: string;
  quantity: number;
  lineTotal: number;
}

/** A finished sale at `paidAt` (UTC), taken by `who` with `method`; the total is the lines' sum. */
async function sale(restaurantId: string, who: Person, paidAt: string, lines: Line[], method: 'CASH' | 'FIB' = 'CASH', service = 0) {
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const total = subtotal + service;
  n += 1;
  const order = await prisma().posOrder.create({ data: { restaurantId, kind: 'DINE_IN', status: 'PAID', number: n } });
  await prisma().posPayment.create({
    data: {
      restaurantId,
      orderId: order.id,
      method,
      amountReceived: total,
      paidAt: new Date(paidAt),
      userId: who.userId,
      totalsSnapshot: {
        subtotal,
        invoiceDiscount: 0,
        service,
        tax: 0,
        deliveryFee: 0,
        total,
        invoiceDiscountInput: null,
        rates: { serviceRatePercent: 0, taxRatePercent: 0 },
        lines: lines.map((l, i) => ({ id: `${order.id}-${i}`, name: l.name, quantity: l.quantity, unitPrice: l.lineTotal / l.quantity, options: [], discount: null, lineTotal: l.lineTotal })),
      },
    },
  });
}

const burger = (quantity: number): Line => ({ name: 'Burger', quantity, lineTotal: quantity * 5000 });
const juice = (quantity: number): Line => ({ name: 'Juice', quantity, lineTotal: quantity * 2000 });
const range = { from: '2026-10-20', to: '2026-10-21' };

describe('the sales breakdown', () => {
  it('adds up to the range report for the same days', async () => {
    await sale(a.id, sara, '2026-10-20T10:00:00Z', [burger(2), juice(1)]);
    await sale(a.id, omar, '2026-10-21T08:00:00Z', [juice(3)], 'FIB');
    const breakdown = dataOf(await ask(manager, posBreakdown, range));
    const gross = (await readRangeReport(prisma(), a.id, range)).totals.grossSales;
    for (const key of ['byHour', 'byItem', 'byStaff', 'byMethod'] as const) {
      expect(breakdown[key].reduce((sum, row) => sum + row.total, 0), key).toBe(gross);
    }
  });

  it('still adds up when service is charged, spreading it over the items', async () => {
    await sale(a.id, sara, '2026-10-20T10:00:00Z', [burger(1), juice(1)], 'CASH', 700); // 7,000 + 700 service
    const breakdown = dataOf(await ask(manager, posBreakdown, range));
    const gross = (await readRangeReport(prisma(), a.id, range)).totals.grossSales;
    expect(gross).toBe(7700);
    expect(breakdown.byItem.reduce((sum, row) => sum + row.total, 0)).toBe(gross);
    expect(breakdown.byItem.map((r) => r.name)).toEqual(['Burger', 'Juice']);
  });

  it('groups by the Baghdad hour, across midnight', async () => {
    await sale(a.id, sara, '2026-10-20T20:59:00Z', [juice(1)]); // 23:59 in Baghdad on the 20th
    await sale(a.id, sara, '2026-10-20T21:30:00Z', [juice(2)]); // 00:30 on the 21st
    const { byHour } = dataOf(await ask(manager, posBreakdown, range));
    expect(byHour).toEqual([
      { hour: 0, orders: 1, total: 4000 },
      { hour: 23, orders: 1, total: 2000 },
    ]);
  });

  it('groups by item, biggest sales first', async () => {
    await sale(a.id, sara, '2026-10-20T10:00:00Z', [burger(1), juice(2)]);
    await sale(a.id, omar, '2026-10-20T11:00:00Z', [burger(2), juice(1)]);
    const { byItem } = dataOf(await ask(manager, posBreakdown, range));
    expect(byItem).toEqual([
      { name: 'Burger', quantity: 3, total: 15_000 },
      { name: 'Juice', quantity: 3, total: 6_000 },
    ]);
  });

  it('groups by staff and by payment method', async () => {
    await sale(a.id, sara, '2026-10-20T10:00:00Z', [burger(1)]);
    await sale(a.id, sara, '2026-10-20T11:00:00Z', [juice(1)], 'FIB');
    await sale(a.id, omar, '2026-10-20T12:00:00Z', [burger(2)]);
    const { byStaff, byMethod } = dataOf(await ask(manager, posBreakdown, range));
    expect(byStaff).toEqual([
      { userId: omar.userId, name: 'omar person', orders: 1, total: 10_000 },
      { userId: sara.userId, name: 'sara person', orders: 2, total: 7_000 },
    ]);
    expect(byMethod).toEqual([
      { method: 'CASH', orders: 2, total: 15_000 },
      { method: 'FIB', orders: 1, total: 2_000 },
    ]);
  });

  it('is empty for a range with no sales', async () => {
    expect(dataOf(await ask(manager, posBreakdown, range))).toEqual({ byHour: [], byItem: [], byStaff: [], byMethod: [] });
  });

  it('leaves out sales outside the days and other restaurants', async () => {
    await sale(a.id, sara, '2026-10-19T10:00:00Z', [burger(1)]);
    await sale(a.id, sara, '2026-10-22T10:00:00Z', [burger(1)]);
    await sale(b.id, bSara, '2026-10-20T10:00:00Z', [burger(9)]);
    expect(dataOf(await ask(manager, posBreakdown, range)).byItem).toEqual([]);
  });

  it('is for report readers, and refuses a backwards range', async () => {
    expect(codeOf(await ask(sara, posBreakdown, range) as never)).toBe('FORBIDDEN');
    expect(codeOf(await ask(manager, posBreakdown, { from: '2026-10-21', to: '2026-10-20' }) as never)).toBe('INVALID');
  });
});
