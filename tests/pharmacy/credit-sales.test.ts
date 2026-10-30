import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as customerActions from '@/server/pharmacy/actions/customers';
import * as returnActions from '@/server/pharmacy/actions/returns';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as customerQueries from '@/server/pharmacy/queries/customers';
import * as returnQueries from '@/server/pharmacy/queries/returns';
import { NOW, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask, balanceOf, codeOf, dataOf, phCodeOf } from './stock-helpers';
import { balanceBySql, creditSale, creditWorld, key, makeCustomer, sellOnCredit, shiftNow, type CreditWorld } from './credit-world';

/**
 * Selling on credit (phase 7, task 3; R7-5). Hand figures: Panadol is 100 IQD a tablet, so 20 tablets are 2 000 IQD. Batch L1 holds
 * 1 000 tablets at branch 1. A credit sale writes one CHARGE of its credit part in the sale's own transaction and never touches the
 * drawer; a return lowers the debt before it hands anything back.
 */

let w: CreditWorld;
const at = () => ({ restaurantId: w.a.id, branchId: w.b1 });
const stockOf = async () => (await balanceOf(w.batch1, w.b1))?.available;
const ledger = (customerId: string) => prisma().phCustomerLedger.findMany({ where: { customerId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
const cashRows = (shiftId: string) => prisma().phCashMovement.findMany({ where: { shiftId }, orderBy: { createdAt: 'asc' } });

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

describe('a sale wholly on credit', () => {
  it('charges the customer once, takes no cash, and the drawer does not move', async () => {
    const c = await makeCustomer(w, { limit: 100_000n });
    const made = dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    expect(made).toMatchObject({ status: 'COMPLETED', totalMinor: '2000', paidMinor: '2000', changeMinor: '0', replayed: false });
    const sale = await prisma().phSale.findUniqueOrThrow({ where: { id: made.id } });
    expect(sale.customerId).toBe(c.id);
    const rows = await ledger(c.id);
    expect(rows.map((r) => [r.kind, r.amountMinor, r.saleId])).toEqual([['CHARGE', 2000n, made.id]]);
    expect(await balanceBySql(c.id)).toBe(2000n);
    // The payment is a CREDIT line of the sale; nothing is in the drawer.
    const pays = await prisma().phPayment.findMany({ where: { saleId: made.id } });
    expect(pays.map((p) => [p.method, p.amountMinor])).toEqual([['CREDIT', 2000n]]);
    expect(await cashRows(w.shifts.pharmacist!)).toEqual([]);
    const totals = await shiftNow(w, w.pharmacist, w.b1);
    expect(totals.expectedMinor).toBe('0');
    expect(totals.cash).toMatchObject({ tenderedMinor: '0', customerPaymentsMinor: '0' });
    expect(totals.payments).toEqual([{ method: 'CREDIT', count: 1, amountMinor: '2000' }]);
    expect(await stockOf()).toBe(980);
  });

  it('shows the customer’s balance and the room left under the limit', async () => {
    const c = await makeCustomer(w, { limit: 5000n });
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    const got = dataOf(await ask(w.pharmacist, customerQueries.get, { ...at(), customerId: c.id })) as { balanceMinor: string; availableMinor: string };
    expect([got.balanceMinor, got.availableMinor]).toEqual(['2000', '3000']);
  });
});

describe('a sale partly on credit', () => {
  it('cash 800 + credit 1 200 of 2 000: only the 800 is in the drawer, the 1 200 is owed, and the shift shows credit as its own line', async () => {
    const c = await makeCustomer(w, { limit: 100_000n });
    const made = dataOf(await sellOnCredit(w, w.pharmacist, c.id, 1200n, {}, [{ method: 'CASH', amountMinor: 800n }]));
    expect(made).toMatchObject({ totalMinor: '2000', paidMinor: '2000', changeMinor: '0' });
    const cash = await cashRows(w.shifts.pharmacist!);
    expect(cash.map((r) => [r.type, r.amountMinor])).toEqual([['SALE_CASH', 800n]]);
    const totals = await shiftNow(w, w.pharmacist, w.b1);
    expect(totals.expectedMinor).toBe('800');
    expect(totals.cash.tenderedMinor).toBe('800');
    expect(totals.payments.map((p) => [p.method, p.amountMinor])).toEqual([['CASH', '800'], ['CREDIT', '1200']]);
    expect(await balanceBySql(c.id)).toBe(1200n);
  });

  it('works with card too, and cash above what is still due gives change (card 300 + cash 700 + credit 1 200 = 2 200 against 2 000: change 200)', async () => {
    const c = await makeCustomer(w, { limit: 100_000n });
    const made = dataOf(await sellOnCredit(w, w.pharmacist, c.id, 1200n, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 20 }] }, [{ method: 'CARD_MANUAL', amountMinor: 300n }, { method: 'CASH', amountMinor: 700n }]));
    expect(made.paidMinor).toBe('2200');
    expect(made.changeMinor).toBe('200');
    expect(await balanceBySql(c.id)).toBe(1200n);
  });
});

