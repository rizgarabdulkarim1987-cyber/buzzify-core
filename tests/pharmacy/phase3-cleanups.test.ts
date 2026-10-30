import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as shiftActions from '@/server/pharmacy/actions/shifts';
import * as returnQueries from '@/server/pharmacy/queries/returns';
import * as saleQueries from '@/server/pharmacy/queries/sales';
import * as shiftQueries from '@/server/pharmacy/queries/shifts';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, ask, codeOf, dataOf, makeBatch, makeProduct, phCodeOf } from './stock-helpers';

/**
 * Small hardening from the phase 3 reviews: a held cart's stored payload is read through a schema and carries no place
 * fields, the held-cart list says when there are more than it shows, a made-up list cursor is INVALID and not a database
 * error, and an inconsistent cash total is CASH_NOT_CONSISTENT on every path that reads it (not only on close).
 */

// The cash total cannot be made inconsistent through the database (its CHECKs keep every movement the right way round), so
// the mapping is exercised by making the domain's `expectedCash` refuse, as it does for a negative part.
const inconsistent = vi.hoisted(() => ({ on: false }));
vi.mock('@/server/domain/pharmacy/sale', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/domain/pharmacy/sale')>();
  return {
    ...original,
    expectedCash: (...args: Parameters<typeof original.expectedCash>) => {
      if (inconsistent.on) throw new original.SaleMathError('INVALID_AMOUNT', 'An amount cannot be negative');
      return original.expectedCash(...args);
    },
  };
});

interface World {
  a: { id: string; branchId: string; branchIds: string[] };
  b1: string;
  owner: Person;
  cashier: Person;
  p: { id: string; tablet: string; strip: string };
  shiftId: string;
}

let seq = 0;
const key = (label: string) => `${label}-${(seq += 1)}-${'x'.repeat(8)}`;

async function world(): Promise<World> {
  const a = await pharmacy('A', { branches: 2 });
  const [b1] = a.branchIds as [string, string];
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [b1]] });
  await prisma().phSettings.create({ data: { restaurantId: a.id } });
  const p = await makeProduct(a.id, 'Panadol');
  for (const [unitId, amountMinor] of [[p.tablet, 100n], [p.strip, 900n]] as const) {
    await prisma().phPrice.create({ data: { restaurantId: a.id, productId: p.id, unitId, branchId: null, currency: 'IQD', amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
  }
  await makeBatch(a.id, b1, p.id, { buckets: { available: 100 } });
  const shift = await prisma().phShift.create({ data: { restaurantId: a.id, branchId: b1, userId: cashier.userId, currency: 'IQD', openingFloatMinor: 0n }, select: { id: true } });
  return { a, b1, owner, cashier, p, shiftId: shift.id };
}

const cart = (w: World, over: Record<string, unknown> = {}) => ({
  restaurantId: w.a.id,
  branchId: w.b1,
  clientKey: key('hold'),
  currency: 'IQD',
  lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 2, unitPriceMinor: 90n, discount: { kind: 'percent', value: 10 } }],
  invoiceDiscount: { kind: 'amount', value: 5n },
  ...over,
});

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld);
afterEach(() => {
  vi.setSystemTime(NOW);
});

describe('a held cart’s stored payload', () => {
  it('keeps the cart as entered and none of the place or key fields', async () => {
    const w = await world();
    const held = dataOf(await act(w.cashier, saleActions.hold, cart(w)));
    const row = await prisma().phSale.findUniqueOrThrow({ where: { id: held.id }, select: { holdPayload: true } });
    const payload = row.holdPayload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['currency', 'invoiceDiscount', 'lines', 'note']);
    expect(JSON.stringify(payload)).not.toContain(w.a.id);
    expect(JSON.stringify(payload)).not.toContain(w.b1);
    const resumed = dataOf(await act(w.cashier, saleActions.resume, { restaurantId: w.a.id, branchId: w.b1, saleId: held.id }));
    expect(resumed.invoiceDiscount).toEqual({ kind: 'amount', value: '5' });
    expect(resumed.lines[0]).toMatchObject({ productId: w.p.id, unitId: w.p.tablet, qty: 2, unitPriceMinor: '90', discount: { kind: 'percent', value: 10 }, tradeName: 'Panadol' });
  });

  it.each([
    ['lines that are not a list', { lines: 'oops' }],
    ['a line with no product', { lines: [{ unitId: 'x', qty: 1 }] }],
    ['a payload that is not an object', ['not', 'an', 'object']],
    ['an invoice discount that is not an object', { lines: [{ productId: 'p', unitId: 'u', qty: 1 }], invoiceDiscount: 7 }],
  ])('refuses to resume a corrupt one (%s) with a conflict, not a crash', async (_label, corrupt) => {
    const w = await world();
    const held = dataOf(await act(w.cashier, saleActions.hold, cart(w)));
    await prisma().phSale.update({ where: { id: held.id }, data: { holdPayload: corrupt as never } });
    const result = await act(w.cashier, saleActions.resume, { restaurantId: w.a.id, branchId: w.b1, saleId: held.id });
    expect([codeOf(result), phCodeOf(result)]).toEqual(['CONFLICT', 'HOLD_NOT_AVAILABLE']);
    // The hold itself is untouched: it can still be discarded.
    expect(codeOf(await act(w.cashier, saleActions.discardHold, { restaurantId: w.a.id, branchId: w.b1, saleId: held.id }))).toBe('OK');
  });

  it('still resumes a hold that has no payload (an older one) from its lines', async () => {
    const w = await world();
    const held = dataOf(await act(w.cashier, saleActions.hold, cart(w)));
    await prisma().phSale.update({ where: { id: held.id }, data: { holdPayload: null as never } });
    const resumed = dataOf(await act(w.cashier, saleActions.resume, { restaurantId: w.a.id, branchId: w.b1, saleId: held.id }));
    expect(resumed.lines).toHaveLength(1);
    expect(resumed.lines[0]).toMatchObject({ productId: w.p.id, unitId: w.p.tablet, qty: 2 });
  });
});

