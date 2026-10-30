import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as customerActions from '@/server/pharmacy/actions/customers';
import * as returnActions from '@/server/pharmacy/actions/returns';
import * as customerQueries from '@/server/pharmacy/queries/customers';
import { NOW, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask, codeOf, dataOf, phCodeOf } from './stock-helpers';
import { balanceBySql, creditWorld, key, makeCustomer, sellOnCredit, shiftNow, type CreditWorld } from './credit-world';

/**
 * Customer payments, their correction, statements and ageing (phase 7, task 3; R7-5). Hand figures (Panadol 100 IQD a tablet):
 * charges of 30 000 (2026-07-30), 20 000 (2026-08-27 21:30 UTC, which is 2026-08-28 in Baghdad) and 10 000 (2026-10-25), then a
 * 25 000 card payment on 2026-10-26: balance 35 000. As of 2026-10-27 the payment settles the oldest charge first, so 5 000 of the
 * 89-day charge is left (61-90), 20 000 of the 60-day one (31-60) and the 2-day one in full (0-30).
 */

let w: CreditWorld;
const at = (branchId?: string) => ({ restaurantId: w.a.id, branchId: branchId ?? w.b1 });
const pay = (customerId: string, method: 'CASH' | 'CARD' | 'TRANSFER', amountMinor: bigint, over: Record<string, unknown> = {}) => ({ ...at(), customerId, method, amountMinor, clientKey: key('cpay'), ...over });
const cashRows = (shiftId: string) => prisma().phCashMovement.findMany({ where: { shiftId }, orderBy: { createdAt: 'asc' } });
type Statement = { customer: { currency: string }; openingMinor: string; closingMinor: string; totalsByKind: Record<string, string>; rows: { id: string; kind: string; day: string; amountMinor: string; balanceMinor: string; method: string | null; saleNumber: string | null }[]; nextCursor: string | null };
type Ageing = { asOf: string; items: { customerId: string; currency: string; owedMinor: string; buckets: Record<string, string> }[]; totals: { currency: string; count: number; owedMinor: string; buckets: Record<string, string> }[] };

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  await resetWorld();
  w = await creditWorld();
});
afterEach(() => {
  vi.setSystemTime(NOW);
});