describe('the limit', () => {
  it('allows a charge that lands exactly on the limit and refuses one more unit, writing nothing', async () => {
    const c = await makeCustomer(w, { limit: 5000n });
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 3000n));
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    expect(await balanceBySql(c.id)).toBe(5000n);
    const sales = await prisma().phSale.count();
    const stock = await stockOf();
    const over = await sellOnCredit(w, w.pharmacist, c.id, 100n);
    expect([codeOf(over), phCodeOf(over)]).toEqual(['CONFLICT', 'CREDIT_LIMIT_EXCEEDED']);
    expect(await prisma().phSale.count()).toBe(sales);
    expect(await stockOf()).toBe(stock);
    expect(await balanceBySql(c.id)).toBe(5000n);
    expect(await prisma().phCustomerLedger.count({ where: { customerId: c.id } })).toBe(2);
    expect(await prisma().phPayment.count({ where: { method: 'CREDIT' } })).toBe(2);
  });

  it('refuses a first sale above the limit and tells how much room there is', async () => {
    const c = await makeCustomer(w, { limit: 1500n });
    const r = await sellOnCredit(w, w.pharmacist, c.id, 2000n);
    expect(phCodeOf(r)).toBe('CREDIT_LIMIT_EXCEEDED');
    if (r.ok) throw new Error('expected a refusal');
    expect(r.error.fields).toMatchObject({ available: '1500', requested: '2000' });
    expect(await prisma().phSale.count()).toBe(0);
    expect(await stockOf()).toBe(1000);
  });

  it('a customer with limit 0 can buy nothing on credit', async () => {
    const c = await makeCustomer(w, { limit: 0n });
    expect(phCodeOf(await sellOnCredit(w, w.pharmacist, c.id, 100n))).toBe('CREDIT_LIMIT_EXCEEDED');
  });

  it('lowering the limit below the balance blocks new credit but keeps the debt', async () => {
    const c = await makeCustomer(w, { limit: 5000n });
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 4000n));
    dataOf(await act(w.owner, customerActions.update, { ...at(), customerId: c.id, expectedVersion: 1, name: 'Layla Hassan', creditLimitMinor: 1000n }));
    expect(phCodeOf(await sellOnCredit(w, w.pharmacist, c.id, 100n))).toBe('CREDIT_LIMIT_EXCEEDED');
    expect(await balanceBySql(c.id)).toBe(4000n);
  });

  it('never lets parallel credit sales pass the limit: four sales of 1 000 against a limit of 3 000 give exactly three', async () => {
    const c = await makeCustomer(w, { limit: 3000n });
    const sellers = [w.pharmacist, w.manager, w.pic, w.owner];
    const results = await Promise.all(sellers.map((who) => sellOnCredit(w, who, c.id, 1000n)));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok).map((r) => phCodeOf(r))).toEqual(['CREDIT_LIMIT_EXCEEDED']);
    expect(await balanceBySql(c.id)).toBe(3000n);
    expect(await prisma().phSale.count()).toBe(3);
    expect(await prisma().phCustomerLedger.count({ where: { customerId: c.id } })).toBe(3);
    expect(await stockOf()).toBe(1000 - 30);
  });
});

