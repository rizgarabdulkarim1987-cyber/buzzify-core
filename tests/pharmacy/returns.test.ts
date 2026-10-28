import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as returnActions from '@/server/pharmacy/actions/returns';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as shiftActions from '@/server/pharmacy/actions/shifts';
import * as stockActions from '@/server/pharmacy/actions/stock';
import * as returnQueries from '@/server/pharmacy/queries/returns';
import * as saleQueries from '@/server/pharmacy/queries/sales';
import * as shiftQueries from '@/server/pharmacy/queries/shifts';
import { DAY, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, ask, balanceOf, codeOf, dataOf, makeBatch, makeProduct, phCodeOf } from './stock-helpers';

/**
 * Returns and cancels (phase 3, task 5): a return is limited to what was sold, goes to QUARANTINE of the same batch and
 * branch, refunds exactly what was paid net of change (the last return takes the rounding too), is made by a holder of
 * `return.approve` on their own open shift, and replays by key. A cancel is a full return of what remains.
 */

interface World {
  a: { id: string; branchId: string; branchIds: string[] };
  b1: string;
  b2: string;
  owner: Person;
  cashier: Person;
  manager: Person;
  pic: Person;
  accountant: Person;
  p: { id: string; tablet: string; strip: string };
}

let seq = 0;
const key = (label: string) => `${label}-${(seq += 1)}-${'x'.repeat(8)}`;

async function price(restaurantId: string, p: World['p'], currency: 'IQD' | 'USD', tablet: bigint, strip: bigint) {
  for (const [unitId, amountMinor] of [[p.tablet, tablet], [p.strip, strip]] as const) {
    await prisma().phPrice.create({ data: { restaurantId, productId: p.id, unitId, branchId: null, currency, amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
  }
}
const openShift = (restaurantId: string, branchId: string, who: Person, currency: 'IQD' | 'USD' = 'IQD') =>
  prisma().phShift.create({ data: { restaurantId, branchId, userId: who.userId, currency, openingFloatMinor: 0n }, select: { id: true } });

async function world(): Promise<World> {
  const a = await pharmacy('A', { branches: 2 });
  const [b1, b2] = a.branchIds as [string, string];
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [b1]] });
  const manager = await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [b1]] });
  const pic = await person('pic', { staff: [a.id, 'PHARMACIST_IN_CHARGE', [b1]] });
  const accountant = await person('accountant', { staff: [a.id, 'ACCOUNTANT', [b1]] });
  await prisma().phSettings.create({ data: { restaurantId: a.id } });
  const p = await makeProduct(a.id, 'Panadol');
  await price(a.id, p, 'IQD', 100n, 900n);
  for (const who of [owner, cashier, manager, pic]) await openShift(a.id, b1, who);
  await openShift(a.id, b2, owner);
  return { a, b1, b2, owner, cashier, manager, pic, accountant, p };
}

const stock = (w: World, over: { lot?: string; expiry?: string; status?: 'ACTIVE' | 'RECALLED' | 'BLOCKED'; available?: number; branchId?: string } = {}) =>
  makeBatch(w.a.id, over.branchId ?? w.b1, w.p.id, { lot: over.lot ?? 'L1', expiry: over.expiry ?? '2028-03-31', status: over.status ?? 'ACTIVE', buckets: { available: over.available ?? 100 } });

const cash = (amountMinor: bigint) => ({ method: 'CASH', amountMinor, clientKey: key('pay') });
const saleBody = (w: World, over: Record<string, unknown> = {}) => ({
  restaurantId: w.a.id,
  branchId: w.b1,
  clientKey: key('sale'),
  currency: 'IQD',
  lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 3 }],
  payments: [cash(300n)],
  ...over,
});
/** Sells (as the cashier unless told) and returns the sale with its first line and allocations. */
async function sell(w: World, over: Record<string, unknown> = {}, who: Person = w.cashier) {
  const made = dataOf(await act(who, saleActions.create, saleBody(w, over)));
  const row = await prisma().phSale.findUniqueOrThrow({
    where: { id: made.id },
    include: { lines: { orderBy: { lineNo: 'asc' }, include: { allocations: { orderBy: { id: 'asc' } } } } },
  });
  return { ...made, row, line: row.lines[0]!, allocation: row.lines[0]!.allocations[0]! };
}
const at = (w: World, branchId = w.b1) => ({ restaurantId: w.a.id, branchId });
const ret = (w: World, saleId: string, lines: unknown[], over: Record<string, unknown> = {}) => ({
  ...at(w),
  saleId,
  lines,
  reason: 'Customer changed their mind',
  clientKey: key('ret'),
  ...over,
});
const byLine = (lineId: string, baseQty: number) => ({ saleLineId: lineId, baseQty });
const returnedBase = async (allocationId: string) => (await prisma().phSaleLineAllocation.findUniqueOrThrow({ where: { id: allocationId } })).returnedBaseQty;
const statusOf = async (saleId: string) => (await prisma().phSale.findUniqueOrThrow({ where: { id: saleId } })).status;
const refundsOf = async (saleId: string) => (await prisma().phReturn.findMany({ where: { saleId }, orderBy: { createdAt: 'asc' } })).map((r) => r.refundMinor);
const sum = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n);
const counts = async () => ({
  returns: await prisma().phReturn.count(),
  lines: await prisma().phReturnLine.count(),
  movements: await prisma().phStockMovement.count({ where: { type: 'RETURN_QUARANTINE' } }),
  cash: await prisma().phCashMovement.count({ where: { type: 'REFUND_CASH' } }),
  audit: await prisma().auditLog.count({ where: { action: { in: ['ph.return.create', 'ph.sale.cancel'] } } }),
});
const ZERO = { returns: 0, lines: 0, movements: 0, cash: 0, audit: 0 };

/** Waits (bounded) until some backend of this database is waiting on a lock: the return queued behind the held shift row. */
async function untilBlockedOnALock(timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    // eslint-disable-next-line no-restricted-properties -- the test inspects the database's own lock waits, no tenant rows
    const rows = await prisma().$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if ((rows[0]?.n ?? 0n) > 0n) return;
    if (Date.now() > until) throw new Error('no backend ever waited on a lock');
    await new Promise((r) => setTimeout(r, 20));
  }
}

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