describe('taking a payment', () => {
  it('a cash payment lowers the balance, goes into the open shift as a CUSTOMER_PAYMENT and raises the expected cash', async () => {
    const c = await makeCustomer(w);
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    const done = dataOf(await act(w.manager, customerActions.pay, pay(c.id, 'CASH', 500n)));
    expect(done).toMatchObject({ method: 'CASH', amountMinor: '500', currency: 'IQD', balanceMinor: '1500', replayed: false, branchId: w.b1 });
    const row = await prisma().phCustomerPayment.findUniqueOrThrow({ where: { id: done.id } });
    expect(row).toMatchObject({ shiftId: w.shifts.manager, reversesId: null, createdById: w.manager.userId });
    expect((await cashRows(w.shifts.manager!)).map((r) => [r.type, r.amountMinor, r.refType, r.refId])).toEqual([['CUSTOMER_PAYMENT', 500n, 'customer_payment', done.id]]);
    const totals = await shiftNow(w, w.manager, w.b1);
    expect(totals.expectedMinor).toBe('500');
    expect(totals.cash).toMatchObject({ customerPaymentsMinor: '500', tenderedMinor: '0', refundsMinor: '0' });
    expect(await balanceBySql(c.id)).toBe(1500n);
  });

  it('a card or transfer payment needs no shift and touches no drawer; a cash one without a shift is refused and writes nothing', async () => {
    const c = await makeCustomer(w);
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    const noShift = await act(w.accountant, customerActions.pay, pay(c.id, 'CASH', 100n));
    expect([codeOf(noShift), phCodeOf(noShift)]).toEqual(['CONFLICT', 'NO_OPEN_SHIFT']);
    expect(await prisma().phCustomerPayment.count()).toBe(0);
    const card = dataOf(await act(w.accountant, customerActions.pay, pay(c.id, 'CARD', 300n)));
    const transfer = dataOf(await act(w.accountant, customerActions.pay, pay(c.id, 'TRANSFER', 200n)));
    expect([card.balanceMinor, transfer.balanceMinor]).toEqual(['1700', '1500']);
    expect(await prisma().phCashMovement.count()).toBe(0);
    expect((await prisma().phCustomerPayment.findMany()).every((r) => r.shiftId === null)).toBe(true);
  });

  it('refuses a payment above what is owed and accepts exactly what is owed', async () => {
    const c = await makeCustomer(w);
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    const over = await act(w.owner, customerActions.pay, pay(c.id, 'CARD', 2001n));
    expect(phCodeOf(over)).toBe('PAYMENT_EXCEEDS_BALANCE');
    if (over.ok) throw new Error('expected a refusal');
    expect(over.error.fields).toMatchObject({ owed: '2000' });
    expect(dataOf(await act(w.owner, customerActions.pay, pay(c.id, 'CARD', 2000n))).balanceMinor).toBe('0');
    expect(phCodeOf(await act(w.owner, customerActions.pay, pay(c.id, 'CARD', 1n)))).toBe('PAYMENT_EXCEEDS_BALANCE');
    expect(await prisma().phCustomerPayment.count()).toBe(1);
  });

  it('refuses a cash payment into a shift of another currency', async () => {
    const usd = await makeCustomer(w, { currency: 'USD', limit: 100_000n });
    dataOf(await sellOnCredit(w, w.usdSeller, usd.id, 2000n, { currency: 'USD' }));
    expect(phCodeOf(await act(w.manager, customerActions.pay, pay(usd.id, 'CASH', 100n)))).toBe('SHIFT_CURRENCY');
    expect(dataOf(await act(w.manager, customerActions.pay, pay(usd.id, 'CARD', 100n))).currency).toBe('USD');
  });

  it('takes a cash payment at branch 2 into the owner’s shift there', async () => {
    const c = await makeCustomer(w);
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    const done = dataOf(await act(w.owner, customerActions.pay, pay(c.id, 'CASH', 400n, { branchId: w.b2 })));
    expect(done.branchId).toBe(w.b2);
    expect((await cashRows(w.shifts.owner2!)).map((r) => r.amountMinor)).toEqual([400n]);
    expect(await cashRows(w.shifts.owner!)).toEqual([]);
  });

  it('is idempotent by key: the same request returns the stored payment, a different one is a mismatch', async () => {
    const c = await makeCustomer(w);
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    const input = pay(c.id, 'CASH', 500n);
    const first = dataOf(await act(w.manager, customerActions.pay, input));
    const again = dataOf(await act(w.manager, customerActions.pay, input));
    expect(again).toMatchObject({ id: first.id, replayed: true, balanceMinor: '1500' });
    expect(await prisma().phCustomerPayment.count()).toBe(1);
    expect(await prisma().phCustomerLedger.count({ where: { kind: 'PAYMENT' } })).toBe(1);
    expect(await prisma().phCashMovement.count({ where: { type: 'CUSTOMER_PAYMENT' } })).toBe(1);
    expect(phCodeOf(await act(w.manager, customerActions.pay, { ...input, amountMinor: 501n }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.manager, customerActions.pay, { ...input, method: 'CARD' }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.owner, customerActions.pay, input))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.owner, customerActions.pay, { ...input, branchId: w.b2 }))).toBe('CLIENT_KEY_MISMATCH');
    expect(await prisma().phCustomerPayment.count()).toBe(1);
  });

  it('writes one payment when the same request is sent twice at once', async () => {
    const c = await makeCustomer(w);
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    const input = pay(c.id, 'CASH', 500n);
    const both = await Promise.all([act(w.manager, customerActions.pay, input), act(w.manager, customerActions.pay, input)]);
    expect(both.every((r) => r.ok)).toBe(true);
    expect(await prisma().phCustomerPayment.count()).toBe(1);
    expect(await balanceBySql(c.id)).toBe(1500n);
  });

  it('never lets two parallel payments take more than is owed: two of 1 500 against 2 000 give one', async () => {
    const c = await makeCustomer(w);
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    const both = await Promise.all([act(w.manager, customerActions.pay, pay(c.id, 'CARD', 1500n)), act(w.owner, customerActions.pay, pay(c.id, 'CARD', 1500n))]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(await balanceBySql(c.id)).toBe(500n);
  });

  it('is for customer.manage: owner, manager, pharmacist in charge and accountant; not a pharmacist, cashier, stock or support', async () => {
    const c = await makeCustomer(w);
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 5000n));
    const out: Record<string, string> = {};
    for (const [label, who] of [['owner', w.owner], ['manager', w.manager], ['pic', w.pic], ['accountant', w.accountant], ['pharmacist', w.pharmacist], ['cashier', w.cashier], ['stock', w.stockClerk], ['support', w.support]] as const) {
      out[label] = codeOf(await act(who, customerActions.pay, pay(c.id, 'CARD', 100n)));
    }
    expect(out).toEqual({ owner: 'OK', manager: 'OK', pic: 'OK', accountant: 'OK', pharmacist: 'FORBIDDEN', cashier: 'FORBIDDEN', stock: 'FORBIDDEN', support: 'FORBIDDEN' });
    expect(await balanceBySql(c.id)).toBe(4600n);
  });

  it('does not find a customer of another business', async () => {
    const c = await makeCustomer(w);
    expect(codeOf(await act(w.ownerB, customerActions.pay, { restaurantId: w.b.id, branchId: w.b.branchId, customerId: c.id, method: 'CARD', amountMinor: 1n, clientKey: key('cpay') }))).toBe('NOT_FOUND');
    expect(await prisma().phCustomerPayment.count()).toBe(0);
  });

  it('audits ids, method, amount and currency only', async () => {
    const c = await makeCustomer(w, { name: 'Noor Ali', phone: '0780 333 4444', note: 'dialysis' });
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    dataOf(await act(w.manager, customerActions.pay, pay(c.id, 'CASH', 500n)));
    const rows = await prisma().auditLog.findMany({ where: { entityType: 'PhCustomerPayment' } });
    expect(rows).toHaveLength(1);
    const text = JSON.stringify(rows[0]!.changes);
    expect(text).toContain('"amountMinor"');
    expect(text).toContain(c.id);
    for (const secret of ['Noor', '0780', 'dialysis']) expect(text).not.toContain(secret);
  });
});