describe('what a credit sale refuses', () => {
  it('refuses in another currency than the customer’s, and sells a USD customer in USD', async () => {
    const usd = await makeCustomer(w, { name: 'Dollar customer', currency: 'USD', limit: 100_000n });
    const iqd = await makeCustomer(w, { name: 'Dinar customer', limit: 100_000n });
    const wrong = await sellOnCredit(w, w.pharmacist, usd.id, 2000n);
    expect(phCodeOf(wrong)).toBe('CUSTOMER_CURRENCY');
    expect(await prisma().phSale.count()).toBe(0);
    const right = dataOf(await sellOnCredit(w, w.usdSeller, usd.id, 2000n, { currency: 'USD' }));
    expect(right).toMatchObject({ currency: 'USD', totalMinor: '2000' });
    expect(await balanceBySql(usd.id)).toBe(2000n);
    expect(phCodeOf(await sellOnCredit(w, w.usdSeller, iqd.id, 2000n, { currency: 'USD' }))).toBe('CUSTOMER_CURRENCY');
    expect(await balanceBySql(iqd.id)).toBe(0n);
  });

  it('refuses when credit is switched off', async () => {
    const c = await makeCustomer(w);
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { creditEnabled: false } });
    expect(phCodeOf(await sellOnCredit(w, w.pharmacist, c.id, 1000n))).toBe('CREDIT_NOT_ENABLED');
    expect(await prisma().phSale.count()).toBe(0);
  });

  it('lets a pharmacist, a manager, the pharmacist in charge and the owner sell on credit, but not a cashier', async () => {
    const c = await makeCustomer(w);
    const codes: Record<string, string> = {};
    for (const [label, who] of [['pharmacist', w.pharmacist], ['manager', w.manager], ['pic', w.pic], ['owner', w.owner], ['cashier', w.cashier]] as const) {
      codes[label] = phCodeOf(await sellOnCredit(w, who, c.id, 100n));
    }
    expect(codes).toEqual({ pharmacist: 'OK', manager: 'OK', pic: 'OK', owner: 'OK', cashier: 'CREDIT_NOT_ALLOWED' });
    expect(await balanceBySql(c.id)).toBe(400n);
  });

  it('keeps the cashier able to sell for cash exactly as before', async () => {
    const r = await act(w.cashier, saleActions.create, creditSale(w, undefined, 0n, { payments: [{ method: 'CASH', amountMinor: 2000n, clientKey: key('pay') }], lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 20 }] }));
    expect(dataOf(r)).toMatchObject({ status: 'COMPLETED', totalMinor: '2000' });
  });

  it('needs a customer for credit and refuses a customer without credit', async () => {
    const c = await makeCustomer(w);
    expect(phCodeOf(await act(w.pharmacist, saleActions.create, creditSale(w, undefined, 1000n)))).toBe('CREDIT_NEEDS_CUSTOMER');
    const cashOnly = creditSale(w, c.id, 0n, { payments: [{ method: 'CASH', amountMinor: 2000n, clientKey: key('pay') }], lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 20 }] });
    expect(phCodeOf(await act(w.pharmacist, saleActions.create, cashOnly))).toBe('CUSTOMER_WITHOUT_CREDIT');
    expect(await prisma().phSale.count()).toBe(0);
  });

  it('refuses an archived customer, a customer of another business and two credit payments', async () => {
    const c = await makeCustomer(w);
    const other = await makeCustomer(w, { name: 'Elsewhere', restaurantId: w.b.id, who: w.ownerB });
    expect(phCodeOf(await sellOnCredit(w, w.pharmacist, other.id, 1000n))).toBe('CUSTOMER_NOT_FOUND');
    const twice = creditSale(w, c.id, 1000n);
    twice.payments.push({ method: 'CREDIT', amountMinor: 1000n, clientKey: key('pay') });
    twice.lines = [{ productId: w.p.id, unitId: w.p.tablet, qty: 20 }];
    expect(phCodeOf(await act(w.pharmacist, saleActions.create, twice))).toBe('PAYMENT_INVALID');
    dataOf(await act(w.owner, customerActions.archive, { ...at(), customerId: c.id, archived: true }));
    expect(phCodeOf(await sellOnCredit(w, w.pharmacist, c.id, 1000n))).toBe('CUSTOMER_INACTIVE');
    expect(await prisma().phSale.count()).toBe(0);
    expect(await prisma().phCustomerLedger.count()).toBe(0);
  });

  it('leaves a branch-limited seller able to sell on credit to a business-wide customer', async () => {
    const c = await makeCustomer(w);
    const made = dataOf(await act(w.pharmacist2, saleActions.create, { ...creditSale(w, c.id, 3000n), branchId: w.b2 }));
    expect(made.branchId).toBe(w.b2);
    const first = dataOf(await sellOnCredit(w, w.pharmacist, c.id, 1000n));
    expect(first.branchId).toBe(w.b1);
    expect(await balanceBySql(c.id)).toBe(4000n);
  });
});

