import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_AMOUNT_MINOR } from '@/server/domain/pharmacy/sale';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as shiftActions from '@/server/pharmacy/actions/shifts';
import * as shiftQueries from '@/server/pharmacy/queries/shifts';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, ask, codeOf, dataOf, makeBatch, makeProduct, phCodeOf } from './stock-helpers';

/**
 * Shifts and cash (phase 3, task 4): one OPEN shift per user and branch, paid in and out, the close with its expected
 * cash, variance, reason and approval rules, the race between a close and a sale, and the shift report.
 */

interface World {
  a: { id: string; branchId: string; branchIds: string[] };
  b1: string;
  b2: string;
  owner: Person;
  manager: Person;
  /** A branch manager of branch 2 only. */
  manager2: Person;
  cashier: Person;
  cashier2: Person;
  pharmacist: Person;
  accountant: Person;
  stockClerk: Person;
  p: { id: string; tablet: string; strip: string };
  other: { id: string; branchId: string; owner: Person };
}

let seq = 0;
const key = (label: string) => `${label}-${(seq += 1)}-${'x'.repeat(8)}`;

async function world(settings: { limit?: bigint } = {}): Promise<World> {
  const a = await pharmacy('A', { branches: 2 });
  const [b1, b2] = a.branchIds as [string, string];
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const manager = await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [b1]] });
  const manager2 = await person('manager2', { staff: [a.id, 'BRANCH_MANAGER', [b2]] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [b1]] });
  const cashier2 = await person('cashier2', { staff: [a.id, 'CASHIER', [b1]] });
  const pharmacist = await person('pharmacist', { staff: [a.id, 'PHARMACIST', [b1]] });
  const accountant = await person('accountant', { staff: [a.id, 'ACCOUNTANT', [b1]] });
  const stockClerk = await person('stockclerk', { staff: [a.id, 'STOCK', [b1]] });
  await prisma().phSettings.create({ data: { restaurantId: a.id, shiftVarianceLimitMinor: settings.limit ?? 0n } });
  const p = await makeProduct(a.id, 'Panadol');
  for (const [unitId, amountMinor] of [[p.tablet, 100n], [p.strip, 900n]] as const) {
    await prisma().phPrice.create({ data: { restaurantId: a.id, productId: p.id, unitId, branchId: null, currency: 'IQD', amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
  }
  await makeBatch(a.id, b1, p.id, { lot: 'L1', buckets: { available: 1000 } });
  const b = await pharmacy('B');
  const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
  return { a, b1, b2, owner, manager, manager2, cashier, cashier2, pharmacist, accountant, stockClerk, p, other: { id: b.id, branchId: b.branchId, owner: ownerB } };
}

const open = (w: World, who: Person, over: Record<string, unknown> = {}) =>
  act(who, shiftActions.open, { restaurantId: w.a.id, branchId: w.b1, currency: 'IQD', openingFloatMinor: 0n, clientKey: key('open'), ...over });
const opened = async (w: World, who: Person, float = 0n, over: Record<string, unknown> = {}) => dataOf(await open(w, who, { openingFloatMinor: float, ...over })).id;
const paidIn = (w: World, who: Person, amountMinor: bigint, over: Record<string, unknown> = {}) =>
  act(who, shiftActions.paidIn, { restaurantId: w.a.id, branchId: w.b1, amountMinor, reason: 'Change from the safe', clientKey: key('in'), ...over });
const paidOut = (w: World, who: Person, amountMinor: bigint, over: Record<string, unknown> = {}) =>
  act(who, shiftActions.paidOut, { restaurantId: w.a.id, branchId: w.b1, amountMinor, reason: 'Courier fee', clientKey: key('out'), ...over });
const close = (w: World, who: Person, shiftId: string, countedMinor: bigint, over: Record<string, unknown> = {}) =>
  act(who, shiftActions.close, { restaurantId: w.a.id, branchId: w.b1, shiftId, countedMinor, ...over });
const current = (w: World, who: Person, over: Record<string, unknown> = {}) => ask(who, shiftQueries.current, { restaurantId: w.a.id, branchId: w.b1, ...over });
const report = (w: World, who: Person, shiftId: string, over: Record<string, unknown> = {}) => ask(who, shiftQueries.report, { restaurantId: w.a.id, branchId: w.b1, shiftId, ...over });
const list = (w: World, who: Person, over: Record<string, unknown> = {}) => ask(who, shiftQueries.list, { restaurantId: w.a.id, ...over });

const cash = (amountMinor: bigint) => ({ method: 'CASH', amountMinor, clientKey: key('pay') });
const sell = (w: World, who: Person, over: Record<string, unknown> = {}) =>
  act(who, saleActions.create, {
    restaurantId: w.a.id,
    branchId: w.b1,
    clientKey: key('sale'),
    currency: 'IQD',
    lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 1 }],
    payments: [cash(100n)],
    ...over,
  });

