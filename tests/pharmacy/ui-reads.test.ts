import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as customerActions from '@/server/pharmacy/actions/customers';
import * as rxActions from '@/server/pharmacy/actions/prescriptions';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as customerQueries from '@/server/pharmacy/queries/customers';
import * as rxQueries from '@/server/pharmacy/queries/prescriptions';
import * as sellQueries from '@/server/pharmacy/queries/sell';
import { NOW, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask, codeOf, dataOf, makeBatch, makeProduct, phCodeOf } from './stock-helpers';
import { creditWorld, key, makeCustomer, sellOnCredit, type CreditWorld } from './credit-world';

/**
 * What the phase 7 screens read (task 5). Hand figures: Morphex is RESTRICTED and sells by the tablet at 100 IQD.
 *  - Controlled sales off: the sale search marks it "not sellable" with a reason and a hold of it is refused (nothing after the fact
 *    for the person: the screen shows it as unavailable at search time). On: both let it through, and the sale judges the prescription.
 *  - Three sales of one tablet each, all made at the same instant (2026-10-27 12:00 in Baghdad): the register is read two rows at a
 *    time newest first, by cursor, and the second page holds the one row left with no overlap, even though all three share a timestamp.
 *  - A customer pays 500 of a 2 000 sale on credit by card and the payment is corrected: the PAYMENT row says it was corrected, the
 *    REVERSAL row and an uncorrected second payment do not.
 */

let w: CreditWorld;
let morphex: { id: string; tablet: string; strip: string };
const at = () => ({ restaurantId: w.a.id, branchId: w.b1 });

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
  morphex = await makeProduct(w.a.id, 'Morphex');
  await prisma().phProduct.update({ where: { id: morphex.id }, data: { rxLevel: 'RESTRICTED' } });
  for (const [unitId, amountMinor] of [[morphex.tablet, 100n], [morphex.strip, 900n]] as const) {
    await prisma().phPrice.create({ data: { restaurantId: w.a.id, productId: morphex.id, unitId, branchId: null, currency: 'IQD', amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
  }
  await makeBatch(w.a.id, w.b1, morphex.id, { lot: 'M1', expiry: '2028-03-31', buckets: { available: 100 } });
});
afterEach(() => {
  vi.setSystemTime(NOW);
});

const controlled = (on: boolean) => prisma().phSettings.updateMany({ where: { restaurantId: w.a.id }, data: { controlledEnabled: on } });
const hold = () => ({ ...at(), clientKey: key('hold'), currency: 'IQD', lines: [{ productId: morphex.id, unitId: morphex.tablet, qty: 1 }] });
const search = () => ask(w.cashier, sellQueries.search, { ...at(), q: 'morphex' });

describe('the sale search and holds follow the controlled-sales setting', () => {
  it('off: the product is found but marked not sellable, and a hold of it is refused', async () => {
    await controlled(false);
    const found = dataOf(await search());
    expect(found.items[0]).toMatchObject({ rxLevel: 'RESTRICTED', notSellable: true });
    expect(found.items[0].notSellableReason).toBeTruthy();
    expect(phCodeOf(await act(w.cashier, saleActions.hold, hold()))).toBe('RESTRICTED_NOT_AVAILABLE');
    expect(await prisma().phSale.count()).toBe(0);
  });

  it('on: the product is sellable in the search and can be held; the sale still needs the prescription', async () => {
    await controlled(true);
    const found = dataOf(await search());
    expect(found.items[0]).toMatchObject({ rxLevel: 'RESTRICTED', notSellable: false });
    expect(found.items[0].notSellableReason ?? null).toBeNull();
    expect(dataOf(await act(w.cashier, saleActions.hold, hold()))).toMatchObject({ status: 'HELD' });
    const noRx = await act(w.pharmacist, saleActions.create, { ...at(), clientKey: key('sale'), currency: 'IQD', lines: hold().lines, payments: [{ method: 'CASH', amountMinor: 100n, clientKey: key('pay') }] });
    expect(phCodeOf(noRx)).toBe('PRESCRIPTION_REQUIRED');
  });
});

describe('the controlled register is read by cursor and range', () => {
  const sellOne = async (n: number) => {
    const rx = dataOf(
      await act(w.pharmacist, rxActions.create, { ...at(), clientKey: key('rx'), number: `AB ${n}`, prescriberName: 'Dr Strange', patientName: `Patient ${n}`, patientIdNote: 'National ID: 4821', issuedOn: '2026-10-20' }),
    );
    dataOf(await act(w.pharmacist, saleActions.create, { ...at(), clientKey: key('sale'), currency: 'IQD', lines: hold().lines, prescriptionId: rx.id, payments: [{ method: 'CASH', amountMinor: 100n, clientKey: key('pay') }] }));
  };
  const read = async (over: Record<string, unknown> = {}) => dataOf(await ask(w.pharmacist, rxQueries.register, { ...at(), ...over })) as { id: string }[];

  it('pages two at a time with no overlap and no gap, and keeps to the range', async () => {
    await controlled(true);
    for (const n of [1, 2, 3]) await sellOne(n);
    const first = await read({ limit: 2 });
    expect(first).toHaveLength(2);
    const second = await read({ limit: 2, cursor: first[1]!.id });
    expect(second).toHaveLength(1);
    expect(new Set([...first, ...second].map((r) => r.id)).size).toBe(3);
    expect(await read({ from: '2026-10-27', to: '2026-10-27' })).toHaveLength(3);
    expect(await read({ from: '2026-10-01', to: '2026-10-26' })).toHaveLength(0);
    expect(codeOf(await ask(w.pharmacist, rxQueries.register, { ...at(), from: '2026-10-27' }))).toBe('INVALID');
    expect(codeOf(await ask(w.pharmacist, rxQueries.register, { ...at(), from: '2025-01-01', to: '2026-10-27' }))).toBe('INVALID');
  });
});

describe('the statement says which payments were corrected', () => {
  it('marks only the corrected PAYMENT row', async () => {
    const c = await makeCustomer(w);
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 2000n));
    const pay = (amountMinor: bigint) => act(w.manager, customerActions.pay, { ...at(), customerId: c.id, method: 'CARD', amountMinor, clientKey: key('cpay') });
    const first = dataOf(await pay(500n));
    dataOf(await pay(300n));
    dataOf(await act(w.manager, customerActions.reverse, { ...at(), paymentId: first.id, clientKey: key('crev') }));
    const statement = dataOf(await ask(w.manager, customerQueries.statement, { ...at(), customerId: c.id, from: '2026-10-01', to: '2026-10-31' })) as { rows: { kind: string; amountMinor: string; paymentId: string | null; corrected: boolean }[] };
    const flags = statement.rows.map((r) => [r.kind, r.amountMinor, r.corrected]);
    expect(flags).toEqual([['CHARGE', '2000', false], ['PAYMENT', '-500', true], ['PAYMENT', '-300', false], ['REVERSAL', '500', false]]);
  });
});