describe('replay', () => {
  it('returns the same sale for the same key with one CHARGE, and refuses the key for a different sale', async () => {
    const c = await makeCustomer(w);
    const input = creditSale(w, c.id, 2000n);
    const first = dataOf(await act(w.pharmacist, saleActions.create, input));
    const again = dataOf(await act(w.pharmacist, saleActions.create, input));
    expect(again).toMatchObject({ id: first.id, replayed: true });
    expect(await prisma().phCustomerLedger.count({ where: { customerId: c.id, kind: 'CHARGE' } })).toBe(1);
    expect(await balanceBySql(c.id)).toBe(2000n);
    const other = await makeCustomer(w, { name: 'Another' });
    const changed = await act(w.pharmacist, saleActions.create, { ...input, customerId: other.id });
    expect(phCodeOf(changed)).toBe('CLIENT_KEY_MISMATCH');
    expect(await balanceBySql(other.id)).toBe(0n);
  });

  it('writes one CHARGE even when the same request is sent twice at once', async () => {
    const c = await makeCustomer(w);
    const input = creditSale(w, c.id, 2000n);
    const both = await Promise.all([act(w.pharmacist, saleActions.create, input), act(w.pharmacist, saleActions.create, input)]);
    expect(both.every((r) => r.ok)).toBe(true);
    expect(await prisma().phSale.count()).toBe(1);
    expect(await prisma().phCustomerLedger.count({ where: { customerId: c.id } })).toBe(1);
  });
});

describe('audit', () => {
  it('records the customer id and the credit amount, never a name, phone or note', async () => {
    const c = await makeCustomer(w, { name: 'Hawraa Salman', phone: '0750 111 2222', note: 'chronic patient' });
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 1000n));
    const rows = await prisma().auditLog.findMany({ where: { entityType: 'PhSale' } });
    const text = JSON.stringify(rows.map((r) => r.changes));
    expect(text).toContain(c.id);
    expect(text).toContain('creditMinor');
    for (const secret of ['Hawraa', '0750', 'chronic']) expect(text).not.toContain(secret);
  });
});