describe('correcting a payment', () => {
  const settled = async (method: 'CASH' | 'CARD') => {
    const c = await makeCustomer(w);
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    const done = dataOf(await act(w.manager, customerActions.pay, pay(c.id, method, 500n)));
    return { c, done };
  };
  const reverse = (paymentId: string, over: Record<string, unknown> = {}) => ({ ...at(), paymentId, clientKey: key('crev'), ...over });

  it('puts the debt back with a REVERSAL row and takes the cash out of the drawer again, counted apart from sale refunds', async () => {
    const { c, done } = await settled('CASH');
    const fixed = dataOf(await act(w.manager, customerActions.reverse, reverse(done.id)));
    expect(fixed).toMatchObject({ reversesId: done.id, amountMinor: '500', method: 'CASH', balanceMinor: '2000', replayed: false });
    expect((await prisma().phCustomerLedger.findMany({ where: { customerId: c.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map((r) => [r.kind, r.amountMinor])).toEqual([['CHARGE', 2000n], ['PAYMENT', -500n], ['REVERSAL', 500n]]);
    expect((await cashRows(w.shifts.manager!)).map((r) => [r.type, r.amountMinor, r.refType])).toEqual([['CUSTOMER_PAYMENT', 500n, 'customer_payment'], ['REFUND_CASH', -500n, 'customer_payment']]);
    const totals = await shiftNow(w, w.manager, w.b1);
    expect(totals.expectedMinor).toBe('0');
    expect(totals.cash).toMatchObject({ customerPaymentsMinor: '500', customerReversalsMinor: '500', refundsMinor: '0' });
    expect(await balanceBySql(c.id)).toBe(2000n);
  });

  it('corrects once only: another key is already corrected, and a correction cannot be corrected', async () => {
    const { done } = await settled('CASH');
    const fixed = dataOf(await act(w.manager, customerActions.reverse, reverse(done.id)));
    expect(phCodeOf(await act(w.manager, customerActions.reverse, reverse(done.id)))).toBe('ALREADY_REVERSED');
    expect(phCodeOf(await act(w.manager, customerActions.reverse, reverse(fixed.id)))).toBe('ALREADY_REVERSAL');
    expect(await prisma().phCustomerPayment.count()).toBe(2);
    expect(await prisma().phCashMovement.count({ where: { type: 'REFUND_CASH' } })).toBe(1);
  });

  it('is idempotent by key and lets only one of two parallel corrections win', async () => {
    const { done } = await settled('CASH');
    const input = reverse(done.id);
    const first = dataOf(await act(w.manager, customerActions.reverse, input));
    const again = dataOf(await act(w.manager, customerActions.reverse, input));
    expect(again).toMatchObject({ id: first.id, replayed: true });
    expect(phCodeOf(await act(w.manager, customerActions.reverse, { ...input, paymentId: 'someone-else' }))).toBe('CLIENT_KEY_MISMATCH');
    const other = await settled('CARD');
    const race = await Promise.all([act(w.manager, customerActions.reverse, reverse(other.done.id)), act(w.owner, customerActions.reverse, reverse(other.done.id))]);
    expect(race.filter((r) => r.ok)).toHaveLength(1);
    expect(race.filter((r) => !r.ok).map((r) => phCodeOf(r))).toEqual(['ALREADY_REVERSED']);
    expect(await prisma().phCustomerLedger.count({ where: { customerId: other.c.id, kind: 'REVERSAL' } })).toBe(1);
  });

  it('a cash payment can be corrected only by someone with an open shift here; a card one by anyone who manages customers', async () => {
    const cash = await settled('CASH');
    const refused = await act(w.accountant, customerActions.reverse, reverse(cash.done.id));
    expect([codeOf(refused), phCodeOf(refused)]).toEqual(['CONFLICT', 'NO_OPEN_SHIFT']);
    expect(await prisma().phCustomerPayment.count({ where: { reversesId: { not: null } } })).toBe(0);
    const card = await settled('CARD');
    expect(dataOf(await act(w.accountant, customerActions.reverse, reverse(card.done.id))).balanceMinor).toBe('2000');
  });

  it('is found only in the branch the payment was taken at, and not across businesses', async () => {
    const c = await makeCustomer(w);
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    const atTwo = dataOf(await act(w.owner, customerActions.pay, pay(c.id, 'CASH', 400n, { branchId: w.b2 })));
    expect(codeOf(await act(w.manager, customerActions.reverse, reverse(atTwo.id)))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.ownerB, customerActions.reverse, { restaurantId: w.b.id, branchId: w.b.branchId, paymentId: atTwo.id, clientKey: key('crev') }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.owner, customerActions.reverse, reverse(atTwo.id, { branchId: w.b1 })))).toBe('NOT_FOUND');
    expect(dataOf(await act(w.owner, customerActions.reverse, reverse(atTwo.id, { branchId: w.b2 }))).balanceMinor).toBe('2000');
  });

  it('is for customer.manage only', async () => {
    const { done } = await settled('CARD');
    for (const who of [w.pharmacist, w.cashier, w.stockClerk, w.support]) expect(codeOf(await act(who, customerActions.reverse, reverse(done.id)))).toBe('FORBIDDEN');
    expect(await prisma().phCustomerPayment.count()).toBe(1);
  });
});

describe('the records are never changed', () => {
  it('refuses any direct update or delete of a ledger row or a payment', async () => {
    const c = await makeCustomer(w);
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    const done = dataOf(await act(w.owner, customerActions.pay, pay(c.id, 'CARD', 500n)));
    const ledgerRow = await prisma().phCustomerLedger.findFirstOrThrow({ where: { customerId: c.id } });
    await expect(prisma().phCustomerLedger.update({ where: { id: ledgerRow.id }, data: { amountMinor: 1n } })).rejects.toThrow();
    await expect(prisma().phCustomerLedger.delete({ where: { id: ledgerRow.id } })).rejects.toThrow();
    await expect(prisma().phCustomerPayment.update({ where: { id: done.id }, data: { amountMinor: 1n } })).rejects.toThrow();
    await expect(prisma().phCustomerPayment.delete({ where: { id: done.id } })).rejects.toThrow();
    expect(await balanceBySql(c.id)).toBe(1500n);
  });
});

describe('statement and ageing', () => {
  async function history() {
    const c = await makeCustomer(w, { limit: 1_000_000n });
    vi.setSystemTime(new Date('2026-07-30T09:00:00.000Z'));
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 30_000n));
    vi.setSystemTime(new Date('2026-08-27T21:30:00.000Z'));
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 20_000n));
    vi.setSystemTime(new Date('2026-10-25T09:00:00.000Z'));
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 10_000n));
    vi.setSystemTime(new Date('2026-10-26T09:00:00.000Z'));
    const payment = dataOf(await act(w.owner, customerActions.pay, pay(c.id, 'CARD', 25_000n)));
    vi.setSystemTime(NOW);
    return { c, payment };
  }
  const statement = async (customerId: string, from: string, to: string, extra: Record<string, unknown> = {}) =>
    dataOf(await ask(w.accountant, customerQueries.statement, { ...at(), customerId, from, to, ...extra })) as Statement;
  /** The ledger summed by SQL over everything made before an instant. */
  const sqlSumBefore = async (customerId: string, instant: string) => {
    // eslint-disable-next-line no-restricted-properties -- the test sums the ledger itself, to check the statement against it
    const rows = await prisma().$queryRaw<{ s: bigint | null }[]>`SELECT COALESCE(SUM("amountMinor"), 0)::bigint AS s FROM "PhCustomerLedger" WHERE "customerId" = ${customerId} AND "createdAt" < ${new Date(instant)}::timestamptz`;
    return rows[0]!.s ?? 0n;
  };

  it('lists every row in order with the running balance, opening 0 and closing 35 000, on Baghdad days', async () => {
    const { c, payment } = await history();
    const s = await statement(c.id, '2026-07-01', '2026-10-31');
    expect(s.customer.currency).toBe('IQD');
    expect([s.openingMinor, s.closingMinor]).toEqual(['0', '35000']);
    expect(s.rows.map((r) => [r.kind, r.day, r.amountMinor, r.balanceMinor])).toEqual([
      ['CHARGE', '2026-07-30', '30000', '30000'],
      ['CHARGE', '2026-08-28', '20000', '50000'],
      ['CHARGE', '2026-10-25', '10000', '60000'],
      ['PAYMENT', '2026-10-26', '-25000', '35000'],
    ]);
    expect(s.rows[3]).toMatchObject({ method: 'CARD' });
    expect(s.rows[0]!.saleNumber).toMatch(/^\d{8}-\d+$/);
    expect(s.totalsByKind).toMatchObject({ CHARGE: '60000', PAYMENT: '-25000', REVERSAL: '0', REFUND: '0' });
    expect(s.closingMinor).toBe(String(await balanceBySql(c.id)));
    expect(payment.balanceMinor).toBe('35000');
  });

  it('starts a later range from the balance before it, agreeing with an independent sum (the 2026-08-28 Baghdad day starts at 21:00 UTC the evening before)', async () => {
    const { c } = await history();
    const fromAug28 = await statement(c.id, '2026-08-28', '2026-10-31');
    expect(fromAug28.openingMinor).toBe('30000');
    expect(fromAug28.openingMinor).toBe(String(await sqlSumBefore(c.id, '2026-08-27T21:00:00.000Z')));
    expect(fromAug28.rows.map((r) => r.balanceMinor)).toEqual(['50000', '60000', '35000']);
    const fromAug29 = await statement(c.id, '2026-08-29', '2026-10-31');
    expect(fromAug29.openingMinor).toBe('50000');
    expect(fromAug29.openingMinor).toBe(String(await sqlSumBefore(c.id, '2026-08-28T21:00:00.000Z')));
    const julyOnly = await statement(c.id, '2026-07-01', '2026-08-15');
    expect([julyOnly.openingMinor, julyOnly.closingMinor]).toEqual(['0', '30000']);
  });

  it('pages by cursor with the running balance carried over', async () => {
    const { c } = await history();
    const one = await statement(c.id, '2026-07-01', '2026-10-31', { pageSize: 2 });
    expect(one.rows.map((r) => r.balanceMinor)).toEqual(['30000', '50000']);
    expect(one.nextCursor).toBe(one.rows[1]!.id);
    const two = await statement(c.id, '2026-07-01', '2026-10-31', { pageSize: 2, cursor: one.nextCursor });
    expect(two.rows.map((r) => r.balanceMinor)).toEqual(['60000', '35000']);
    expect(two.nextCursor).toBeNull();
    expect([two.openingMinor, two.closingMinor]).toEqual(['0', '35000']);
  });

  it('refuses a range of more than a year, an end before the start, a bad date and a cursor outside the range', async () => {
    const { c } = await history();
    for (const bad of [{ from: '2025-01-01', to: '2026-10-31' }, { from: '2026-10-31', to: '2026-07-01' }, { from: '2026-13-01', to: '2026-10-31' }]) {
      expect(codeOf(await ask(w.accountant, customerQueries.statement, { ...at(), customerId: c.id, ...bad }))).toBe('INVALID');
    }
    const rows = await statement(c.id, '2026-07-01', '2026-10-31');
    expect(codeOf(await ask(w.accountant, customerQueries.statement, { ...at(), customerId: c.id, from: '2026-10-01', to: '2026-10-31', cursor: rows.rows[0]!.id }))).toBe('INVALID');
  });

  it('is for customer.manage and finds only the business’s own customers', async () => {
    const { c } = await history();
    for (const who of [w.pharmacist, w.cashier, w.support]) expect(codeOf(await ask(who, customerQueries.statement, { ...at(), customerId: c.id, from: '2026-07-01', to: '2026-10-31' }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(w.ownerB, customerQueries.statement, { restaurantId: w.b.id, customerId: c.id, from: '2026-07-01', to: '2026-10-31' }))).toBe('NOT_FOUND');
  });

  it('ages the debt oldest first on Baghdad days: 10 000 (0-30), 20 000 (31-60), 5 000 (61-90), 0 (90+) as of 2026-10-27', async () => {
    const { c } = await history();
    const a = dataOf(await ask(w.accountant, customerQueries.ageing, { ...at(), customerId: c.id })) as Ageing;
    expect(a.asOf).toBe('2026-10-27');
    expect(a.items).toHaveLength(1);
    expect(a.items[0]).toMatchObject({ customerId: c.id, currency: 'IQD', owedMinor: '35000', buckets: { '0-30': '10000', '31-60': '20000', '61-90': '5000', '90+': '0' } });
    expect(a.totals).toEqual([{ currency: 'IQD', count: 1, owedMinor: '35000', buckets: { '0-30': '10000', '31-60': '20000', '61-90': '5000', '90+': '0' } }]);
    const later = dataOf(await ask(w.accountant, customerQueries.ageing, { ...at(), customerId: c.id, asOf: '2026-12-31' })) as Ageing;
    expect(later.items[0]!.buckets).toEqual({ '0-30': '0', '31-60': '0', '61-90': '10000', '90+': '25000' });
  });

  it('agrees with an independent SQL ageing (cumulative charges against everything paid)', async () => {
    const { c } = await history();
    // eslint-disable-next-line no-restricted-properties -- the test ages the ledger itself in SQL, to check the service against it
    const sql = await prisma().$queryRaw<{ bucket: string; s: bigint }[]>`
      WITH ch AS (
        SELECT "amountMinor" AS a, (("createdAt" + interval '3 hours')::date) AS d,
               SUM("amountMinor") OVER (ORDER BY "createdAt", "id") AS cum
        FROM "PhCustomerLedger" WHERE "customerId" = ${c.id} AND "amountMinor" > 0
      ), paid AS (SELECT COALESCE(-SUM("amountMinor"), 0) AS p FROM "PhCustomerLedger" WHERE "customerId" = ${c.id} AND "amountMinor" < 0)
      SELECT CASE WHEN DATE '2026-10-27' - d <= 30 THEN '0-30' WHEN DATE '2026-10-27' - d <= 60 THEN '31-60' WHEN DATE '2026-10-27' - d <= 90 THEN '61-90' ELSE '90+' END AS bucket,
             SUM(GREATEST(0, LEAST(a, cum - p)))::bigint AS s
      FROM ch, paid GROUP BY 1`;
    const bySql = Object.fromEntries(sql.map((r) => [r.bucket, String(r.s)]));
    const a = dataOf(await ask(w.accountant, customerQueries.ageing, { ...at(), customerId: c.id })) as Ageing;
    for (const bucket of ['0-30', '31-60', '61-90', '90+']) expect(a.items[0]!.buckets[bucket], bucket).toBe(bySql[bucket] ?? '0');
  });

  it('a returned recent sale cancels its own charge: 30 000 owed for 89 days stays 61-90 whole (a first-in-first-out refund would show 20 000 old and 10 000 new)', async () => {
    const c = await makeCustomer(w, { limit: 1_000_000n });
    vi.setSystemTime(new Date('2026-07-30T09:00:00.000Z'));
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 30_000n));
    vi.setSystemTime(new Date('2026-10-25T09:00:00.000Z'));
    const recent = dataOf(await sellOnCredit(w, w.pharmacist, c.id, 10_000n));
    vi.setSystemTime(new Date('2026-10-26T09:00:00.000Z'));
    const lineId = (await prisma().phSaleLine.findFirstOrThrow({ where: { saleId: recent.id }, select: { id: true } })).id;
    dataOf(await act(w.manager, returnActions.create, { ...at(), saleId: recent.id, lines: [{ saleLineId: lineId, baseQty: 100 }], reason: 'Customer changed their mind', clientKey: key('ret') }));
    vi.setSystemTime(NOW);
    expect(await balanceBySql(c.id)).toBe(30_000n);
    const a = dataOf(await ask(w.accountant, customerQueries.ageing, { ...at(), customerId: c.id })) as Ageing;
    // By hand: the 10 000 sale is gone with its return; what is owed is the July sale, 89 days old on 2026-10-27.
    expect(a.items[0]!.buckets).toEqual({ '0-30': '0', '31-60': '0', '61-90': '30000', '90+': '0' });
  });

  it('a corrected payment goes back onto the debt it had settled: 5 000 paid then corrected leaves 30 000 in 61-90 and 10 000 in 0-30', async () => {
    const c = await makeCustomer(w, { limit: 1_000_000n });
    vi.setSystemTime(new Date('2026-07-30T09:00:00.000Z'));
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 30_000n));
    vi.setSystemTime(new Date('2026-10-25T09:00:00.000Z'));
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 10_000n));
    vi.setSystemTime(new Date('2026-10-26T09:00:00.000Z'));
    const paid = dataOf(await act(w.owner, customerActions.pay, pay(c.id, 'CARD', 5000n)));
    const before = dataOf(await ask(w.accountant, customerQueries.ageing, { ...at(), customerId: c.id })) as Ageing;
    expect(before.items[0]!.buckets).toEqual({ '0-30': '10000', '31-60': '0', '61-90': '25000', '90+': '0' });
    vi.setSystemTime(new Date('2026-10-27T06:00:00.000Z'));
    dataOf(await act(w.owner, customerActions.reverse, { ...at(), paymentId: paid.id, clientKey: key('crev') }));
    vi.setSystemTime(NOW);
    expect(await balanceBySql(c.id)).toBe(40_000n);
    const a = dataOf(await ask(w.accountant, customerQueries.ageing, { ...at(), customerId: c.id })) as Ageing;
    // By hand: the correction cancels the payment, so both sales are open in full: 30 000 from 07-30 (89 days) and 10 000 from 10-25 (2 days).
    expect(a.items[0]!.buckets).toEqual({ '0-30': '10000', '31-60': '0', '61-90': '30000', '90+': '0' });
  });

  it('a branch-limited viewer gets the same ageing as the owner when the corrected payment was taken at another branch', async () => {
    const c = await makeCustomer(w, { limit: 1_000_000n });
    vi.setSystemTime(new Date('2026-07-30T09:00:00.000Z'));
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 30_000n));
    vi.setSystemTime(new Date('2026-10-25T09:00:00.000Z'));
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 10_000n));
    vi.setSystemTime(new Date('2026-10-26T09:00:00.000Z'));
    // Taken and corrected at branch 2; the accountant works at branch 1 only and cannot see those payment rows.
    const paid = dataOf(await act(w.owner, customerActions.pay, pay(c.id, 'CARD', 5000n, { branchId: w.b2 })));
    vi.setSystemTime(new Date('2026-10-27T06:00:00.000Z'));
    dataOf(await act(w.owner, customerActions.reverse, { ...at(w.b2), paymentId: paid.id, clientKey: key('crev') }));
    vi.setSystemTime(NOW);
    const owner = dataOf(await ask(w.owner, customerQueries.ageing, { ...at(), customerId: c.id })) as Ageing;
    const accountant = dataOf(await ask(w.accountant, customerQueries.ageing, { ...at(), customerId: c.id })) as Ageing;
    expect(owner.items[0]!.buckets).toEqual({ '0-30': '10000', '31-60': '0', '61-90': '30000', '90+': '0' });
    expect(accountant).toEqual(owner);
    const st = (who: typeof w.owner) => ask(who, customerQueries.statement, { ...at(), customerId: c.id, from: '2026-07-01', to: '2026-10-31' }).then((r) => (dataOf(r) as { rows: { kind: string; corrected?: boolean }[] }).rows.filter((x) => x.kind === 'PAYMENT').map((x) => x.corrected));
    expect(await st(w.accountant)).toEqual(await st(w.owner));
    expect(await st(w.owner)).toEqual([true]);
  });

  it('keeps currencies apart and leaves out customers who owe nothing', async () => {
    const { c } = await history();
    const usd = await makeCustomer(w, { name: 'Dollar', currency: 'USD', limit: 100_000n });
    dataOf(await sellOnCredit(w, w.usdSeller, usd.id, 1500n, { currency: 'USD' }));
    const paidUp = await makeCustomer(w, { name: 'Paid up' });
    dataOf(await sellOnCredit(w, w.pharmacist, paidUp.id, 100n));
    dataOf(await act(w.owner, customerActions.pay, pay(paidUp.id, 'CARD', 100n)));
    const a = dataOf(await ask(w.accountant, customerQueries.ageing, at())) as Ageing;
    expect(a.items.map((i) => i.customerId).sort()).toEqual([c.id, usd.id].sort());
    expect(a.totals).toEqual([
      { currency: 'IQD', count: 1, owedMinor: '35000', buckets: { '0-30': '10000', '31-60': '20000', '61-90': '5000', '90+': '0' } },
      { currency: 'USD', count: 1, owedMinor: '1500', buckets: { '0-30': '1500', '31-60': '0', '61-90': '0', '90+': '0' } },
    ]);
  });

  it('after sales minus payments the balance is what the ledger sums to, corrections included', async () => {
    const c = await makeCustomer(w);
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 3000n));
    dataOf(await sellOnCredit(w, w.manager, c.id, 1200n));
    const p1 = dataOf(await act(w.manager, customerActions.pay, pay(c.id, 'CASH', 700n)));
    dataOf(await act(w.owner, customerActions.pay, pay(c.id, 'TRANSFER', 1000n)));
    dataOf(await act(w.manager, customerActions.reverse, { ...at(), paymentId: p1.id, clientKey: key('crev') }));
    // 3 000 + 1 200 - 700 - 1 000 + 700
    expect(await balanceBySql(c.id)).toBe(3200n);
    const got = dataOf(await ask(w.owner, customerQueries.get, { ...at(), customerId: c.id })) as { balanceMinor: string };
    expect(got.balanceMinor).toBe('3200');
  });
});