const movementsOf = (shiftId: string) => prisma().phCashMovement.findMany({ where: { shiftId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
const shiftRow = (id: string) => prisma().phShift.findUniqueOrThrow({ where: { id } });
/** The answers are typed; the tests read them as plain records. */
const loose = <T>(value: unknown) => value as T;
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

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

describe('opening a shift', () => {
  it('opens with a float: the shift, a FLOAT_OPEN movement, an audit entry', async () => {
    const w = await world();
    const clientKey = key('open');
    const made = dataOf(await open(w, w.cashier, { openingFloatMinor: 5000n, clientKey }));
    expect(made).toMatchObject({ branchId: w.b1, currency: 'IQD', openingFloatMinor: '5000', status: 'OPEN', replayed: false });
    const row = await shiftRow(made.id);
    expect(row).toMatchObject({ restaurantId: w.a.id, branchId: w.b1, userId: w.cashier.userId, status: 'OPEN', currency: 'IQD', openingFloatMinor: 5000n, openedAt: NOW, closedAt: null, countedMinor: null, expectedMinor: null, varianceMinor: null });
    const moves = await movementsOf(made.id);
    expect(moves.map((m) => [m.type, m.amountMinor, m.currency, m.userId, m.clientKey])).toEqual([['FLOAT_OPEN', 5000n, 'IQD', w.cashier.userId, clientKey]]);
    const log = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.shift.open', entityId: made.id } });
    expect(log.entityType).toBe('PhShift');
    expect(JSON.stringify(log.changes)).toContain('5000');
  });

  it('a zero float writes no movement', async () => {
    const w = await world();
    const id = await opened(w, w.cashier);
    expect(await movementsOf(id)).toEqual([]);
  });

  it('refuses a second open shift of the same user in the same branch, naming the open one', async () => {
    const w = await world();
    const first = await opened(w, w.cashier, 100n);
    const before = { shifts: await prisma().phShift.count(), moves: await prisma().phCashMovement.count(), audit: await prisma().auditLog.count({ where: { action: 'ph.shift.open' } }) };
    for (const over of [{}, { currency: 'USD' }, { openingFloatMinor: 900n }]) {
      const again = await open(w, w.cashier, over);
      expect(codeOf(again)).toBe('CONFLICT');
      expect(phCodeOf(again)).toBe('SHIFT_ALREADY_OPEN');
      expect(again.ok ? null : again.error.fields?.shiftId).toBe(first);
    }
    expect({ shifts: await prisma().phShift.count(), moves: await prisma().phCashMovement.count(), audit: await prisma().auditLog.count({ where: { action: 'ph.shift.open' } }) }).toEqual(before);
  });

  it('lets one user have a shift in each branch, and each user their own', async () => {
    const w = await world();
    const one = await opened(w, w.owner);
    const two = dataOf(await open(w, w.owner, { branchId: w.b2 })).id;
    const third = await opened(w, w.cashier);
    const fourth = await opened(w, w.cashier2);
    expect(new Set([one, two, third, fourth]).size).toBe(4);
  });

  it('opens a new shift once the last one is closed', async () => {
    const w = await world();
    const first = await opened(w, w.cashier);
    dataOf(await close(w, w.cashier, first, 0n));
    const second = await opened(w, w.cashier);
    expect(second).not.toBe(first);
    expect(await prisma().phShift.count({ where: { userId: w.cashier.userId, status: 'OPEN' } })).toBe(1);
  });

  it('a repeat of the same request returns the same shift, even after it closed; another request on the key is refused', async () => {
    const w = await world();
    const clientKey = key('open');
    const first = dataOf(await open(w, w.cashier, { openingFloatMinor: 700n, clientKey }));
    const again = dataOf(await open(w, w.cashier, { openingFloatMinor: 700n, clientKey }));
    expect(again).toMatchObject({ id: first.id, replayed: true, openingFloatMinor: '700' });
    expect(await prisma().phShift.count()).toBe(1);
    expect(await prisma().phCashMovement.count()).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'ph.shift.open' } })).toBe(1);

    for (const [who, over] of [
      [w.cashier, { openingFloatMinor: 701n }],
      [w.cashier, { currency: 'USD' }],
      [w.cashier2, { openingFloatMinor: 700n }],
      [w.owner, { openingFloatMinor: 700n, branchId: w.b2 }],
    ] as [Person, Record<string, unknown>][]) {
      const bad = await open(w, who, { clientKey, ...over });
      expect(codeOf(bad)).toBe('CONFLICT');
      expect(phCodeOf(bad)).toBe('CLIENT_KEY_MISMATCH');
    }
    dataOf(await close(w, w.cashier, first.id, 700n));
    expect(dataOf(await open(w, w.cashier, { openingFloatMinor: 700n, clientKey })).id).toBe(first.id);
    expect(await prisma().phShift.count()).toBe(1);
  });

  it('parallel opens of one user and branch: exactly one wins', async () => {
    const w = await world();
    const results = await Promise.all(Array.from({ length: 6 }, () => open(w, w.cashier, { openingFloatMinor: 10n })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results.filter((x) => !x.ok)) expect(codeOf(r)).toBe('CONFLICT');
    expect(await prisma().phShift.count({ where: { status: 'OPEN' } })).toBe(1);
    expect(await prisma().phCashMovement.count()).toBe(1);
  });

  it('checks the input and the place', async () => {
    const w = await world();
    const noBranch = await open(w, w.owner, { branchId: undefined });
    expect(codeOf(noBranch)).toBe('INVALID');
    expect(noBranch.ok ? null : noBranch.error.fields).toHaveProperty('branchId');
    expect(codeOf(await open(w, w.cashier, { openingFloatMinor: -1n }))).toBe('INVALID');
    expect(codeOf(await open(w, w.cashier, { openingFloatMinor: MAX_AMOUNT_MINOR + 1n }))).toBe('INVALID');
    expect(codeOf(await open(w, w.cashier, { currency: 'EUR' }))).toBe('INVALID');
    expect(codeOf(await open(w, w.cashier, { clientKey: 'short' }))).toBe('INVALID');
    // The cashier works in branch 1 only.
    expect(codeOf(await open(w, w.cashier, { branchId: w.b2 }))).toBe('FORBIDDEN');
    expect(await prisma().phShift.count()).toBe(0);
  });

  it('keeps the money as BigInt: a float at the maximum is stored exactly', async () => {
    const w = await world();
    const made = dataOf(await open(w, w.cashier, { openingFloatMinor: MAX_AMOUNT_MINOR }));
    expect(made.openingFloatMinor).toBe(String(MAX_AMOUNT_MINOR));
    expect((await shiftRow(made.id)).openingFloatMinor).toBe(MAX_AMOUNT_MINOR);
    expect((await movementsOf(made.id))[0]!.amountMinor).toBe(MAX_AMOUNT_MINOR);
  });

  it('is for the roles that use a shift: not the stock clerk, not the accountant', async () => {
    const w = await world();
    for (const who of [w.stockClerk, w.accountant]) expect(codeOf(await open(w, who))).toBe('FORBIDDEN');
    for (const who of [w.owner, w.manager, w.pharmacist, w.cashier]) expect(codeOf(await open(w, who))).toBe('OK');
  });
});