describe('the held-cart list', () => {
  it('shows 100 and says there are more when there are', async () => {
    const w = await world();
    const rows = Array.from({ length: 101 }, (_, i) => ({
      restaurantId: w.a.id,
      branchId: w.b1,
      shiftId: w.shiftId,
      status: 'HELD' as const,
      currency: 'IQD' as const,
      clientKey: `bulk-hold-${i}`,
      soldById: w.cashier.userId,
      heldUntil: new Date(NOW.getTime() + 3_600_000),
      createdAt: new Date(NOW.getTime() - i * 1000),
    }));
    await prisma().phSale.createMany({ data: rows });
    const full = dataOf(await ask(w.cashier, saleQueries.holds, { restaurantId: w.a.id, branchId: w.b1 }));
    expect(full.items).toHaveLength(100);
    expect(full.hasMore).toBe(true);
    await prisma().phSale.deleteMany({ where: { clientKey: 'bulk-hold-100' } });
    const exact = dataOf(await ask(w.cashier, saleQueries.holds, { restaurantId: w.a.id, branchId: w.b1 }));
    expect(exact.items).toHaveLength(100);
    expect(exact.hasMore).toBe(false);
  });
});

describe('a list cursor that names nothing', () => {
  it.each([
    ['shifts', (w: World) => ask(w.owner, shiftQueries.list, { restaurantId: w.a.id, cursor: 'not-a-real-id' })],
    ['sales', (w: World) => ask(w.owner, saleQueries.list, { restaurantId: w.a.id, cursor: 'not-a-real-id' })],
    ['returns', (w: World) => ask(w.owner, returnQueries.list, { restaurantId: w.a.id, cursor: 'not-a-real-id' })],
  ])('is INVALID on the %s list, not a database error', async (_name, call) => {
    const w = await world();
    const result = await call(w);
    expect(codeOf(result)).toBe('INVALID');
    if (!result.ok) expect(Object.keys(result.error.fields ?? {})).toContain('cursor');
  });

  it('still pages with a real cursor', async () => {
    const w = await world();
    await prisma().phShift.create({ data: { restaurantId: w.a.id, branchId: w.b1, userId: w.owner.userId, currency: 'IQD', status: 'CLOSED', closedAt: NOW, openedAt: new Date(NOW.getTime() - 1000) } });
    const first = dataOf(await ask(w.owner, shiftQueries.list, { restaurantId: w.a.id, pageSize: 1 }));
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = dataOf(await ask(w.owner, shiftQueries.list, { restaurantId: w.a.id, pageSize: 1, cursor: first.nextCursor }));
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
  });
});

describe('an inconsistent cash total', () => {
  afterEach(() => {
    inconsistent.on = false;
  });
  const place = (w: World) => ({ restaurantId: w.a.id, branchId: w.b1 });

  it('is CASH_NOT_CONSISTENT on close, paid in, paid out, the live shift and its report', async () => {
    const w = await world();
    inconsistent.on = true;
    const results = {
      close: await act(w.cashier, shiftActions.close, { ...place(w), shiftId: w.shiftId, countedMinor: 0n, reason: 'Counted by hand' }),
      paidIn: await act(w.cashier, shiftActions.paidIn, { ...place(w), amountMinor: 5n, reason: 'Change from the safe', clientKey: key('in') }),
      paidOut: await act(w.cashier, shiftActions.paidOut, { ...place(w), amountMinor: 5n, reason: 'Courier fee', clientKey: key('out') }),
      current: await ask(w.cashier, shiftQueries.current, place(w)),
      report: await ask(w.owner, shiftQueries.report, { ...place(w), shiftId: w.shiftId }),
    };
    for (const [name, result] of Object.entries(results)) {
      expect([name, codeOf(result), phCodeOf(result)], name).toEqual([name, 'CONFLICT', 'CASH_NOT_CONSISTENT']);
    }
    // Nothing was written by the refused calls.
    expect(await prisma().phCashMovement.count({ where: { shiftId: w.shiftId } })).toBe(0);
    expect((await prisma().phShift.findUniqueOrThrow({ where: { id: w.shiftId } })).status).toBe('OPEN');
  });

  it('is CASH_NOT_CONSISTENT on the replay of a paid out too', async () => {
    const w = await world();
    const k = key('out');
    dataOf(await act(w.cashier, shiftActions.paidIn, { ...place(w), amountMinor: 50n, reason: 'Change from the safe', clientKey: key('in') }));
    dataOf(await act(w.cashier, shiftActions.paidOut, { ...place(w), amountMinor: 5n, reason: 'Courier fee', clientKey: k }));
    inconsistent.on = true;
    const replay = await act(w.cashier, shiftActions.paidOut, { ...place(w), amountMinor: 5n, reason: 'Courier fee', clientKey: k });
    expect([codeOf(replay), phCodeOf(replay)]).toEqual(['CONFLICT', 'CASH_NOT_CONSISTENT']);
  });

  it('leaves a consistent drawer alone', async () => {
    const w = await world();
    expect(codeOf(await act(w.cashier, shiftActions.paidIn, { ...place(w), amountMinor: 50n, reason: 'Change from the safe', clientKey: key('in') }))).toBe('OK');
    expect(codeOf(await ask(w.cashier, shiftQueries.current, place(w)))).toBe('OK');
  });
});