describe('a partial return', () => {
  it('quarantines the units of the same batch, refunds pro rata in cash on the approver’s shift, numbers it and audits it', async () => {
    const w = await world();
    const batch = await stock(w);
    const s = await sell(w);
    const made = dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
    expect(made).toMatchObject({ saleId: s.id, branchId: w.b1, currency: 'IQD', refundMinor: '100', refundMethod: 'CASH', saleStatus: 'RETURNED_PARTIAL', lineCount: 1, replayed: false });
    expect(made.number).toBe('R20261027-000001');

    const row = await prisma().phReturn.findUniqueOrThrow({ where: { id: made.id }, include: { lines: true } });
    const shift = await prisma().phShift.findFirstOrThrow({ where: { userId: w.manager.userId } });
    expect(row).toMatchObject({ saleId: s.id, branchId: w.b1, shiftId: shift.id, approvedById: w.manager.userId, refundMethod: 'CASH', refundMinor: 100n, currency: 'IQD', reason: 'Customer changed their mind' });
    expect(row.lines).toHaveLength(1);
    expect(row.lines[0]).toMatchObject({ saleLineAllocationId: s.allocation.id, baseQty: 1, refundMinor: 100n });

    expect(await balanceOf(batch, w.b1)).toEqual({ available: 97, reserved: 0, quarantine: 1, damaged: 0 });
    const movement = await prisma().phStockMovement.findFirstOrThrow({ where: { type: 'RETURN_QUARANTINE' } });
    expect(movement).toMatchObject({ batchId: batch, branchId: w.b1, quarantineDelta: 1, availableDelta: 0, refType: 'return', refId: row.lines[0]!.id, userId: w.manager.userId });

    const cashRows = await prisma().phCashMovement.findMany({ where: { type: 'REFUND_CASH' } });
    expect(cashRows.map((c) => [c.shiftId, c.amountMinor, c.currency, c.refType, c.refId, c.userId])).toEqual([[shift.id, -100n, 'IQD', 'return', made.id, w.manager.userId]]);

    expect(await returnedBase(s.allocation.id)).toBe(1);
    const sale = await prisma().phSale.findUniqueOrThrow({ where: { id: s.id } });
    expect(sale).toMatchObject({ status: 'RETURNED_PARTIAL', totalMinor: 300n, paidMinor: 300n, changeMinor: 0n });

    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.return.create' } });
    expect(audit.entityId).toBe(made.id);
    const text = JSON.stringify(audit.changes);
    expect(text).toContain('Customer changed their mind');
    expect(text).toContain('R20261027-000001');
    expect(Object.keys(audit.changes as object).filter((k) => /cost|customer|patient|name|phone/i.test(k))).toEqual([]);
  });

  it('also returns by allocation id, and spreads a line over its allocations in order', async () => {
    const w = await world();
    const b1 = await stock(w, { lot: 'L1', expiry: '2027-03-31', available: 5 });
    const b2 = await stock(w, { lot: 'L2', expiry: '2028-03-31', available: 50 });
    const s = await sell(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 12 }], payments: [cash(1200n)] });
    const allocs = s.row.lines[0]!.allocations;
    expect(allocs.map((a) => [a.batchId, a.baseQty]).sort()).toEqual([[b1, 5], [b2, 7]].sort());

    const first = dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [{ allocationId: allocs.find((a) => a.batchId === b2)!.id, baseQty: 2 }])));
    expect(first.refundMinor).toBe('200');
    expect(await balanceOf(b2, w.b1)).toMatchObject({ available: 50 - 7, quarantine: 2 });
    expect(await balanceOf(b1, w.b1)).toMatchObject({ available: 0, quarantine: 0 });

    // 8 more by line: 5 of them are what is left to return in total (12 - 2 = 10): take all 10 in one go.
    const second = dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 10)])));
    expect(second.saleStatus).toBe('RETURNED_FULL');
    expect(sum(await refundsOf(s.id))).toBe(1200n);
    for (const a of allocs) expect(await returnedBase(a.id)).toBe(a.baseQty);
    expect(await balanceOf(b1, w.b1)).toMatchObject({ quarantine: 5 });
    expect(await balanceOf(b2, w.b1)).toMatchObject({ quarantine: 7 });
    const lines = await prisma().phReturnLine.findMany({ where: { returnId: second.id } });
    expect(sum(lines.map((l) => l.refundMinor))).toBe(1000n);
  });

  it('numbers per branch per day', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    const one = dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
    const two = dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
    expect([one.number, two.number]).toEqual(['R20261027-000001', 'R20261027-000002']);
    vi.setSystemTime(new Date(NOW.getTime() + DAY));
    const three = dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
    expect(three.number).toBe('R20261028-000001');
  });

  it('keeps a batch that was recalled after the sale: the units still go to quarantine', async () => {
    const w = await world();
    const batch = await stock(w);
    const s = await sell(w);
    await prisma().phBatch.update({ where: { id: batch }, data: { status: 'RECALLED' } });
    dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 2)])));
    expect(await balanceOf(batch, w.b1)).toMatchObject({ available: 97, quarantine: 2 });
  });
});