describe('paid in and paid out', () => {
  it('writes signed movements into the own open shift and audits them with the reason', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, 1000n);
    const inn = dataOf(await paidIn(w, w.cashier, 300n, { reason: '  Float top up  ' }));
    const out = dataOf(await paidOut(w, w.cashier, 150n, { reason: 'Courier fee' }));
    expect(inn).toMatchObject({ shiftId: id, type: 'PAID_IN', amountMinor: '300', currency: 'IQD', expectedMinor: '1300', replayed: false });
    expect(out).toMatchObject({ shiftId: id, type: 'PAID_OUT', amountMinor: '150', expectedMinor: '1150', replayed: false });
    const moves = await movementsOf(id);
    expect(moves.filter((m) => m.type !== 'FLOAT_OPEN').map((m) => [m.type, m.amountMinor, m.reason, m.userId])).toEqual([
      ['PAID_IN', 300n, 'Float top up', w.cashier.userId],
      ['PAID_OUT', -150n, 'Courier fee', w.cashier.userId],
    ]);
    const logs = await prisma().auditLog.findMany({ where: { action: { in: ['ph.shift.paidIn', 'ph.shift.paidOut'] } }, orderBy: { action: 'asc' } });
    expect(logs.map((l) => [l.action, l.entityId])).toEqual([['ph.shift.paidIn', inn.id], ['ph.shift.paidOut', out.id]]);
    const text = JSON.stringify(logs.map((l) => l.changes));
    expect(text).toContain('Courier fee');
    expect(text).toContain(id);
    expect(text).not.toMatch(/patient|customer/i);
  });

  it('needs a reason of 3 to 200 characters', async () => {
    const w = await world();
    await opened(w, w.cashier, 1000n);
    for (const reason of ['', '  ', 'ab', 'x'.repeat(201)]) {
      for (const make of [paidIn, paidOut]) {
        const refused = await make(w, w.cashier, 10n, { reason });
        expect(codeOf(refused)).toBe('INVALID');
        expect(refused.ok ? null : refused.error.fields).toHaveProperty('reason');
      }
    }
    expect(codeOf(await paidIn(w, w.cashier, 10n, { reason: 'x'.repeat(200) }))).toBe('OK');
    expect(codeOf(await paidIn(w, w.cashier, 0n))).toBe('INVALID');
    expect(codeOf(await paidIn(w, w.cashier, MAX_AMOUNT_MINOR + 1n))).toBe('INVALID');
    expect(codeOf(await paidOut(w, w.cashier, -5n))).toBe('INVALID');
  });

  it('needs the own open shift in that branch', async () => {
    const w = await world();
    const none = await paidIn(w, w.cashier, 10n);
    expect(codeOf(none)).toBe('CONFLICT');
    expect(phCodeOf(none)).toBe('NO_OPEN_SHIFT');
    // Somebody else's open shift does not count, nor does another branch's.
    await opened(w, w.cashier2, 100n);
    expect(phCodeOf(await paidIn(w, w.cashier, 10n))).toBe('NO_OPEN_SHIFT');
    dataOf(await open(w, w.owner, { branchId: w.b2, openingFloatMinor: 100n }));
    expect(phCodeOf(await paidIn(w, w.owner, 10n))).toBe('NO_OPEN_SHIFT');
    // A closed shift takes nothing.
    const id = await opened(w, w.cashier);
    dataOf(await close(w, w.cashier, id, 0n));
    expect(phCodeOf(await paidOut(w, w.cashier, 1n))).toBe('NO_OPEN_SHIFT');
    expect(await prisma().phCashMovement.count({ where: { type: { in: ['PAID_IN', 'PAID_OUT'] } } })).toBe(0);
  });

  it('never takes the drawer below zero: INSUFFICIENT_CASH with what is there', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, 500n);
    const refused = await paidOut(w, w.cashier, 501n);
    expect(codeOf(refused)).toBe('CONFLICT');
    expect(phCodeOf(refused)).toBe('INSUFFICIENT_CASH');
    expect(refused.ok ? null : refused.error.fields).toMatchObject({ available: '500', requested: '501' });
    expect(await prisma().phCashMovement.count({ where: { type: 'PAID_OUT' } })).toBe(0);
    expect(dataOf(await paidOut(w, w.cashier, 500n)).expectedMinor).toBe('0');
    expect(phCodeOf(await paidOut(w, w.cashier, 1n))).toBe('INSUFFICIENT_CASH');
    // Cash from sales can be paid out.
    await sell(w, w.cashier);
    expect(dataOf(await paidOut(w, w.cashier, 100n)).expectedMinor).toBe('0');
    expect((await movementsOf(id)).map((m) => m.type)).toEqual(['FLOAT_OPEN', 'PAID_OUT', 'SALE_CASH', 'PAID_OUT']);
  });

  it('two parallel paid outs of the same cash: one wins', async () => {
    const w = await world();
    await opened(w, w.cashier, 500n);
    const results = await Promise.all([paidOut(w, w.cashier, 300n), paidOut(w, w.cashier, 300n), paidOut(w, w.cashier, 300n)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results.filter((x) => !x.ok)) expect(phCodeOf(r)).toBe('INSUFFICIENT_CASH');
  });

  it('is idempotent by key: the same request returns the movement, another is refused', async () => {
    const w = await world();
    await opened(w, w.cashier, 1000n);
    const clientKey = key('out');
    const first = dataOf(await paidOut(w, w.cashier, 200n, { clientKey }));
    const again = dataOf(await paidOut(w, w.cashier, 200n, { clientKey }));
    expect(again).toMatchObject({ id: first.id, replayed: true, expectedMinor: '800' });
    expect(await prisma().phCashMovement.count({ where: { type: 'PAID_OUT' } })).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'ph.shift.paidOut' } })).toBe(1);
    await opened(w, w.cashier2, 1000n);
    const bad: [string, Awaited<ReturnType<typeof paidOut>>][] = [
      ['amount', await paidOut(w, w.cashier, 201n, { clientKey })],
      ['reason', await paidOut(w, w.cashier, 200n, { clientKey, reason: 'Something else' })],
      ['direction', await paidIn(w, w.cashier, 200n, { clientKey })],
      ['another person', await paidOut(w, w.cashier2, 200n, { clientKey })],
    ];
    for (const [label, r] of bad) {
      expect(codeOf(r), label).toBe('CONFLICT');
      expect(phCodeOf(r), label).toBe('CLIENT_KEY_MISMATCH');
    }
    expect(await prisma().phCashMovement.count({ where: { type: 'PAID_OUT' } })).toBe(1);
  });

  it('answers a repeat even after the shift closed', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, 400n);
    const clientKey = key('in');
    const first = dataOf(await paidIn(w, w.cashier, 100n, { clientKey }));
    dataOf(await close(w, w.cashier, id, 500n));
    expect(dataOf(await paidIn(w, w.cashier, 100n, { clientKey })).id).toBe(first.id);
  });

  it('is for the shift roles only', async () => {
    const w = await world();
    for (const who of [w.stockClerk, w.accountant]) {
      expect(codeOf(await paidIn(w, who, 10n))).toBe('FORBIDDEN');
      expect(codeOf(await paidOut(w, who, 10n))).toBe('FORBIDDEN');
    }
    expect(codeOf(await paidIn(w, w.cashier, 10n, { branchId: undefined }))).toBe('INVALID');
  });
});

