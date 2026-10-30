import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as returnActions from '@/server/pharmacy/actions/returns';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as reports from '@/server/pharmacy/queries/reports';
import { NOW, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask, dataOf } from './stock-helpers';
import { creditWorld, key, makeCustomer, sellOnCredit, type CreditWorld } from './credit-world';

/**
 * Credit in the sales and returns reports (phase 7, task 3 fix; R7-5). Panadol is 100 IQD a tablet, so 10 tablets are 1 000 IQD.
 * Sales of the day (all at branch 1, no change given):
 *   A  20 tablets 2 000  wholly on credit
 *   B  20 tablets 2 000  cash 600 + credit 1 400
 *   C  10 tablets 1 000  cash
 * Returns of the day (10 tablets each unless said):
 *   RA  of A: 1 000, all of it off the customer's balance          (nothing handed back)
 *   RB1 of B: 1 000, all of it off the balance (B owes 1 400)       (nothing handed back)
 *   RB2 of B: 1 000, the last 400 off the balance, 600 in cash
 *   RC  of C: 5 tablets 500, cash
 * Hand figures: refunds 3 500, off the balance 2 400, handed back 1 100 (RB2 600 + RC 500), all of it cash.
 * Payments of the sales: cash 600 + 1 000 = 1 600 (2 sales); credit 2 000 + 1 400 = 3 400 (2 sales), on its own line.
 */

let w: CreditWorld;
const at = () => ({ restaurantId: w.a.id, branchId: w.b1 });
const DAY = { from: '2026-10-27', to: '2026-10-27' };
const lineOf = async (saleId: string) => (await prisma().phSaleLine.findFirstOrThrow({ where: { saleId }, select: { id: true } })).id;
const giveBack = async (saleId: string, qty: number) =>
  dataOf(await act(w.manager, returnActions.create, { ...at(), saleId, lines: [{ saleLineId: await lineOf(saleId), baseQty: qty }], reason: 'Customer changed their mind', clientKey: key('ret') }));

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
  const c = await makeCustomer(w);
  const a = dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
  const b = dataOf(await sellOnCredit(w, w.pharmacist, c.id, 1400n, {}, [{ method: 'CASH', amountMinor: 600n }]));
  const plain = dataOf(
    await act(w.pharmacist, saleActions.create, { ...at(), clientKey: key('sale'), currency: 'IQD', lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 10 }], payments: [{ method: 'CASH', amountMinor: 1000n, clientKey: key('pay') }] }),
  );
  await giveBack(a.id, 10);
  await giveBack(b.id, 10);
  await giveBack(b.id, 10);
  await giveBack(plain.id, 5);
});

describe('the returns report with credit', () => {
  it('shows what was taken off balances apart from what was handed back: refunds 3 500, off the balance 2 400, handed back 1 100 by cash', async () => {
    const r = dataOf(await ask(w.owner, reports.returns, { ...at(), ...DAY }));
    expect(r.totals).toEqual([{ currency: 'IQD', count: 4, refundMinor: '3500', creditMinor: '2400' }]);
    expect(r.byBranch).toEqual([{ branchId: w.b1, currency: 'IQD', count: 4, refundMinor: '3500', creditMinor: '2400' }]);
    // Money out by method: only the two returns that handed something back, and only what they handed back.
    expect(r.byMethod).toEqual([{ currency: 'IQD', method: 'CASH', count: 2, refundMinor: '1100' }]);
    const handed = r.byMethod.reduce((sum: bigint, m: { refundMinor: string }) => sum + BigInt(m.refundMinor), 0n);
    expect(BigInt(r.totals[0].refundMinor) - BigInt(r.totals[0].creditMinor)).toBe(handed);
  });

  it('lists each return with its credit part, and a return handed back in no way as CREDIT, never as cash', async () => {
    const r = dataOf(await ask(w.owner, reports.returns, { ...at(), ...DAY }));
    const byAmount = (rows: { refundMinor: string; creditMinor: string; method: string }[]) => rows.map((x) => [x.refundMinor, x.creditMinor, x.method]).sort();
    expect(byAmount(r.rows)).toEqual(
      [
        ['1000', '1000', 'CREDIT'],
        ['1000', '1000', 'CREDIT'],
        ['1000', '400', 'CASH'],
        ['500', '0', 'CASH'],
      ].sort(),
    );
  });

  it('a window with no return answers no credit', async () => {
    const r = dataOf(await ask(w.owner, reports.returns, { ...at(), from: '2026-10-20', to: '2026-10-21' }));
    expect(r.totals).toEqual([]);
    expect(r.byMethod).toEqual([]);
  });
});

describe('the sales report with credit', () => {
  it('shows credit as its own payment line, not as money received: cash 1 600 over 2 sales, credit 3 400 over 2 sales; refunds 3 500, net 1 500', async () => {
    const r = dataOf(await ask(w.owner, reports.sales, { ...at(), ...DAY }));
    expect(r.payments).toMatchObject([
      { currency: 'IQD', method: 'CASH', amountMinor: '1600', count: 2 },
      { currency: 'IQD', method: 'CREDIT', amountMinor: '3400', count: 2 },
    ]);
    expect(r.totals[0]).toMatchObject({ currency: 'IQD', count: 3, salesMinor: '5000', refundsMinor: '3500', netMinor: '1500' });
  });
});