describe('a full return', () => {
  it('refunds exactly the total over the returns and ends RETURNED_FULL', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 2)])));
    expect(await statusOf(s.id)).toBe('RETURNED_PARTIAL');
    const last = dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
    expect(last.saleStatus).toBe('RETURNED_FULL');
    expect(await refundsOf(s.id)).toEqual([200n, 100n]);
    expect(await statusOf(s.id)).toBe('RETURNED_FULL');
    const shift = await prisma().phShift.findFirstOrThrow({ where: { userId: w.manager.userId } });
    const cashTotal = sum((await prisma().phCashMovement.findMany({ where: { shiftId: shift.id, type: 'REFUND_CASH' } })).map((c) => c.amountMinor));
    expect(cashTotal).toBe(-300n);
  });

  it('refunds the net of change: an overpaid cash sale gives back the total, not the tendered amount', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w, { payments: [cash(1000n)] });
    expect(s.changeMinor).toBe('700');
    const r = dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 3)])));
    expect(r.refundMinor).toBe('300');
  });

  it('becomes sellable again only through the quarantine release', async () => {
    const w = await world();
    const batch = await stock(w, { available: 3 });
    const s = await sell(w);
    expect(await balanceOf(batch, w.b1)).toMatchObject({ available: 0 });
    dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 3)])));
    expect(await balanceOf(batch, w.b1)).toEqual({ available: 0, reserved: 0, quarantine: 3, damaged: 0 });
    const again = await act(w.cashier, saleActions.create, saleBody(w));
    expect(phCodeOf(again)).toBe('INSUFFICIENT_STOCK');

    dataOf(await act(w.manager, stockActions.quarantineRelease, { ...at(w), batchId: batch, decision: 'RESTOCK', baseQty: 3, reason: 'Sealed, in date' }));
    expect(await balanceOf(batch, w.b1)).toMatchObject({ available: 3, quarantine: 0 });
    dataOf(await act(w.cashier, saleActions.create, saleBody(w)));
    expect(await balanceOf(batch, w.b1)).toMatchObject({ available: 0 });
  });
});

describe('limits', () => {
  it('cannot return more than was sold, or more than is left after earlier returns', async () => {
    const w = await world();
    const batch = await stock(w);
    const s = await sell(w);
    const tooMany = await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 4)]));
    expect([codeOf(tooMany), phCodeOf(tooMany)]).toEqual(['CONFLICT', 'RETURN_LIMIT']);
    expect(await counts()).toEqual(ZERO);

    dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 2)])));
    const before = await counts();
    const beyond = await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 2)]));
    expect(phCodeOf(beyond)).toBe('RETURN_LIMIT');
    const viaAllocation = await act(w.manager, returnActions.create, ret(w, s.id, [{ allocationId: s.allocation.id, baseQty: 2 }]));
    expect(phCodeOf(viaAllocation)).toBe('RETURN_LIMIT');
    expect(await counts()).toEqual(before);
    expect(await returnedBase(s.allocation.id)).toBe(2);
    expect(await balanceOf(batch, w.b1)).toMatchObject({ quarantine: 2 });
  });

  it('adds up the same allocation named twice before judging the limit', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    const r = await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 2), { allocationId: s.allocation.id, baseQty: 2 }]));
    expect(phCodeOf(r)).toBe('RETURN_LIMIT');
    expect(await counts()).toEqual(ZERO);
  });

  it('refuses a sale that has nothing left, and a line or allocation of another sale', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    const other = await sell(w);
    dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 3)])));
    expect(phCodeOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])))).toBe('NOTHING_TO_RETURN');
    const foreignLine = await act(w.manager, returnActions.create, ret(w, other.id, [byLine(s.line.id, 1)]));
    expect(codeOf(foreignLine)).toBe('INVALID');
    const foreignAllocation = await act(w.manager, returnActions.create, ret(w, other.id, [{ allocationId: s.allocation.id, baseQty: 1 }]));
    expect(codeOf(foreignAllocation)).toBe('INVALID');
  });

  it('validates the input: a reason is required, a line names exactly one target, quantities are whole', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    const bad = async (over: Record<string, unknown>) => codeOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)], over)));
    expect(await bad({ reason: '' })).toBe('INVALID');
    expect(await bad({ reason: 'ab' })).toBe('INVALID');
    expect(await bad({ lines: [] })).toBe('INVALID');
    expect(await bad({ lines: [{ baseQty: 1 }] })).toBe('INVALID');
    expect(await bad({ lines: [{ saleLineId: s.line.id, allocationId: s.allocation.id, baseQty: 1 }] })).toBe('INVALID');
    expect(await bad({ lines: [{ saleLineId: s.line.id, baseQty: 0 }] })).toBe('INVALID');
    expect(await bad({ lines: [{ saleLineId: s.line.id, baseQty: 1.5 }] })).toBe('INVALID');
    expect(await bad({ refundMethod: 'CHEQUE' })).toBe('INVALID');
    expect(await bad({ clientKey: 'short' })).toBe('INVALID');
    expect(await counts()).toEqual(ZERO);
  });

  it('two parallel returns of the last unit: exactly one wins and the unit is quarantined once', async () => {
    const w = await world();
    const batch = await stock(w);
    const s = await sell(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 1 }], payments: [cash(100n)] });
    for (let round = 0; round < 3; round += 1) {
      const t = round === 0 ? s : await sell(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 1 }], payments: [cash(100n)] });
      const results = await Promise.all([
        act(w.manager, returnActions.create, ret(w, t.id, [byLine(t.line.id, 1)])),
        act(w.owner, returnActions.create, ret(w, t.id, [{ allocationId: t.allocation.id, baseQty: 1 }])),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const loser = results.find((r) => !r.ok)!;
      expect(['RETURN_LIMIT', 'NOTHING_TO_RETURN']).toContain(phCodeOf(loser));
      expect(await returnedBase(t.allocation.id)).toBe(1);
      expect(await refundsOf(t.id)).toEqual([100n]);
      expect(await statusOf(t.id)).toBe('RETURNED_FULL');
    }
    expect(await balanceOf(batch, w.b1)).toMatchObject({ quarantine: 3 });
    expect((await counts()).movements).toBe(3);
  });

  it('parallel partial returns of one sale never refund more than the total', async () => {
    const w = await world();
    await stock(w);
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { roundingStepMinor: 250n } });
    const s = await sell(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 7 }], payments: [cash(1000n)] });
    expect(s.totalMinor).toBe('750');
    const results = await Promise.all(Array.from({ length: 7 }, (_, i) => act(i % 2 ? w.owner : w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)]))));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(sum(await refundsOf(s.id))).toBe(750n);
    expect(await statusOf(s.id)).toBe('RETURNED_FULL');
  });
});