describe('closing a shift', () => {
  it('computes the expected cash from the cash movements and stores expected, counted and variance', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, 1000n);
    // A cash sale of 1800 paid with 2000 (change 200), a card sale, a paid in, a paid out and a cash refund.
    const strip = { productId: w.p.id, unitId: w.p.strip, qty: 2 };
    dataOf(await sell(w, w.cashier, { lines: [strip], payments: [cash(2000n)] }));
    dataOf(await sell(w, w.cashier, { payments: [{ method: 'CARD_MANUAL', amountMinor: 100n, clientKey: key('pay'), reference: 'POS-1' }] }));
    dataOf(await paidIn(w, w.cashier, 300n));
    dataOf(await paidOut(w, w.cashier, 150n));
    const firstSale = await prisma().phSale.findFirstOrThrow({ where: { shiftId: id }, orderBy: { createdAt: 'asc' } });
    await prisma().phCashMovement.create({ data: { restaurantId: w.a.id, shiftId: id, type: 'REFUND_CASH', amountMinor: -400n, currency: 'IQD', refType: 'return', refId: firstSale.id, userId: w.cashier.userId } });

    // Independent: 1000 + 2000 - 200 + 300 - 150 - 400 = 2550 (the card sale adds no cash).
    const closed = dataOf(await close(w, w.cashier, id, 2550n));
    expect(closed).toMatchObject({ id, status: 'CLOSED', expectedMinor: '2550', countedMinor: '2550', varianceMinor: '0', approvedById: null });
    const row = await shiftRow(id);
    expect(row).toMatchObject({ status: 'CLOSED', expectedMinor: 2550n, countedMinor: 2550n, varianceMinor: 0n, closedAt: NOW, closeReason: '', approvedById: null });
    const log = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.shift.close', entityId: id } });
    expect(JSON.stringify(log.changes)).toContain('2550');
  });

  it('needs a reason for any difference when no limit is set; zero difference needs none', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, 1000n);
    const noReason = await close(w, w.cashier, id, 990n);
    expect(codeOf(noReason)).toBe('INVALID');
    expect(noReason.ok ? null : noReason.error.fields).toHaveProperty('reason');
    expect((await shiftRow(id)).status).toBe('OPEN');
    expect(codeOf(await close(w, w.cashier, id, 990n, { reason: 'ab' }))).toBe('INVALID');
    expect(codeOf(await close(w, w.cashier, id, 990n, { reason: 'x'.repeat(201) }))).toBe('INVALID');
    const short = dataOf(await close(w, w.cashier, id, 990n, { reason: '  Gave the wrong change  ' }));
    expect(short).toMatchObject({ expectedMinor: '1000', countedMinor: '990', varianceMinor: '-10' });
    expect(await shiftRow(id)).toMatchObject({ varianceMinor: -10n, closeReason: 'Gave the wrong change', approvedById: null });

    const id2 = await opened(w, w.cashier2, 1000n);
    expect(dataOf(await close(w, w.cashier2, id2, 1015n, { reason: 'Customer left a tip' })).varianceMinor).toBe('15');
  });

  it('judges the limit: at the limit a reason is enough, above it a manager must close it', async () => {
    const w = await world({ limit: 100n });
    const id = await opened(w, w.cashier, 1000n);
    // Exactly at the limit, short and over: a reason only.
    const refusedNoReason = await close(w, w.cashier, id, 900n);
    expect(codeOf(refusedNoReason)).toBe('INVALID');
    const above = await close(w, w.cashier, id, 899n, { reason: 'Drawer was short' });
    expect(codeOf(above)).toBe('CONFLICT');
    expect(phCodeOf(above)).toBe('NEEDS_APPROVAL');
    const above2 = await close(w, w.cashier, id, 1101n, { reason: 'Drawer was over' });
    expect(phCodeOf(above2)).toBe('NEEDS_APPROVAL');
    expect((await shiftRow(id)).status).toBe('OPEN');
    // A small difference below the limit still needs its reason.
    expect(codeOf(await close(w, w.cashier, id, 950n))).toBe('INVALID');
    dataOf(await close(w, w.cashier, id, 900n, { reason: 'Drawer was short' }));
    expect((await shiftRow(id)).approvedById).toBeNull();
  });

  it('an over-limit difference is closed by a report.view holder, who is recorded as the approver', async () => {
    const w = await world({ limit: 100n });
    const id = await opened(w, w.cashier, 1000n);
    // The cashier cannot close it, and cannot name anybody to approve it.
    const refused = await close(w, w.cashier, id, 500n, { reason: 'Drawer was short' });
    expect(phCodeOf(refused)).toBe('NEEDS_APPROVAL');
    expect(await shiftRow(id)).toMatchObject({ status: 'OPEN', approvedById: null });
    const named = await close(w, w.cashier, id, 500n, { reason: 'Drawer was short', approval: { approverUserId: w.manager.userId } });
    expect(phCodeOf(named)).toBe('NEEDS_APPROVAL');
    expect((await shiftRow(id)).status).toBe('OPEN');
    // A manager of the branch closes it: the actor is the approver.
    const closed = dataOf(await close(w, w.manager, id, 500n, { reason: 'Drawer was short' }));
    expect(closed).toMatchObject({ varianceMinor: '-500', approvedById: w.manager.userId });
    expect(await shiftRow(id)).toMatchObject({ varianceMinor: -500n, approvedById: w.manager.userId, closeReason: 'Drawer was short', userId: w.cashier.userId });
    const log = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.shift.close', entityId: id } });
    expect(JSON.stringify(log.changes)).toContain(w.manager.userId);

    // The owner and an accountant (report.view) can close an over-limit shift as well.
    const id2 = await opened(w, w.cashier2, 1000n);
    expect(dataOf(await close(w, w.owner, id2, 1500n, { reason: 'Found extra' })).approvedById).toBe(w.owner.userId);
    const id3 = await opened(w, w.pharmacist, 1000n);
    expect(dataOf(await close(w, w.accountant, id3, 1500n, { reason: 'Found extra' })).approvedById).toBe(w.accountant.userId);
  });

  it('refuses the over-limit close to a role without report.view, a manager of another branch, and another business', async () => {
    const w = await world({ limit: 100n });
    const id = await opened(w, w.cashier, 1000n);
    const base = { reason: 'Drawer was short' };
    // Pharmacist and cashier colleagues hold no report.view: FORBIDDEN (not their shift).
    expect(codeOf(await close(w, w.pharmacist, id, 500n, base))).toBe('FORBIDDEN');
    expect(codeOf(await close(w, w.cashier2, id, 500n, base))).toBe('FORBIDDEN');
    // A manager of branch 2 only does not reach branch 1's shift.
    expect(codeOf(await close(w, w.manager2, id, 500n, { ...base, branchId: w.b2 }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.manager2, shiftActions.close, { restaurantId: w.a.id, shiftId: id, countedMinor: 500n, ...base }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.other.owner, shiftActions.close, { restaurantId: w.other.id, shiftId: id, countedMinor: 500n, ...base }))).toBe('NOT_FOUND');
    // A manager closing their own over-limit shift is allowed with a reason, and is recorded as the approver.
    const own = await opened(w, w.manager, 1000n);
    expect(codeOf(await close(w, w.manager, own, 500n))).toBe('INVALID');
    expect(dataOf(await close(w, w.manager, own, 500n, base)).approvedById).toBe(w.manager.userId);
    expect((await shiftRow(id)).status).toBe('OPEN');
    expect(await prisma().auditLog.count({ where: { action: 'ph.shift.close' } })).toBe(1);
  });

  it('a difference within the limit is closed by its cashier with a reason and has no approver', async () => {
    const w = await world({ limit: 100n });
    const id = await opened(w, w.cashier, 1000n);
    dataOf(await close(w, w.cashier, id, 950n, { reason: 'Gave the wrong change' }));
    expect((await shiftRow(id)).approvedById).toBeNull();
  });

  it('records who closed the shift on every close, apart from the approver of an over-limit difference', async () => {
    const w = await world({ limit: 100n });
    // Own close: the cashier is the closer, nobody approves.
    const own = await opened(w, w.cashier, 1000n);
    expect(dataOf(await close(w, w.cashier, own, 1000n))).toMatchObject({ closedById: w.cashier.userId, approvedById: null });
    expect(await shiftRow(own)).toMatchObject({ closedById: w.cashier.userId, approvedById: null });
    // A manager closes another person's drawer within the limit: the manager is the closer, there is no approver.
    const other = await opened(w, w.cashier2, 1000n);
    const closed = dataOf(await close(w, w.manager, other, 950n, { reason: 'Counted for the cashier' }));
    expect(closed).toMatchObject({ closedById: w.manager.userId, approvedById: null });
    expect(await shiftRow(other)).toMatchObject({ closedById: w.manager.userId, approvedById: null, userId: w.cashier2.userId });
    // Over the limit the closer is also the approver; the report returns both.
    const over = await opened(w, w.pharmacist, 1000n);
    dataOf(await close(w, w.accountant, over, 500n, { reason: 'Drawer was short' }));
    const got = loose<{ shift: Record<string, unknown> }>(dataOf(await report(w, w.accountant, over)));
    expect(got.shift).toMatchObject({ closedById: w.accountant.userId, approvedById: w.accountant.userId });
    const open = await opened(w, w.manager, 100n);
    expect(loose<{ shift: Record<string, unknown> }>(dataOf(await report(w, w.manager, open))).shift).toMatchObject({ closedById: null });
  });

  it('closing twice is CONFLICT ALREADY_CLOSED and changes nothing', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, 100n);
    dataOf(await close(w, w.cashier, id, 100n));
    const before = await shiftRow(id);
    const again = await close(w, w.cashier, id, 5n, { reason: 'Second try' });
    expect(codeOf(again)).toBe('CONFLICT');
    expect(phCodeOf(again)).toBe('ALREADY_CLOSED');
    expect(await shiftRow(id)).toEqual(before);
    expect(await prisma().auditLog.count({ where: { action: 'ph.shift.close' } })).toBe(1);
  });

  it('parallel closes of one shift: exactly one wins', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, 100n);
    const results = await Promise.all(Array.from({ length: 5 }, () => close(w, w.cashier, id, 100n)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results.filter((x) => !x.ok)) expect(phCodeOf(r)).toBe('ALREADY_CLOSED');
    expect(await prisma().auditLog.count({ where: { action: 'ph.shift.close' } })).toBe(1);
  });

  it('the owner closes their own shift; another person needs report.view and a reason', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, 100n);
    // A cashier cannot close a colleague's shift; the stock clerk holds neither permission.
    expect(codeOf(await close(w, w.cashier2, id, 100n, { reason: 'Helping out' }))).toBe('FORBIDDEN');
    expect(codeOf(await close(w, w.stockClerk, id, 100n, { reason: 'Helping out' }))).toBe('FORBIDDEN');
    // A manager needs a reason even for a zero difference.
    const noReason = await close(w, w.manager, id, 100n);
    expect(codeOf(noReason)).toBe('INVALID');
    expect(noReason.ok ? null : noReason.error.fields).toHaveProperty('reason');
    // The manager of branch 2 only cannot reach the shift at all.
    expect(codeOf(await close(w, w.manager2, id, 100n, { reason: 'Not mine to close', branchId: w.b2 }))).toBe('NOT_FOUND');
    dataOf(await close(w, w.manager, id, 100n, { reason: 'Cashier went home' }));
    expect(await shiftRow(id)).toMatchObject({ status: 'CLOSED', closeReason: 'Cashier went home', userId: w.cashier.userId });
    const log = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.shift.close', entityId: id } });
    expect(log.actorId).toBe(w.manager.userId);

    const id2 = await opened(w, w.cashier2, 100n);
    dataOf(await close(w, w.accountant, id2, 100n, { reason: 'Month end' }));
    expect((await shiftRow(id2)).status).toBe('CLOSED');
  });

  it('refuses a shift of another business, of another branch of the place, or one that does not exist', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, 100n);
    const foreign = dataOf(await act(w.other.owner, shiftActions.open, { restaurantId: w.other.id, branchId: w.other.branchId, currency: 'IQD', openingFloatMinor: 0n, clientKey: key('open') })).id;
    expect(codeOf(await close(w, w.owner, foreign, 0n, { reason: 'Not ours' }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.other.owner, shiftActions.close, { restaurantId: w.other.id, branchId: w.other.branchId, shiftId: id, countedMinor: 0n, reason: 'Not ours' }))).toBe('NOT_FOUND');
    // Branch 2 named as the place, branch 1's shift named.
    expect(codeOf(await close(w, w.owner, id, 100n, { branchId: w.b2, reason: 'Wrong branch' }))).toBe('NOT_FOUND');
    expect(codeOf(await close(w, w.owner, 'no-such-shift', 100n, { reason: 'Nothing' }))).toBe('NOT_FOUND');
    expect((await shiftRow(id)).status).toBe('OPEN');
    expect((await shiftRow(foreign)).status).toBe('OPEN');
  });

  it('checks the counted amount', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, 100n);
    expect(codeOf(await close(w, w.cashier, id, -1n, { reason: 'Negative' }))).toBe('INVALID');
    expect(codeOf(await close(w, w.cashier, id, MAX_AMOUNT_MINOR + 1n, { reason: 'Too much' }))).toBe('INVALID');
    expect(codeOf(await close(w, w.cashier, id, 100n, { branchId: undefined }))).toBe('OK');
  });

  it('keeps BigInt amounts exact: a float at the maximum, counted one short', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, MAX_AMOUNT_MINOR);
    const closed = dataOf(await close(w, w.cashier, id, MAX_AMOUNT_MINOR - 1n, { reason: 'One note short' }));
    expect(closed).toMatchObject({ expectedMinor: String(MAX_AMOUNT_MINOR), varianceMinor: '-1' });
    expect(await shiftRow(id)).toMatchObject({ expectedMinor: MAX_AMOUNT_MINOR, countedMinor: MAX_AMOUNT_MINOR - 1n, varianceMinor: -1n });
  });

  it('a closed shift cannot sell, take cash or be reopened', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, 100n);
    dataOf(await close(w, w.cashier, id, 100n));
    const sale = await sell(w, w.cashier);
    expect(codeOf(sale)).toBe('CONFLICT');
    expect(phCodeOf(sale)).toBe('NO_OPEN_SHIFT');
    expect(phCodeOf(await paidIn(w, w.cashier, 5n))).toBe('NO_OPEN_SHIFT');
    expect(await prisma().phSale.count()).toBe(0);
  });
});