describe('returning a credit sale', () => {
  const returnOf = (saleId: string, lineId: string, qty: number, over: Record<string, unknown> = {}) => ({ ...at(), saleId, lines: [{ saleLineId: lineId, baseQty: qty }], reason: 'Customer changed their mind', clientKey: key('ret'), ...over });
  const lineOf = async (saleId: string) => (await prisma().phSaleLine.findFirstOrThrow({ where: { saleId }, select: { id: true } })).id;

  it('a sale wholly on credit refunds to the balance only: nothing is handed back and no cash leaves the drawer', async () => {
    const c = await makeCustomer(w);
    const sale = dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    const done = dataOf(await act(w.manager, returnActions.create, returnOf(sale.id, await lineOf(sale.id), 10)));
    expect(done).toMatchObject({ refundMinor: '1000', creditMinor: '1000' });
    expect((await ledger(c.id)).map((r) => [r.kind, r.amountMinor])).toEqual([['CHARGE', 2000n], ['REFUND', -1000n]]);
    expect(await balanceBySql(c.id)).toBe(1000n);
    expect((await cashRows(w.shifts.manager!)).filter((r) => r.type === 'REFUND_CASH')).toEqual([]);
    const stored = await prisma().phReturn.findUniqueOrThrow({ where: { id: done.id } });
    expect([stored.refundMinor, stored.creditMinor]).toEqual([1000n, 1000n]);
  });

  it('cash 600 + credit 1 400 of 2 000: the first half (1 000) is all credit, the second half takes the last 400 off the debt and gives 600 back in cash', async () => {
    const c = await makeCustomer(w);
    const sale = dataOf(await sellOnCredit(w, w.pharmacist, c.id, 1400n, {}, [{ method: 'CASH', amountMinor: 600n }]));
    const lineId = await lineOf(sale.id);
    const first = dataOf(await act(w.manager, returnActions.create, returnOf(sale.id, lineId, 10)));
    expect(first).toMatchObject({ refundMinor: '1000', creditMinor: '1000', refundMethod: 'CASH' });
    expect(await balanceBySql(c.id)).toBe(400n);
    const second = dataOf(await act(w.manager, returnActions.create, returnOf(sale.id, lineId, 10)));
    expect(second).toMatchObject({ refundMinor: '1000', creditMinor: '400', saleStatus: 'RETURNED_FULL' });
    expect(await balanceBySql(c.id)).toBe(0n);
    expect((await ledger(c.id)).map((r) => [r.kind, r.amountMinor])).toEqual([['CHARGE', 1400n], ['REFUND', -1000n], ['REFUND', -400n]]);
    // Only the 600 handed back is a cash movement; the refunds add up to what was paid (2 000).
    const refunds = (await cashRows(w.shifts.manager!)).filter((r) => r.type === 'REFUND_CASH');
    expect(refunds.map((r) => r.amountMinor)).toEqual([-600n]);
    expect(first.refundMinor).toBe('1000');
    const totals = await shiftNow(w, w.manager, w.b1);
    expect(totals.cash.refundsMinor).toBe('600');
    expect(totals.returns).toMatchObject({ refundMinor: '2000', creditMinor: '1400' });
    expect(totals.returns.byMethod).toEqual([{ method: 'CASH', count: 2, amountMinor: '600' }]);
  });

  it('when the customer already paid their whole debt, a refund goes back by the original method and the balance is not pushed below zero', async () => {
    const c = await makeCustomer(w);
    const sale = dataOf(await sellOnCredit(w, w.pharmacist, c.id, 1400n, {}, [{ method: 'CASH', amountMinor: 600n }]));
    dataOf(await act(w.owner, customerActions.pay, { ...at(), customerId: c.id, method: 'CARD', amountMinor: 1400n, clientKey: key('cpay') }));
    expect(await balanceBySql(c.id)).toBe(0n);
    const done = dataOf(await act(w.manager, returnActions.create, returnOf(sale.id, await lineOf(sale.id), 20)));
    expect(done).toMatchObject({ refundMinor: '2000', creditMinor: '0', refundMethod: 'CASH' });
    expect(await balanceBySql(c.id)).toBe(0n);
    expect((await cashRows(w.shifts.manager!)).filter((r) => r.type === 'REFUND_CASH').map((r) => r.amountMinor)).toEqual([-2000n]);
  });

  it('a partial payment shrinks the credit part: paid 300 of 1 400, a full return takes the remaining 1 100 off the debt and gives 900 back', async () => {
    const c = await makeCustomer(w);
    const sale = dataOf(await sellOnCredit(w, w.pharmacist, c.id, 1400n, {}, [{ method: 'CASH', amountMinor: 600n }]));
    dataOf(await act(w.owner, customerActions.pay, { ...at(), customerId: c.id, method: 'TRANSFER', amountMinor: 300n, clientKey: key('cpay') }));
    const done = dataOf(await act(w.manager, returnActions.create, returnOf(sale.id, await lineOf(sale.id), 20)));
    expect(done).toMatchObject({ refundMinor: '2000', creditMinor: '1100' });
    expect(await balanceBySql(c.id)).toBe(0n);
    expect((await cashRows(w.shifts.manager!)).filter((r) => r.type === 'REFUND_CASH').map((r) => r.amountMinor)).toEqual([-900n]);
  });

  it('refuses a refund method the sale was not paid with (credit is not one) and offers only the real methods', async () => {
    const c = await makeCustomer(w);
    const sale = dataOf(await sellOnCredit(w, w.pharmacist, c.id, 1400n, {}, [{ method: 'CASH', amountMinor: 600n }]));
    const lineId = await lineOf(sale.id);
    expect(phCodeOf(await act(w.manager, returnActions.create, returnOf(sale.id, lineId, 1, { refundMethod: 'CARD_MANUAL' })))).toBe('REFUND_METHOD_NOT_PAID');
    expect(codeOf(await act(w.manager, returnActions.create, returnOf(sale.id, lineId, 1, { refundMethod: 'CREDIT' })))).toBe('INVALID');
    const returnable = dataOf(await ask(w.manager, returnQueries.returnable, { ...at(), saleId: sale.id })) as { paidMethods: string[]; defaultRefundMethod: string };
    expect(returnable.paidMethods).toEqual(['CASH']);
    expect(returnable.defaultRefundMethod).toBe('CASH');
  });

  it('cancelling a credit sale clears the whole debt of that sale', async () => {
    const c = await makeCustomer(w);
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 500n));
    const sale = dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    const done = dataOf(await act(w.manager, returnActions.cancel, { ...at(), saleId: sale.id, reason: 'Entered by mistake', clientKey: key('cancel') }));
    expect(done).toMatchObject({ refundMinor: '2000', creditMinor: '2000' });
    expect(await balanceBySql(c.id)).toBe(500n);
  });

  it('replays a return by its key with one REFUND row', async () => {
    const c = await makeCustomer(w);
    const sale = dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    const input = returnOf(sale.id, await lineOf(sale.id), 10);
    const first = dataOf(await act(w.manager, returnActions.create, input));
    const again = dataOf(await act(w.manager, returnActions.create, input));
    expect(again).toMatchObject({ id: first.id, creditMinor: '1000', replayed: true });
    expect(await prisma().phCustomerLedger.count({ where: { customerId: c.id, kind: 'REFUND' } })).toBe(1);
  });

  it('keeps the return of a sale with no credit exactly as it was (creditMinor 0)', async () => {
    const sale = dataOf(await act(w.pharmacist, saleActions.create, creditSale(w, undefined, 0n, { payments: [{ method: 'CASH', amountMinor: 2000n, clientKey: key('pay') }], lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 20 }] })));
    const done = dataOf(await act(w.manager, returnActions.create, returnOf(sale.id, await lineOf(sale.id), 5)));
    expect(done).toMatchObject({ refundMinor: '500', creditMinor: '0' });
    expect((await cashRows(w.shifts.manager!)).filter((r) => r.type === 'REFUND_CASH').map((r) => r.amountMinor)).toEqual([-500n]);
  });
});