describe('refunds', () => {
  it('a sale rounded down: the partial refunds follow the lines and the last one closes the total exactly', async () => {
    const w = await world();
    await stock(w);
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { roundingStepMinor: 250n } });
    const s = await sell(w, { payments: [cash(250n)] });
    expect(s).toMatchObject({ subtotalMinor: '300', roundingMinor: '-50', totalMinor: '250' });
    for (const n of [1, 1, 1]) dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, n)])));
    const refunds = await refundsOf(s.id);
    expect(refunds).toEqual([100n, 100n, 50n]);
    expect(sum(refunds)).toBe(250n);
  });

  it('a sale rounded up: the last return gives back the rounding too', async () => {
    const w = await world();
    await stock(w);
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { roundingStepMinor: 250n } });
    const s = await sell(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 7 }], payments: [cash(750n)] });
    expect(s).toMatchObject({ subtotalMinor: '700', roundingMinor: '50', totalMinor: '750' });
    let running = 0n;
    for (let i = 0; i < 7; i += 1) {
      const r = dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
      running += BigInt(r.refundMinor);
      expect(running <= 750n).toBe(true);
    }
    const refunds = await refundsOf(s.id);
    expect(refunds.slice(0, 6)).toEqual([100n, 100n, 100n, 100n, 100n, 100n]);
    expect(refunds[6]).toBe(150n);
    expect(sum(refunds)).toBe(750n);
  });

  it('a discounted sale with a line that does not divide evenly sums exactly to the total', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w, {
      lines: [{ productId: w.p.id, unitId: w.p.strip, qty: 1 }],
      invoiceDiscount: { kind: 'amount', value: 1n },
      payments: [cash(899n)],
    });
    expect(s.totalMinor).toBe('899');
    for (let i = 0; i < 10; i += 1) dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
    expect(sum(await refundsOf(s.id))).toBe(899n);
    expect(await statusOf(s.id)).toBe('RETURNED_FULL');
  });

  it('refunds by the method the sale was paid with: a card sale gives no cash movement, a cash refund of it is refused', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w, { payments: [{ method: 'CARD_MANUAL', amountMinor: 300n, reference: 'slip 1', clientKey: key('pay') }] });
    const asCash = await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)], { refundMethod: 'CASH' }));
    expect([codeOf(asCash), phCodeOf(asCash)]).toEqual(['CONFLICT', 'REFUND_METHOD_NOT_PAID']);
    expect(await counts()).toEqual(ZERO);
    const made = dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
    expect(made).toMatchObject({ refundMethod: 'CARD_MANUAL', refundMinor: '100' });
    expect((await counts()).cash).toBe(0);
  });

  it('a cash sale refunded by card is refused, and a mixed sale can be refunded by either method', async () => {
    const w = await world();
    await stock(w);
    const cashSale = await sell(w);
    expect(phCodeOf(await act(w.manager, returnActions.create, ret(w, cashSale.id, [byLine(cashSale.line.id, 1)], { refundMethod: 'TRANSFER_MANUAL' })))).toBe('REFUND_METHOD_NOT_PAID');
    const mixed = await sell(w, { payments: [cash(100n), { method: 'TRANSFER_MANUAL', amountMinor: 200n, reference: 'ref', clientKey: key('pay') }] });
    const viaCash = dataOf(await act(w.manager, returnActions.create, ret(w, mixed.id, [byLine(mixed.line.id, 1)], { refundMethod: 'CASH' })));
    expect(viaCash.refundMethod).toBe('CASH');
    const dflt = dataOf(await act(w.manager, returnActions.create, ret(w, mixed.id, [byLine(mixed.line.id, 1)])));
    expect(dflt.refundMethod).toBe('TRANSFER_MANUAL');
  });
});

describe('cash and refund arithmetic end to end (independent hand figures)', () => {
  it('the shift identity: float + cash paid - change - refund + paid in - paid out = expected = what the report and the close say', async () => {
    const w = await world();
    await stock(w);
    const till = await person('till', { staff: [w.a.id, 'BRANCH_MANAGER', [w.b1]] });
    const opened = dataOf(await act(till, shiftActions.open, { ...at(w), currency: 'IQD', openingFloatMinor: 5000n, clientKey: key('open') }));

    // 7 tablets at 100 = 700, paid 1000 in cash, 300 given back.
    const made = dataOf(await act(till, saleActions.create, saleBody(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 7 }], payments: [cash(1000n)] })));
    expect(made).toMatchObject({ totalMinor: '700', paidMinor: '1000', changeMinor: '300' });
    const line = (await prisma().phSaleLine.findFirstOrThrow({ where: { saleId: made.id } })).id;
    // 3 of them come back: 300.
    expect(dataOf(await act(till, returnActions.create, ret(w, made.id, [byLine(line, 3)]))).refundMinor).toBe('300');
    dataOf(await act(till, shiftActions.paidIn, { ...at(w), amountMinor: 400n, reason: 'Change from the safe', clientKey: key('in') }));
    dataOf(await act(till, shiftActions.paidOut, { ...at(w), amountMinor: 250n, reason: 'Courier fee', clientKey: key('out') }));

    // 5000 + 1000 - 300 - 300 + 400 - 250
    const expected = 5550n;
    const report = dataOf(await ask(till, shiftQueries.report, { ...at(w), shiftId: opened.id })) as { totals: object };
    expect(report.totals).toMatchObject({
      openingFloatMinor: '5000',
      expectedMinor: String(expected),
      cash: { tenderedMinor: '1000', changeMinor: '300', refundsMinor: '300', paidInMinor: '400', paidOutMinor: '250' },
      returns: { count: 1, refundMinor: '300' },
    });
    const closed = dataOf(await act(till, shiftActions.close, { ...at(w), shiftId: opened.id, countedMinor: expected }));
    expect(closed).toMatchObject({ status: 'CLOSED', expectedMinor: '5550', countedMinor: '5550', varianceMinor: '0' });
  });

  it('a 50% invoice discount with a rounding step: line by line returns, an uneven split, and the last return takes the rounding', async () => {
    const w = await world();
    await stock(w);
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { roundingStepMinor: 250n } });
    // 4 tablets (400) + 1 strip (900, ten base units) = 1300; 50% off = 650 off; split 200 + 450; 650 rounds to 750 (+100).
    const s = await sell(
      w,
      { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 4 }, { productId: w.p.id, unitId: w.p.strip, qty: 1 }], invoiceDiscount: { kind: 'percent', value: 50, reason: 'Staff discount' }, payments: [cash(750n)] },
      w.manager,
    );
    expect(s).toMatchObject({ subtotalMinor: '1300', discountMinor: '650', roundingMinor: '100', totalMinor: '750' });
    const [tab, strip] = s.row.lines;
    expect([tab!.totalMinor, strip!.totalMinor, strip!.baseQty]).toEqual([200n, 450n, 10]);

    // Per unit: tablet 200 / 4 = 50, strip 450 / 10 = 45.
    const plan: [string, number, bigint][] = [
      [tab!.id, 2, 100n], //   2 * 50
      [strip!.id, 4, 180n], // 4 * 45
      [tab!.id, 2, 100n], //   the tablet line is done
      [strip!.id, 6, 370n], // 6 * 45 = 270, plus the 100 of rounding: 750 - 380
    ];
    const lineStored: bigint[] = [];
    let running = 0n;
    for (const [lineId, n, refund] of plan) {
      const r = dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(lineId, n)])));
      expect(r.refundMinor).toBe(String(refund));
      running += refund;
      const lines = await prisma().phReturnLine.findMany({ where: { returnId: r.id } });
      lineStored.push(sum(lines.map((l) => l.refundMinor)));
    }
    expect(lineStored).toEqual([100n, 180n, 100n, 270n]);
    expect(await refundsOf(s.id)).toEqual([100n, 180n, 100n, 370n]);
    expect(running).toBe(750n);
    // Stored line refunds leave the rounding out: 650 = 750 - 100.
    expect(sum(lineStored)).toBe(650n);
    expect(await statusOf(s.id)).toBe('RETURNED_FULL');
  });
});