describe('a close racing a sale', () => {
  it('a sale that read the shift as open and reaches its insert after the close is refused NO_OPEN_SHIFT', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, 100n);
    // The close, in progress: it holds the shift row. The sale starts, passes its own checks and blocks at its first insert.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => (locked = resolve));
    const closing = prisma().$transaction(async (tx) => {
      // eslint-disable-next-line no-restricted-properties -- the test plays a close in progress: it holds the shift row
      await tx.$queryRaw`SELECT "id" FROM "PhShift" WHERE "id" = ${id} FOR UPDATE`;
      locked();
      await held;
      await tx.phShift.update({ where: { id }, data: { status: 'CLOSED', closedAt: NOW, countedMinor: 100n, expectedMinor: 100n, varianceMinor: 0n } });
    });
    await hasLock;
    const selling = sell(w, w.cashier);
    await new Promise((resolve) => setTimeout(resolve, 600));
    release();
    await closing;
    const result = await selling;
    expect(codeOf(result)).toBe('CONFLICT');
    expect(phCodeOf(result)).toBe('NO_OPEN_SHIFT');
    expect(await prisma().phSale.count()).toBe(0);
    expect(await prisma().phCashMovement.count({ where: { shiftId: id, type: 'SALE_CASH' } })).toBe(0);
    expect(await prisma().phStockMovement.count({ where: { type: 'SALE' } })).toBe(0);
  });

  it('the database itself refuses a sale, a cash movement or a return posted into a closed shift', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, 100n);
    const made = dataOf(await sell(w, w.cashier));
    dataOf(await close(w, w.cashier, id, 200n));
    const late = { restaurantId: w.a.id, shiftId: id, type: 'PAID_IN' as const, amountMinor: 5n, currency: 'IQD' as const, userId: w.cashier.userId };
    await expect(prisma().phCashMovement.create({ data: late })).rejects.toThrow(/PH_SHIFT_CLOSED/);
    await expect(
      prisma().phSale.create({ data: { restaurantId: w.a.id, branchId: w.b1, shiftId: id, currency: 'IQD', clientKey: key('late'), soldById: w.cashier.userId } }),
    ).rejects.toThrow(/PH_SHIFT_CLOSED/);
    await expect(
      prisma().phReturn.create({
        data: { restaurantId: w.a.id, branchId: w.b1, saleId: made.id, shiftId: id, reason: 'late', approvedById: w.manager.userId, refundMethod: 'CASH', refundMinor: 1n, currency: 'IQD', clientKey: key('late') },
      }),
    ).rejects.toThrow(/PH_SHIFT_CLOSED/);
    // An open shift still takes them.
    const other = await opened(w, w.cashier2, 0n);
    await expect(prisma().phCashMovement.create({ data: { ...late, shiftId: other, userId: w.cashier2.userId } })).resolves.toBeTruthy();
  });

  it('whichever wins, every cash movement of the shift is in the expected cash of the close', async () => {
    const w = await world();
    let sold = 0;
    let refused = 0;
    for (let round = 0; round < 8; round += 1) {
      const who = round % 2 === 0 ? w.cashier : w.cashier2;
      const id = await opened(w, who, 100n);
      const [saleResult, closeResult] = await Promise.all([sell(w, who, { payments: [cash(150n)] }), close(w, who, id, 100n, { reason: 'Racing' })]);
      expect(codeOf(closeResult), `round ${round}`).toBe('OK');
      if (saleResult.ok) sold += 1;
      else {
        refused += 1;
        expect(phCodeOf(saleResult)).toBe('NO_OPEN_SHIFT');
      }
      const row = await shiftRow(id);
      const moves = await movementsOf(id);
      // The invariant: nothing landed after the close without being counted.
      expect(row.expectedMinor, `round ${round}`).toBe(row.openingFloatMinor + sum(moves.filter((m) => m.type !== 'FLOAT_OPEN').map((m) => m.amountMinor)));
      expect(await prisma().phSale.count({ where: { shiftId: id } })).toBe(saleResult.ok ? 1 : 0);
    }
    expect(sold + refused).toBe(8);
  });
});

describe('the current shift', () => {
  it('is null without an open shift, in the other branch, for no branch', async () => {
    const w = await world();
    expect(dataOf(await current(w, w.cashier))).toBeNull();
    await opened(w, w.cashier, 100n);
    expect(dataOf(await current(w, w.cashier))).not.toBeNull();
    expect(dataOf(await current(w, w.cashier2))).toBeNull();
    expect(dataOf(await current(w, w.owner, { branchId: w.b2 }))).toBeNull();
    expect(dataOf(await current(w, w.cashier, { branchId: undefined }))).toBeNull();
    const id = (loose<{ shift: { id: string } }>(dataOf(await current(w, w.cashier)))).shift.id;
    dataOf(await close(w, w.cashier, id, 100n));
    expect(dataOf(await current(w, w.cashier))).toBeNull();
  });

  it('shows the own open shift with live totals', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, 1000n);
    dataOf(await sell(w, w.cashier, { lines: [{ productId: w.p.id, unitId: w.p.strip, qty: 2 }], payments: [cash(2000n)] }));
    dataOf(await sell(w, w.cashier, { payments: [{ method: 'TRANSFER_MANUAL', amountMinor: 100n, clientKey: key('pay'), reference: 'T-1' }] }));
    dataOf(await paidIn(w, w.cashier, 300n));
    dataOf(await paidOut(w, w.cashier, 150n));
    const now = loose<{ shift: Record<string, unknown>; totals: Record<string, unknown> }>(dataOf(await current(w, w.cashier)));
    expect(now.shift).toMatchObject({ id, status: 'OPEN', userId: w.cashier.userId, branchId: w.b1, currency: 'IQD', openingFloatMinor: '1000', countedMinor: null, varianceMinor: null });
    expect(now.totals).toMatchObject({
      expectedMinor: String(1000 + 2000 - 200 + 300 - 150),
      salesCount: 2,
      salesTotalMinor: '1900',
      cash: { tenderedMinor: '2000', changeMinor: '200', refundsMinor: '0', paidInMinor: '300', paidOutMinor: '150' },
    });
    // Somebody else's shift is not shown to this cashier.
    await opened(w, w.cashier2, 5n);
    expect((loose<{ shift: { id: string } }>(dataOf(await current(w, w.cashier)))).shift.id).toBe(id);
  });

  it('is for the shift roles', async () => {
    const w = await world();
    for (const who of [w.stockClerk, w.accountant]) expect(codeOf(await current(w, who))).toBe('FORBIDDEN');
  });
});