describe('who may return, and when', () => {
  it('refuses a cashier, and a role without return.approve, and writes nothing', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    expect(codeOf(await act(w.cashier, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])))).toBe('FORBIDDEN');
    expect(codeOf(await act(w.accountant, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])))).toBe('FORBIDDEN');
    expect(codeOf(await act(w.cashier, returnActions.cancel, { ...at(w), saleId: s.id, reason: 'Wrong sale', clientKey: key('cancel') }))).toBe('FORBIDDEN');
    expect(await counts()).toEqual(ZERO);
    expect(await statusOf(s.id)).toBe('COMPLETED');
  });

  it('inside the window any approver returns; after it only the owner and a branch manager do', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 4 }], payments: [cash(400n)] });
    // The window edge: exactly 30 days old is inside.
    await prisma().phSale.update({ where: { id: s.id }, data: { completedAt: new Date(NOW.getTime() - 30 * DAY) } });
    dataOf(await act(w.pic, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));

    await prisma().phSale.update({ where: { id: s.id }, data: { completedAt: new Date(NOW.getTime() - 30 * DAY - 1000) } });
    const late = await act(w.pic, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)]));
    expect([codeOf(late), phCodeOf(late)]).toEqual(['FORBIDDEN', 'RETURN_WINDOW_PASSED']);
    expect(await returnedBase(s.allocation.id)).toBe(1);
    dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
    dataOf(await act(w.owner, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)], { clientKey: key('own') })));
    expect(await returnedBase(s.allocation.id)).toBe(3);
  });

  it('uses the pharmacy’s returnWindowDays setting', async () => {
    const w = await world();
    await stock(w);
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { returnWindowDays: 2 } });
    const s = await sell(w);
    await prisma().phSale.update({ where: { id: s.id }, data: { completedAt: new Date(NOW.getTime() - 3 * DAY) } });
    expect(phCodeOf(await act(w.pic, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])))).toBe('RETURN_WINDOW_PASSED');
    await prisma().phSale.update({ where: { id: s.id }, data: { completedAt: new Date(NOW.getTime() - 1 * DAY) } });
    dataOf(await act(w.pic, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
  });

  it('the window rule applies to a cancel as well', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    await prisma().phSale.update({ where: { id: s.id }, data: { completedAt: new Date(NOW.getTime() - 40 * DAY) } });
    expect(phCodeOf(await act(w.pic, returnActions.cancel, { ...at(w), saleId: s.id, reason: 'Old sale', clientKey: key('cancel') }))).toBe('RETURN_WINDOW_PASSED');
    expect((await act(w.manager, returnActions.cancel, { ...at(w), saleId: s.id, reason: 'Old sale', clientKey: key('cancel') })).ok).toBe(true);
  });

  it('refuses a sale of another branch, a held sale, and a sale of another business', async () => {
    const w = await world();
    await stock(w);
    await stock(w, { branchId: w.b2, lot: 'L2' });
    const s = await sell(w);
    // The owner works in both branches: naming branch 2 for a branch 1 sale finds no such sale.
    const wrongBranch = await act(w.owner, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)], at(w, w.b2)));
    expect(codeOf(wrongBranch)).toBe('NOT_FOUND');
    // The branch-1 manager cannot reach branch 2 at all.
    expect(codeOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)], at(w, w.b2))))).toBe('FORBIDDEN');

    const shift = await prisma().phShift.findFirstOrThrow({ where: { userId: w.cashier.userId } });
    const held = await prisma().phSale.create({
      data: { restaurantId: w.a.id, branchId: w.b1, shiftId: shift.id, status: 'HELD', currency: 'IQD', clientKey: key('held'), soldById: w.cashier.userId },
      select: { id: true },
    });
    const heldTry = await act(w.manager, returnActions.create, ret(w, held.id, [byLine('whatever', 1)]));
    expect([codeOf(heldTry), phCodeOf(heldTry)]).toEqual(['CONFLICT', 'SALE_NOT_RETURNABLE']);
    expect(phCodeOf(await act(w.manager, returnActions.cancel, { ...at(w), saleId: held.id, reason: 'Held one', clientKey: key('cancel') }))).toBe('SALE_NOT_RETURNABLE');

    const b = await pharmacy('B');
    const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
    await openShift(b.id, b.branchId, ownerB);
    const missing = await act(ownerB, returnActions.create, { restaurantId: b.id, branchId: b.branchId, saleId: s.id, lines: [byLine(s.line.id, 1)], reason: 'Planted', clientKey: key('ret') });
    expect(codeOf(missing)).toBe('NOT_FOUND');
    expect(await counts()).toEqual(ZERO);
  });

  it('needs the approver’s own open shift in the branch, for a cash and a non-cash refund', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    const card = await sell(w, { payments: [{ method: 'CARD_MANUAL', amountMinor: 300n, reference: 'slip', clientKey: key('pay') }] });
    await prisma().phShift.updateMany({ where: { userId: w.manager.userId }, data: { status: 'CLOSED', closedAt: NOW, countedMinor: 0n, expectedMinor: 0n, varianceMinor: 0n } });
    for (const [sale, line] of [[s.id, s.line.id], [card.id, card.line.id]] as const) {
      const r = await act(w.manager, returnActions.create, ret(w, sale, [byLine(line, 1)]));
      expect([codeOf(r), phCodeOf(r)]).toEqual(['CONFLICT', 'NO_OPEN_SHIFT']);
    }
    expect(await counts()).toEqual(ZERO);
    expect(await returnedBase(s.allocation.id)).toBe(0);
    expect(await statusOf(s.id)).toBe('COMPLETED');
  });

  it('needs the approver’s shift to be in the sale’s currency', async () => {
    const w = await world();
    await stock(w);
    await price(w.a.id, w.p, 'USD', 150n, 1350n);
    const usd = await person('usd', { staff: [w.a.id, 'CASHIER', [w.b1]] });
    await openShift(w.a.id, w.b1, usd, 'USD');
    const s = await sell(w, { currency: 'USD', lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 2 }], payments: [cash(300n)] }, usd);
    const r = await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)]));
    expect([codeOf(r), phCodeOf(r)]).toEqual(['CONFLICT', 'SHIFT_CURRENCY']);
    expect(await counts()).toEqual(ZERO);
    // A USD approver can: the refund is in USD and lands in the USD shift.
    const usdManager = await person('usdManager', { staff: [w.a.id, 'BRANCH_MANAGER', [w.b1]] });
    const usdShift = await openShift(w.a.id, w.b1, usdManager, 'USD');
    const ok = dataOf(await act(usdManager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
    expect(ok).toMatchObject({ currency: 'USD', refundMinor: '150' });
    const rows = await prisma().phCashMovement.findMany({ where: { type: 'REFUND_CASH' } });
    expect(rows.map((c) => [c.shiftId, c.amountMinor, c.currency])).toEqual([[usdShift.id, -150n, 'USD']]);
  });

  it('cannot post a refund into a shift that closed meanwhile (the shift row is held first)', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    const shift = await prisma().phShift.findFirstOrThrow({ where: { userId: w.manager.userId } });
    // A close in progress holds the row FOR UPDATE; the return waits for it, then finds the shift closed.
    let pending: ReturnType<typeof act> | undefined;
    await prisma().$transaction(async (tx) => {
      // eslint-disable-next-line no-restricted-properties -- the test plays a shift close holding the row
      await tx.$queryRaw`SELECT "id" FROM "PhShift" WHERE "id" = ${shift.id} FOR UPDATE`;
      pending = act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)]));
      await untilBlockedOnALock();
      await tx.phShift.update({ where: { id: shift.id }, data: { status: 'CLOSED', closedAt: NOW, countedMinor: 0n, expectedMinor: 0n, varianceMinor: 0n } });
    });
    const holder = await pending!;
    expect(phCodeOf(holder)).toBe('NO_OPEN_SHIFT');
    expect(await counts()).toEqual(ZERO);
  });
});