describe('the shift report', () => {
  async function busyShift(w: World) {
    const id = await opened(w, w.cashier, 1000n);
    const strip2 = { productId: w.p.id, unitId: w.p.strip, qty: 2 };
    const sales = [
      dataOf(await sell(w, w.cashier, { lines: [strip2], payments: [cash(2000n)] })),
      dataOf(await sell(w, w.cashier, { payments: [{ method: 'CARD_MANUAL', amountMinor: 100n, clientKey: key('pay'), reference: 'C-1' }] })),
      dataOf(await sell(w, w.cashier, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 5 }], payments: [cash(200n), { method: 'TRANSFER_MANUAL', amountMinor: 300n, clientKey: key('pay'), reference: 'T-1' }] })),
      dataOf(await sell(w, w.cashier, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 3 }], payments: [cash(300n)], invoiceDiscount: { kind: 'amount', value: 10n, reason: 'Loyal customer here' } })),
    ];
    dataOf(await paidIn(w, w.cashier, 300n));
    dataOf(await paidOut(w, w.cashier, 150n));
    // A cash return of 100 against the first sale, with its refund movement (the returns service arrives with task 5).
    await prisma().phReturn.create({
      data: { restaurantId: w.a.id, branchId: w.b1, saleId: sales[0]!.id, shiftId: id, reason: 'Wrong item', approvedById: w.manager.userId, refundMethod: 'CASH', refundMinor: 100n, currency: 'IQD', clientKey: key('ret') },
    });
    await prisma().phCashMovement.create({ data: { restaurantId: w.a.id, shiftId: id, type: 'REFUND_CASH', amountMinor: -100n, currency: 'IQD', refType: 'return', refId: sales[0]!.id, userId: w.cashier.userId } });
    return { id, sales };
  }

  it('totals equal the sum of the sales, payments and movements rows (computed independently)', async () => {
    const w = await world();
    const { id } = await busyShift(w);
    const got = loose<{ shift: Record<string, unknown>; totals: Record<string, unknown> }>(dataOf(await report(w, w.cashier, id)));

    const sales = await prisma().phSale.findMany({ where: { shiftId: id, status: { in: ['COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL'] } } });
    const payments = await prisma().phPayment.findMany({ where: { sale: { shiftId: id } } });
    const moves = await prisma().phCashMovement.findMany({ where: { shiftId: id } });
    const typeSum = (t: string) => sum(moves.filter((m) => m.type === t).map((m) => m.amountMinor));
    const byMethod = (m: string) => payments.filter((p) => p.method === m);
    const expected = 1000n + sum(sales.flatMap((s) => payments.filter((p) => p.saleId === s.id && p.method === 'CASH').map((p) => p.amountMinor))) - sum(sales.map((s) => s.changeMinor)) - 100n + 300n - 150n;

    expect(got.totals).toMatchObject({
      openingFloatMinor: '1000',
      expectedMinor: String(expected),
      salesCount: sales.length,
      salesTotalMinor: String(sum(sales.map((s) => s.totalMinor))),
      discountMinor: String(sum(sales.map((s) => s.discountMinor))),
      cash: {
        tenderedMinor: String(sum(byMethod('CASH').map((p) => p.amountMinor))),
        changeMinor: String(sum(sales.map((s) => s.changeMinor))),
        refundsMinor: String(-typeSum('REFUND_CASH')),
        paidInMinor: String(typeSum('PAID_IN')),
        paidOutMinor: String(-typeSum('PAID_OUT')),
      },
      returns: { count: 1, refundMinor: '100' },
    });
    const payTotals = (got.totals as { payments: { method: string; count: number; amountMinor: string }[] }).payments;
    expect(payTotals).toEqual(
      ['CARD_MANUAL', 'CASH', 'TRANSFER_MANUAL'].map((m) => ({ method: m, count: byMethod(m).length, amountMinor: String(sum(byMethod(m).map((p) => p.amountMinor))) })),
    );
    // And the arithmetic by hand: sales of 1800, 100, 500 and 290 (10 discount); cash 2000 + 200 + 300 tendered, 200 + 10 change.
    expect(sales.map((s) => Number(s.totalMinor)).sort((x, y) => x - y)).toEqual([100, 290, 500, 1800]);
    expect(expected).toBe(1000n + (2000n + 200n + 300n) - (200n + 10n) - 100n + 300n - 150n);
  });

  it('shows a closed shift with counted, expected, variance, reason and approver', async () => {
    const w = await world({ limit: 100n });
    const { id } = await busyShift(w);
    const exp = BigInt((loose<{ totals: { expectedMinor: string } }>(dataOf(await report(w, w.cashier, id)))).totals.expectedMinor);
    dataOf(await close(w, w.manager, id, exp - 500n, { reason: 'Drawer was short' }));
    const got = loose<{ shift: Record<string, unknown>; totals: { expectedMinor: string } }>(dataOf(await report(w, w.cashier, id)));
    expect(got.shift).toMatchObject({ status: 'CLOSED', expectedMinor: String(exp), countedMinor: String(exp - 500n), varianceMinor: '-500', closeReason: 'Drawer was short', approvedById: w.manager.userId, closedAt: NOW.toISOString() });
    expect(got.totals.expectedMinor).toBe(String(exp));
  });

  it('carries no cost and no profit', async () => {
    const w = await world();
    const { id } = await busyShift(w);
    const text = JSON.stringify(dataOf(await report(w, w.owner, id)));
    expect(text).not.toMatch(/cost|profit|margin/i);
  });

  it('who reads which shift: own for shift.use, any of the branch for report.view', async () => {
    const w = await world();
    const mine = await opened(w, w.cashier, 100n);
    const theirs = await opened(w, w.cashier2, 100n);
    expect(codeOf(await report(w, w.cashier, mine))).toBe('OK');
    expect(codeOf(await report(w, w.cashier, theirs))).toBe('NOT_FOUND');
    for (const who of [w.owner, w.manager, w.accountant]) {
      expect(codeOf(await report(w, who, mine)), who.email).toBe('OK');
      expect(codeOf(await report(w, who, theirs)), who.email).toBe('OK');
    }
    expect(codeOf(await report(w, w.stockClerk, mine))).toBe('FORBIDDEN');
    // The manager of branch 2 only, and another business's owner, do not reach it.
    expect(codeOf(await report(w, w.manager2, mine, { branchId: w.b2 }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(w.other.owner, shiftQueries.report, { restaurantId: w.other.id, branchId: w.other.branchId, shiftId: mine }))).toBe('NOT_FOUND');
    expect(codeOf(await report(w, w.owner, mine, { branchId: w.b2 }))).toBe('NOT_FOUND');
    expect(codeOf(await report(w, w.owner, 'nope'))).toBe('NOT_FOUND');
  });

  it('a shift with only a float has empty totals', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, 250n);
    const got = loose<{ totals: Record<string, unknown> }>(dataOf(await report(w, w.cashier, id)));
    expect(got.totals).toMatchObject({ openingFloatMinor: '250', expectedMinor: '250', salesCount: 0, salesTotalMinor: '0', payments: [], returns: { count: 0, refundMinor: '0' } });
  });
});

describe('listing shifts', () => {
  it('a cashier sees their own, a report.view holder every shift of their branches, filtered and paged', async () => {
    const w = await world();
    const c1 = await opened(w, w.cashier, 1n);
    dataOf(await close(w, w.cashier, c1, 1n));
    const c1b = await opened(w, w.cashier, 2n);
    const c2 = await opened(w, w.cashier2, 3n);
    const o2 = dataOf(await open(w, w.owner, { branchId: w.b2, openingFloatMinor: 4n })).id;
    const ids = (r: unknown) => (r as { items: { id: string }[] }).items.map((i) => i.id);

    expect(ids(dataOf(await list(w, w.cashier)))).toHaveLength(2);
    expect(new Set(ids(dataOf(await list(w, w.cashier))))).toEqual(new Set([c1, c1b]));
    expect(new Set(ids(dataOf(await list(w, w.manager))))).toEqual(new Set([c1, c1b, c2]));
    expect(new Set(ids(dataOf(await list(w, w.accountant))))).toEqual(new Set([c1, c1b, c2]));
    expect(new Set(ids(dataOf(await list(w, w.owner))))).toEqual(new Set([c1, c1b, c2, o2]));
    expect(new Set(ids(dataOf(await list(w, w.owner, { branchId: w.b2 }))))).toEqual(new Set([o2]));
    expect(new Set(ids(dataOf(await list(w, w.manager2))))).toEqual(new Set([o2]));
    expect(new Set(ids(dataOf(await list(w, w.manager, { status: 'OPEN' }))))).toEqual(new Set([c1b, c2]));
    expect(new Set(ids(dataOf(await list(w, w.manager, { status: 'CLOSED' }))))).toEqual(new Set([c1]));
    expect(codeOf(await list(w, w.stockClerk))).toBe('FORBIDDEN');
    expect(ids(dataOf(await ask(w.other.owner, shiftQueries.list, { restaurantId: w.other.id })))).toEqual([]);
  });

  it('pages by cursor, newest first, and filters by date', async () => {
    const w = await world();
    const made: string[] = [];
    for (let day = 0; day < 5; day += 1) {
      vi.setSystemTime(new Date(NOW.getTime() + day * 86_400_000));
      const id = await opened(w, w.cashier, BigInt(day));
      dataOf(await close(w, w.cashier, id, BigInt(day)));
      made.push(id);
    }
    vi.setSystemTime(NOW);
    const first = loose<{ items: { id: string }[]; nextCursor: string | null }>(dataOf(await list(w, w.manager, { pageSize: 2 })));
    expect(first.items.map((i) => i.id)).toEqual([made[4], made[3]]);
    const second = loose<{ items: { id: string }[]; nextCursor: string | null }>(dataOf(await list(w, w.manager, { pageSize: 2, cursor: first.nextCursor })));
    expect(second.items.map((i) => i.id)).toEqual([made[2], made[1]]);
    const third = loose<{ items: { id: string }[]; nextCursor: string | null }>(dataOf(await list(w, w.manager, { pageSize: 2, cursor: second.nextCursor })));
    expect(third.items.map((i) => i.id)).toEqual([made[0]]);
    expect(third.nextCursor).toBeNull();
    const ranged = loose<{ items: { id: string }[] }>(dataOf(await list(w, w.manager, { from: new Date(NOW.getTime() + 86_400_000).toISOString(), to: new Date(NOW.getTime() + 2 * 86_400_000).toISOString() })));
    expect(ranged.items.map((i) => i.id)).toEqual([made[2], made[1]]);
    expect(codeOf(await list(w, w.manager, { from: 'not a date' }))).toBe('INVALID');
  });

  it('shows the expected, counted and variance of closed shifts and none for open ones', async () => {
    const w = await world();
    const id = await opened(w, w.cashier, 100n);
    expect((loose<{ items: Record<string, unknown>[] }>(dataOf(await list(w, w.manager)))).items[0]).toMatchObject({ id, status: 'OPEN', expectedMinor: null, countedMinor: null, varianceMinor: null });
    dataOf(await close(w, w.cashier, id, 90n, { reason: 'Gave the wrong change' }));
    expect((loose<{ items: Record<string, unknown>[] }>(dataOf(await list(w, w.manager)))).items[0]).toMatchObject({ id, status: 'CLOSED', expectedMinor: '100', countedMinor: '90', varianceMinor: '-10' });
  });
});