describe('replay', () => {
  it('returns the stored return for the same key and request, without a second return, movement or refund', async () => {
    const w = await world();
    const batch = await stock(w);
    const s = await sell(w);
    const body = ret(w, s.id, [byLine(s.line.id, 1)]);
    const first = dataOf(await act(w.manager, returnActions.create, body));
    const again = dataOf(await act(w.manager, returnActions.create, body));
    expect(again).toMatchObject({ id: first.id, number: first.number, refundMinor: '100', replayed: true });
    expect(first.replayed).toBe(false);
    expect(await counts()).toEqual({ returns: 1, lines: 1, movements: 1, cash: 1, audit: 1 });
    expect(await balanceOf(batch, w.b1)).toMatchObject({ quarantine: 1 });
  });

  it('refuses the key for another request, another approver, or another sale', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    const other = await sell(w);
    const body = ret(w, s.id, [byLine(s.line.id, 1)]);
    dataOf(await act(w.manager, returnActions.create, body));
    const mismatch = async (who: Person, over: Record<string, unknown>) => {
      const r = await act(who, returnActions.create, { ...body, ...over });
      return [codeOf(r), phCodeOf(r)];
    };
    expect(await mismatch(w.manager, { lines: [byLine(s.line.id, 2)] })).toEqual(['CONFLICT', 'CLIENT_KEY_MISMATCH']);
    expect(await mismatch(w.manager, { reason: 'Another reason' })).toEqual(['CONFLICT', 'CLIENT_KEY_MISMATCH']);
    expect(await mismatch(w.manager, { refundMethod: 'CASH' })).toEqual(['CONFLICT', 'CLIENT_KEY_MISMATCH']);
    expect(await mismatch(w.owner, {})).toEqual(['CONFLICT', 'CLIENT_KEY_MISMATCH']);
    expect(await mismatch(w.manager, { saleId: other.id, lines: [byLine(other.line.id, 1)] })).toEqual(['CONFLICT', 'CLIENT_KEY_MISMATCH']);
    expect((await counts()).returns).toBe(1);
  });

  it('a return key cannot replay as a cancel, nor a cancel as a return', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    const k = key('shared');
    dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 3)], { clientKey: k })));
    const r = await act(w.manager, returnActions.cancel, { ...at(w), saleId: s.id, reason: 'Customer changed their mind', clientKey: k });
    expect(phCodeOf(r)).toBe('CLIENT_KEY_MISMATCH');
  });

  it('parallel repeats of one key produce one return', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    const body = ret(w, s.id, [byLine(s.line.id, 1)]);
    const results = await Promise.all([1, 2, 3, 4].map(() => act(w.manager, returnActions.create, body)));
    const ok = results.map((r) => dataOf(r));
    expect(new Set(ok.map((r) => r.id)).size).toBe(1);
    expect(ok.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await counts()).toEqual({ returns: 1, lines: 1, movements: 1, cash: 1, audit: 1 });
  });
});

describe('cancel', () => {
  it('is a full return of every remaining line in one transaction', async () => {
    const w = await world();
    const batch = await stock(w);
    const s = await sell(w, {
      lines: [
        { productId: w.p.id, unitId: w.p.tablet, qty: 3 },
        { productId: w.p.id, unitId: w.p.strip, qty: 2 },
      ],
      payments: [cash(2100n)],
    });
    expect(s.totalMinor).toBe('2100');
    const made = dataOf(await act(w.manager, returnActions.cancel, { ...at(w), saleId: s.id, reason: 'Sold by mistake', clientKey: key('cancel') }));
    expect(made).toMatchObject({ saleId: s.id, refundMinor: '2100', saleStatus: 'RETURNED_FULL', replayed: false });
    expect(made.number).toBe('R20261027-000001');
    expect(await statusOf(s.id)).toBe('RETURNED_FULL');
    expect(await balanceOf(batch, w.b1)).toEqual({ available: 77, reserved: 0, quarantine: 23, damaged: 0 });
    const lines = await prisma().phReturnLine.findMany({ where: { returnId: made.id } });
    expect(lines).toHaveLength(2);
    expect(sum(lines.map((l) => l.refundMinor))).toBe(2100n);
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.sale.cancel' } });
    expect(audit.entityId).toBe(s.id);
    expect(JSON.stringify(audit.changes)).toContain('Sold by mistake');
  });

  it('after a partial return refunds and returns only what remains; a second cancel finds nothing', async () => {
    const w = await world();
    const batch = await stock(w);
    const s = await sell(w);
    dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
    const made = dataOf(await act(w.manager, returnActions.cancel, { ...at(w), saleId: s.id, reason: 'Rest of it', clientKey: key('cancel') }));
    expect(made.refundMinor).toBe('200');
    expect(sum(await refundsOf(s.id))).toBe(300n);
    expect(await balanceOf(batch, w.b1)).toMatchObject({ quarantine: 3 });
    const none = await act(w.manager, returnActions.cancel, { ...at(w), saleId: s.id, reason: 'Again', clientKey: key('cancel') });
    expect([codeOf(none), phCodeOf(none)]).toEqual(['CONFLICT', 'NOTHING_TO_RETURN']);
  });

  it('refunds a rounded sale exactly and replays by key', async () => {
    const w = await world();
    await stock(w);
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { roundingStepMinor: 250n } });
    const s = await sell(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 7 }], payments: [cash(750n)] });
    const body = { ...at(w), saleId: s.id, reason: 'Cancelled', clientKey: key('cancel') };
    const made = dataOf(await act(w.manager, returnActions.cancel, body));
    expect(made.refundMinor).toBe('750');
    const again = dataOf(await act(w.manager, returnActions.cancel, body));
    expect(again).toMatchObject({ id: made.id, replayed: true });
    expect((await counts()).returns).toBe(1);
  });

  it('needs a reason', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    expect(codeOf(await act(w.manager, returnActions.cancel, { ...at(w), saleId: s.id, reason: '', clientKey: key('cancel') }))).toBe('INVALID');
    expect(await counts()).toEqual(ZERO);
  });
});

describe('reading returns', () => {
  it('lists what can still be returned, with the preview, the window and the lot and expiry, and never a cost', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
    const r = dataOf(await ask(w.manager, returnQueries.returnable, { ...at(w), saleId: s.id }));
    expect(r).toMatchObject({ saleId: s.id, number: s.number, status: 'RETURNED_PARTIAL', currency: 'IQD', totalMinor: '300', refundedMinor: '100', window: { withinWindow: true, days: 30, needsManager: false } });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ lineNo: 1, soldBaseQty: 3, returnedBaseQty: 1, remainingBaseQty: 2, unitPriceMinor: '100', refundPerUnitPreviewMinor: '100', unitLabel: 'tablet' });
    expect(r.lines[0]!.allocations[0]).toMatchObject({ id: s.allocation.id, lot: 'L1', expiryDate: '2028-03-31', soldBaseQty: 3, returnedBaseQty: 1, remainingBaseQty: 2 });
    expect(JSON.stringify(r)).not.toMatch(/cost/i);
  });

  it('says a late sale needs a manager, and tells a manager they may', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    await prisma().phSale.update({ where: { id: s.id }, data: { completedAt: new Date(NOW.getTime() - 45 * DAY) } });
    const asPic = dataOf(await ask(w.pic, returnQueries.returnable, { ...at(w), saleId: s.id }));
    expect(asPic.window).toMatchObject({ withinWindow: false, needsManager: true, mayOverride: false });
    const asManager = dataOf(await ask(w.manager, returnQueries.returnable, { ...at(w), saleId: s.id }));
    expect(asManager.window).toMatchObject({ withinWindow: false, needsManager: true, mayOverride: true });
  });

  it('gets one return with its lines (lot, expiry, product), and lists them newest first, scoped', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    const one = dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
    const two = dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 2)])));
    const got = dataOf(await ask(w.manager, returnQueries.get, { ...at(w), returnId: one.id }));
    expect(got).toMatchObject({ id: one.id, number: one.number, saleId: s.id, saleNumber: s.number, refundMinor: '100', refundMethod: 'CASH', reason: 'Customer changed their mind', approvedById: w.manager.userId });
    expect(got.lines[0]).toMatchObject({ productName: 'Panadol', lot: 'L1', expiryDate: '2028-03-31', baseQty: 1, refundMinor: '100' });
    expect(JSON.stringify(got)).not.toMatch(/cost/i);

    const list = dataOf(await ask(w.manager, returnQueries.list, at(w)));
    expect(list.items.map((x) => x.id)).toEqual([two.id, one.id]);
    expect(list.items[0]).toMatchObject({ number: two.number, saleId: s.id, refundMinor: '200', lineCount: 1 });
    const bySale = dataOf(await ask(w.accountant, returnQueries.list, { ...at(w), saleId: s.id, pageSize: 1 }));
    expect(bySale.items).toHaveLength(1);
    expect(bySale.nextCursor).toBe(two.id);
    const page2 = dataOf(await ask(w.accountant, returnQueries.list, { ...at(w), saleId: s.id, pageSize: 1, cursor: bySale.nextCursor }));
    expect(page2.items.map((x) => x.id)).toEqual([one.id]);
    expect(page2.nextCursor).toBeNull();
  });

  it('keeps a cashier out, and another branch and another business unseen', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    const made = dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
    for (const def of [returnQueries.list, returnQueries.get, returnQueries.returnable]) {
      const input = def === returnQueries.list ? at(w) : def === returnQueries.get ? { ...at(w), returnId: made.id } : { ...at(w), saleId: s.id };
      expect(codeOf(await ask(w.cashier, def as never, input))).toBe('FORBIDDEN');
    }
    expect(codeOf(await ask(w.owner, returnQueries.get, { ...at(w, w.b2), returnId: made.id }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(w.owner, returnQueries.returnable, { ...at(w, w.b2), saleId: s.id }))).toBe('NOT_FOUND');
    expect(dataOf(await ask(w.owner, returnQueries.list, at(w, w.b2))).items).toEqual([]);
    const b = await pharmacy('B');
    const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
    expect(codeOf(await ask(ownerB, returnQueries.get, { restaurantId: b.id, branchId: b.branchId, returnId: made.id }))).toBe('NOT_FOUND');
  });

  it('shows the sale as returned in the sales reads', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
    const got = dataOf(await ask(w.manager, saleQueries.get, { ...at(w), saleId: s.id }));
    expect(got).toMatchObject({ status: 'RETURNED_PARTIAL', totalMinor: '300', paidMinor: '300' });
    expect(got.lines[0]!.allocations[0]).toMatchObject({ returnedBaseQty: 1 });
  });
});

describe('the refund preview (read-only) and the payment methods of a sale', () => {
  it('previews exactly what the return then refunds, every step of an uneven discounted sale, and writes nothing', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w, { lines: [{ productId: w.p.id, unitId: w.p.strip, qty: 1 }], invoiceDiscount: { kind: 'amount', value: 1n }, payments: [cash(899n)] });
    const before = await counts();
    for (let i = 0; i < 10; i += 1) {
      const shown = dataOf(await ask(w.manager, returnQueries.preview, { ...at(w), saleId: s.id, lines: [byLine(s.line.id, 1)] }));
      const made = dataOf(await act(w.manager, returnActions.create, ret(w, s.id, [byLine(s.line.id, 1)])));
      expect(shown.refundMinor).toBe(made.refundMinor);
      expect(shown.currency).toBe('IQD');
      expect(shown.isFinal).toBe(i === 9);
    }
    expect(before.returns).toBe(0);
    // Several lines' worth in one go equals what a real return of the same quantities gives.
    const t = await sell(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 3 }], payments: [cash(300n)] });
    const shown = dataOf(await ask(w.manager, returnQueries.preview, { ...at(w), saleId: t.id, lines: [byLine(t.line.id, 2)] }));
    expect(shown.refundMinor).toBe('200');
    expect(dataOf(await act(w.manager, returnActions.create, ret(w, t.id, [byLine(t.line.id, 2)]))).refundMinor).toBe('200');
  });

  it('refuses a cashier, more than remains, a line of another sale and a sale of another branch; writes nothing', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w);
    const other = await sell(w);
    const zero = await counts();
    expect(codeOf(await ask(w.cashier, returnQueries.preview, { ...at(w), saleId: s.id, lines: [byLine(s.line.id, 1)] }))).toBe('FORBIDDEN');
    const over = await ask(w.manager, returnQueries.preview, { ...at(w), saleId: s.id, lines: [byLine(s.line.id, 4)] });
    expect(phCodeOf(over)).toBe('RETURN_LIMIT');
    expect(codeOf(await ask(w.manager, returnQueries.preview, { ...at(w), saleId: s.id, lines: [byLine(other.line.id, 1)] }))).toBe('INVALID');
    expect(codeOf(await ask(w.owner, returnQueries.preview, { ...at(w, w.b2), saleId: s.id, lines: [byLine(s.line.id, 1)] }))).toBe('NOT_FOUND');
    expect(await counts()).toEqual(zero);
  });

  it('the sales list and detail name the methods the sale was paid with', async () => {
    const w = await world();
    await stock(w);
    const s = await sell(w, { payments: [{ method: 'CASH', amountMinor: 100n, clientKey: key('pay') }, { method: 'CARD_MANUAL', amountMinor: 200n, clientKey: key('pay') }] });
    const list = dataOf(await ask(w.manager, saleQueries.list, { ...at(w) }));
    expect([...list.items.find((x: { id: string }) => x.id === s.id)!.methods].sort()).toEqual(['CARD_MANUAL', 'CASH']);
    const one = dataOf(await ask(w.manager, saleQueries.get, { ...at(w), saleId: s.id }));
    expect([...one.methods].sort()).toEqual(['CARD_MANUAL', 'CASH']);
  });
});
