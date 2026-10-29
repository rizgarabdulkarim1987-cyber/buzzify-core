import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { scopedClient } from '@/server/data/tenant-db';
import { consolidate } from '@/server/domain/pharmacy/reports-domain';
import { costOfBaseQty } from '@/server/domain/pharmacy/stock';
import * as returnActions from '@/server/pharmacy/actions/returns';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as stockActions from '@/server/pharmacy/actions/stock';
import * as transferActions from '@/server/pharmacy/actions/transfers';
import * as reports from '@/server/pharmacy/queries/reports';
import { marginReport, salesReport } from '@/server/pharmacy/reports';
import { stockValuation } from '@/server/pharmacy/reports-stock';
import { asPh, grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import type { ActionResult } from '@/server/studio/framework/result';
import { act, ask, codeOf, dataOf as typedDataOf, makeProduct, stockInto } from './stock-helpers';

/* eslint-disable @typescript-eslint/no-explicit-any -- the tests read many shapes of report off the wire and check them by value */
const dataOf = (result: ActionResult<unknown>): any => typedDataOf(result);

/**
 * Pharmacy reports (phase 6, task 4). The world is built through the real services (sales across two branches and two Baghdad
 * days, IQD and USD, discounts, two returns, batches with and without cost, one in another currency, a transfer on the road,
 * one received short, damaged stock, an adjustment) and every report is asserted against figures worked out by hand below.
 * The tests only read, so the world is built once.
 *
 * Clock: D1 = 2026-10-27 (Baghdad), D2 = 2026-10-28. S3 is rung at 21:30 UTC on the 27th, which is 00:30 on the 28th in Baghdad.
 *
 * Sales (IQD unless said), seller, branch, what, hand figures (gross - discount = total):
 *   S1 D1 cashier1 b1  2 strips P     1800 - 0   = 1800   cash 2000 (change 200)   cost 20 base of PB1 705/strip = 1410
 *   S2 D1 cashier1 b1  3 tablets P    300 - 15   = 285    card                       cost floor(705*3/10) = 211
 *   S3 D2 cashier1 b1  1 strip Q      2000 - 0   = 2000   transfer                   Q at b1 has NO cost
 *   S4 D1 cashier2 b2  5 tablets P    500 - 0    = 500    cash                       cost 5 base of PB2 600/strip = 300
 *   S5 D2 cashier2 b2  4 tablets Q    1000 - 0   = 1000   cash                       Q at b2 costs 100 USD/strip (other currency)
 *   S8 D2 owner    b1  1 strip P 10%  900 - 90   = 810    cash                       cost 705
 *   S6 D2 usd2     b2  1 strip P      900 USD    cash 1000 (change 100)              PB3 500 USD/strip = 500 USD
 *   S7 D1 usd1     b1  2 tablets P    200 USD    card                                PB1 has an IQD cost: other currency
 * Returns (approved by manager1 at b1): R1 D2 12:00Z, 5 base of S1 = 450, reason "Damaged box" (cost back floor(1410*5/20) = 352);
 *   R2 D2 13:00Z, all of S3 = 2000 (by transfer, as it was paid), reason "Wrong medicine".
 * Transfers: T1 b1->b2 12 P sent D1 (on the road); T2 b2->b1 20 P sent D1, received D2 12:00Z as 14 + 2 damaged + 4 lost; T3 b1->b2 5 Q requested D2.
 * Also D2: owner damages 3 of PB2@b2 ("Broken in storage"), adjusts QB1 out by 4 ("Miscount").
 */

let seq = 0;
const key = (label: string) => `${label}-${(seq += 1)}-${'x'.repeat(8)}`;
const REAL_NOW = new Date();

interface Biz {
  a: { id: string; branchIds: string[] };
  b1: string;
  b2: string;
  owner: Person;
  cashier1: Person;
  cashier2: Person;
  manager1: Person;
  usd1: Person;
  usd2: Person;
  accountant: Person;
  pic: Person;
  stockP: Person;
  pharmacist: Person;
  P: { id: string; tablet: string; strip: string };
  Q: { id: string; tablet: string; strip: string };
  C1: string;
  C2: string;
  ids: Record<string, string>;
}

const price = (restaurantId: string, p: Biz['P'], currency: 'IQD' | 'USD', tablet: bigint, strip: bigint) =>
  prisma().phPrice.createMany({
    data: [
      { restaurantId, productId: p.id, unitId: p.tablet, branchId: null, currency, amountMinor: tablet, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' },
      { restaurantId, productId: p.id, unitId: p.strip, branchId: null, currency, amountMinor: strip, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' },
    ],
  });
const shift = (restaurantId: string, branchId: string, who: Person, currency: 'IQD' | 'USD' = 'IQD') =>
  prisma().phShift.create({ data: { restaurantId, branchId, userId: who.userId, currency, openingFloatMinor: 0n } });

/** A batch with a cost in any currency, and its stock put there by real movements. */
async function batch(restaurantId: string, branchId: string, productId: string, over: { lot: string; expiry?: string; available: number; cost?: { minor: bigint; currency: 'IQD' | 'USD'; unitId: string } }) {
  const made = await prisma().phBatch.create({
    data: {
      restaurantId,
      productId,
      lot: over.lot,
      expiryDate: new Date(`${over.expiry ?? '2027-06-30'}T00:00:00.000Z`),
      ...(over.cost ? { unitCostMinor: over.cost.minor, costCurrency: over.cost.currency, costUnitId: over.cost.unitId } : {}),
    },
    select: { id: true },
  });
  await stockInto(restaurantId, branchId, made.id, { available: over.available });
  return made.id;
}

const at = (w: Biz, branchId?: string) => ({ restaurantId: w.a.id, ...(branchId ? { branchId } : {}) });
const cash = (amountMinor: bigint) => ({ method: 'CASH', amountMinor, clientKey: key('pay') });
const card = (amountMinor: bigint) => ({ method: 'CARD_MANUAL', amountMinor, clientKey: key('pay') });
const transfer = (amountMinor: bigint) => ({ method: 'TRANSFER_MANUAL', amountMinor, clientKey: key('pay') });

async function sell(w: Biz, who: Person, branchId: string, currency: 'IQD' | 'USD', lines: unknown[], payments: unknown[], extra: Record<string, unknown> = {}) {
  const made = dataOf(await act(who, saleActions.create, { ...at(w, branchId), clientKey: key('sale'), currency, lines, payments, ...extra }));
  const row = await prisma().phSale.findUniqueOrThrow({ where: { id: made.id }, include: { lines: { include: { allocations: true } } } });
  return { id: made.id as string, number: made.number as string, lineId: row.lines[0]!.id, allocationId: row.lines[0]!.allocations[0]!.id };
}

async function build(label: string, full: boolean): Promise<Biz> {
  const a = await pharmacy(label, { branches: 2 });
  const [b1, b2] = a.branchIds as [string, string];
  const staff = (name: string, role: 'CASHIER' | 'BRANCH_MANAGER' | 'ACCOUNTANT' | 'PHARMACIST_IN_CHARGE' | 'STOCK' | 'PHARMACIST', branches: string[]) =>
    person(`${name}${label}`, { staff: [a.id, role, branches] });
  const w: Biz = {
    a,
    b1,
    b2,
    owner: await person(`owner${label}`, { membership: [a.id, 'OWNER'] }),
    cashier1: await staff('cashier1', 'CASHIER', [b1]),
    cashier2: await staff('cashier2', 'CASHIER', [b2]),
    manager1: await staff('manager1', 'BRANCH_MANAGER', [b1]),
    usd1: await staff('usd1', 'CASHIER', [b1]),
    usd2: await staff('usd2', 'BRANCH_MANAGER', [b2]),
    accountant: await staff('accountant', 'ACCOUNTANT', [b1, b2]),
    pic: await staff('pic', 'PHARMACIST_IN_CHARGE', [b1, b2]),
    stockP: await staff('stockP', 'STOCK', [b1, b2]),
    pharmacist: await staff('pharmacist', 'PHARMACIST', [b1]),
    P: await makeProduct(a.id, `Panadol${label}`),
    Q: await makeProduct(a.id, `Aspirin${label}`),
    C1: '',
    C2: '',
    ids: {},
  };
  await prisma().phSettings.create({ data: { restaurantId: a.id, enabledCurrencies: ['IQD', 'USD'] } });
  w.C1 = (await prisma().phCategory.create({ data: { restaurantId: a.id, name: 'Pain', nameKey: 'pain' }, select: { id: true } })).id;
  w.C2 = (await prisma().phCategory.create({ data: { restaurantId: a.id, name: 'Cold', nameKey: 'cold' }, select: { id: true } })).id;
  await prisma().phProduct.update({ where: { id: w.P.id }, data: { categoryId: w.C1 } });
  await prisma().phProduct.update({ where: { id: w.Q.id }, data: { categoryId: w.C2 } });
  await price(a.id, w.P, 'IQD', 100n, 900n);
  await price(a.id, w.P, 'USD', 100n, 900n);
  await price(a.id, w.Q, 'IQD', 250n, 2000n);
  for (const [who, branch] of [[w.owner, b1], [w.cashier1, b1], [w.manager1, b1], [w.cashier2, b2]] as const) await shift(a.id, branch, who);
  await shift(a.id, b1, w.usd1, 'USD');
  await shift(a.id, b2, w.usd2, 'USD');

  const pb1 = await batch(a.id, b1, w.P.id, { lot: 'PB1', available: 200, cost: { minor: 705n, currency: 'IQD', unitId: w.P.strip } });
  const pb2 = await batch(a.id, b2, w.P.id, { lot: 'PB2', available: 200, cost: { minor: 600n, currency: 'IQD', unitId: w.P.strip } });
  const pb3 = await batch(a.id, b2, w.P.id, { lot: 'PB3', expiry: '2028-06-30', available: 200, cost: { minor: 500n, currency: 'USD', unitId: w.P.strip } });
  const qb1 = await batch(a.id, b1, w.Q.id, { lot: 'QB1', available: 100 });
  const qb2 = await batch(a.id, b2, w.Q.id, { lot: 'QB2', available: 100, cost: { minor: 100n, currency: 'USD', unitId: w.Q.strip } });
  w.ids = { pb1, pb2, pb3, qb1, qb2 };
  await prisma().phProductBranch.createMany({
    data: [
      { restaurantId: a.id, branchId: b1, productId: w.P.id, minQty: 200, reorderQty: 100 },
      { restaurantId: a.id, branchId: b2, productId: w.Q.id, minQty: 100, reorderQty: 50 },
      { restaurantId: a.id, branchId: b2, productId: w.P.id, minQty: 100, reorderQty: 10 },
      { restaurantId: a.id, branchId: b1, productId: w.Q.id, minQty: 50, reorderQty: 10 },
    ],
  });
  if (!full) {
    await sell(w, w.cashier1, b1, 'IQD', [{ productId: w.P.id, unitId: w.P.tablet, qty: 1 }], [cash(100n)]);
    return w;
  }

  const tab = (p: Biz['P'], qty: number) => ({ productId: p.id, unitId: p.tablet, qty });
  const str = (p: Biz['P'], qty: number, extra: Record<string, unknown> = {}) => ({ productId: p.id, unitId: p.strip, qty, ...extra });
  const clock = (iso: string) => vi.setSystemTime(new Date(iso));

  clock('2026-10-27T09:00:00.000Z');
  const s1 = await sell(w, w.cashier1, b1, 'IQD', [str(w.P, 2)], [cash(2000n)]);
  await sell(w, w.cashier1, b1, 'IQD', [{ ...tab(w.P, 3), discount: { kind: 'amount', value: 15n, reason: 'Loyal customer' } }], [card(285n)]);
  await sell(w, w.cashier2, b2, 'IQD', [tab(w.P, 5)], [cash(500n)]);
  await sell(w, w.usd1, b1, 'USD', [tab(w.P, 2)], [card(200n)]);

  clock('2026-10-27T10:00:00.000Z');
  const placeFor = { restaurantId: a.id };
  const t1 = dataOf(await act(w.owner, transferActions.request, { ...placeFor, clientKey: key('req'), fromBranchId: b1, toBranchId: b2, lines: [{ productId: w.P.id, qty: 12 }] }));
  dataOf(await act(w.owner, transferActions.send, { ...placeFor, transferId: t1.id, version: t1.version, clientKey: key('send') }));
  const t2 = dataOf(await act(w.owner, transferActions.request, { ...placeFor, clientKey: key('req'), fromBranchId: b2, toBranchId: b1, lines: [{ productId: w.P.id, qty: 20 }] }));
  const t2sent = dataOf(await act(w.owner, transferActions.send, { ...placeFor, transferId: t2.id, version: t2.version, clientKey: key('send') }));
  w.ids.t1 = t1.id;
  w.ids.t2 = t2.id;

  clock('2026-10-27T21:30:00.000Z');
  const s3 = await sell(w, w.cashier1, b1, 'IQD', [str(w.Q, 1)], [transfer(2000n)]);

  clock('2026-10-28T10:00:00.000Z');
  await sell(w, w.cashier2, b2, 'IQD', [tab(w.Q, 4)], [cash(1000n)]);
  await sell(w, w.usd2, b2, 'USD', [str(w.P, 1, { batchId: pb3, batchReason: 'Test the other currency' })], [cash(1000n)]);
  await sell(w, w.owner, b1, 'IQD', [str(w.P, 1, { discount: { kind: 'percent', value: 10, reason: 'Staff' } })], [cash(810n)]);
  dataOf(await act(w.owner, stockActions.damage, { ...at(w, b2), batchId: pb2, fromBucket: 'available', baseQty: 3, reason: 'Broken in storage' }));
  dataOf(await act(w.owner, stockActions.adjust, { ...at(w, b1), batchId: qb1, direction: 'out', bucketFrom: 'available', baseQty: 4, reason: 'Miscount', clientKey: key('adj') }));
  const t3 = dataOf(await act(w.owner, transferActions.request, { ...placeFor, clientKey: key('req'), fromBranchId: b1, toBranchId: b2, lines: [{ productId: w.Q.id, qty: 5 }] }));
  w.ids.t3 = t3.id;

  clock('2026-10-28T12:00:00.000Z');
  dataOf(await act(w.manager1, returnActions.create, { ...at(w, b1), saleId: s1.id, lines: [{ saleLineId: s1.lineId, baseQty: 5 }], reason: 'Damaged box', refundMethod: 'CASH', clientKey: key('ret') }));
  const t2done = dataOf(await act(w.owner, transferActions.receive, {
    ...placeFor,
    transferId: t2.id,
    version: t2sent.version,
    clientKey: key('recv'),
    lines: [{ lineId: t2sent.lines[0]!.lineId, receivedQty: 14, damagedQty: 2, lostQty: 4, lostReason: 'LOST' }],
  }));
  expect(t2done.status).toBe('PARTIAL');

  clock('2026-10-28T13:00:00.000Z');
  dataOf(await act(w.manager1, returnActions.create, { ...at(w, b1), saleId: s3.id, lines: [{ saleLineId: s3.lineId, baseQty: 10 }], reason: 'Wrong medicine', refundMethod: 'TRANSFER_MANUAL', clientKey: key('ret') }));
  vi.setSystemTime(NOW);
  return w;
}

let w: Biz;
let other: Biz;
let x: Biz;
beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  w = await build('A', true);
  other = await build('B', false);
  x = await build('X', false);
}, 240_000);
afterAll(() => {
  vi.useRealTimers();
});

const PERIOD = { from: '2026-10-27', to: '2026-10-28' };
const sales = (who: Person, over: Record<string, unknown> = {}, biz: Biz = w) => ask(who, reports.sales, { ...at(biz), ...PERIOD, ...over });
const salesOf = async (over: Record<string, unknown> = {}, who: Person = w.owner) => dataOf(await sales(who, over));
const keyed = (rows: Array<{ key: string }>, names: Record<string, string>) => rows.map((r) => ({ ...r, key: names[r.key] ?? r.key }));

describe('sales report: hand figures', () => {
  it('totals per currency, never mixed: gross, discount, rounding, sales, refunds on the day they were made, net, average ticket', async () => {
    const r = await salesOf();
    expect(r.totals).toEqual([
      { currency: 'IQD', count: 6, grossMinor: '6500', discountMinor: '105', roundingMinor: '0', salesMinor: '6395', refundsMinor: '2450', refundCount: 2, netMinor: '3945', avgTicketMinor: '1065' },
      { currency: 'USD', count: 2, grossMinor: '1100', discountMinor: '0', roundingMinor: '0', salesMinor: '1100', refundsMinor: '0', refundCount: 0, netMinor: '1100', avgTicketMinor: '550' },
    ]);
    expect(r.note).toBe('returns-on-their-own-date');
  });

  it('by day (Baghdad): the sale at 21:30 UTC on the 27th is on the 28th, and the refunds of the 28th lower the 28th', async () => {
    const r = await salesOf({ groupBy: 'day' });
    expect(r.rows.map((x: { key: string; currency: string; count: number; grossMinor: string; discountMinor: string; salesMinor: string; refundsMinor: string; netMinor: string; avgTicketMinor: string }) => [x.currency, x.key, x.count, x.grossMinor, x.discountMinor, x.salesMinor, x.refundsMinor, x.netMinor, x.avgTicketMinor])).toEqual([
      ['IQD', '2026-10-27', 3, '2600', '15', '2585', '0', '2585', '861'],
      ['IQD', '2026-10-28', 3, '3900', '90', '3810', '2450', '1360', '1270'],
      ['USD', '2026-10-27', 1, '200', '0', '200', '0', '200', '200'],
      ['USD', '2026-10-28', 1, '900', '0', '900', '0', '900', '900'],
    ]);
    // One day at a time: D1 holds S1, S2, S4 and not S3.
    const d1 = await salesOf({ from: '2026-10-27', to: '2026-10-27' });
    expect(d1.totals[0]).toMatchObject({ currency: 'IQD', count: 3, salesMinor: '2585', refundsMinor: '0', netMinor: '2585' });
    const d2 = await salesOf({ from: '2026-10-28', to: '2026-10-28' });
    expect(d2.totals[0]).toMatchObject({ currency: 'IQD', count: 3, salesMinor: '3810', refundsMinor: '2450', refundCount: 2, netMinor: '1360' });
  });

  it('by branch, by user (refunds go to the seller of the sale), by method, by product and by category', async () => {
    const names = { [w.b1]: 'b1', [w.b2]: 'b2', [w.cashier1.userId]: 'cashier1', [w.cashier2.userId]: 'cashier2', [w.owner.userId]: 'owner', [w.usd1.userId]: 'usd1', [w.usd2.userId]: 'usd2', [w.P.id]: 'P', [w.Q.id]: 'Q', [w.C1]: 'C1', [w.C2]: 'C2' };
    const brief = (rows: Array<Record<string, string | number | undefined>>) => keyed(rows as Array<{ key: string }>, names).map((r) => { const o = r as Record<string, unknown>; return [o.currency, o.key, o.count, o.grossMinor, o.discountMinor, o.salesMinor, o.refundsMinor, o.netMinor]; });
    expect(brief((await salesOf({ groupBy: 'branch' })).rows)).toEqual([
      ['IQD', 'b1', 4, '5000', '105', '4895', '2450', '2445'],
      ['IQD', 'b2', 2, '1500', '0', '1500', '0', '1500'],
      ['USD', 'b2', 1, '900', '0', '900', '0', '900'],
      ['USD', 'b1', 1, '200', '0', '200', '0', '200'],
    ]);
    expect(brief((await salesOf({ groupBy: 'user' })).rows)).toEqual([
      ['IQD', 'cashier1', 3, '4100', '15', '4085', '2450', '1635'],
      ['IQD', 'cashier2', 2, '1500', '0', '1500', '0', '1500'],
      ['IQD', 'owner', 1, '900', '90', '810', '0', '810'],
      ['USD', 'usd2', 1, '900', '0', '900', '0', '900'],
      ['USD', 'usd1', 1, '200', '0', '200', '0', '200'],
    ]);
    // Method: cash is net of the change (S1 paid 2000 for 1800; S6 paid 1000 for 900).
    expect((await salesOf({ groupBy: 'method' })).rows.map((r: { currency: string; key: string; count: number; netMinor: string }) => [r.currency, r.key, r.count, r.netMinor])).toEqual([
      ['IQD', 'CASH', 4, '4110'],
      ['IQD', 'TRANSFER_MANUAL', 1, '2000'],
      ['IQD', 'CARD_MANUAL', 1, '285'],
      ['USD', 'CASH', 1, '900'],
      ['USD', 'CARD_MANUAL', 1, '200'],
    ]);
    const product = await salesOf({ groupBy: 'product' });
    expect(brief(product.rows)).toEqual([
      ['IQD', 'P', 4, '3500', '105', '3395', '450', '2945'],
      ['IQD', 'Q', 2, '3000', '0', '3000', '2000', '1000'],
      ['USD', 'P', 2, '1100', '0', '1100', '0', '1100'],
    ]);
    expect(product.rows.map((r: { qty: number }) => r.qty)).toEqual([38, 14, 12]);
    expect(product.rows[0]).not.toHaveProperty('roundingMinor');
    expect(brief((await salesOf({ groupBy: 'category' })).rows)).toEqual([
      ['IQD', 'C1', 4, '3500', '105', '3395', '450', '2945'],
      ['IQD', 'C2', 2, '3000', '0', '3000', '2000', '1000'],
      ['USD', 'C1', 2, '1100', '0', '1100', '0', '1100'],
    ]);
  });

  it('payments by method of the sales in the range, per currency', async () => {
    const r = await salesOf();
    expect(r.payments).toEqual([
      { currency: 'IQD', method: 'CARD_MANUAL', amountMinor: '285', count: 1 },
      { currency: 'IQD', method: 'CASH', amountMinor: '4110', count: 4 },
      { currency: 'IQD', method: 'TRANSFER_MANUAL', amountMinor: '2000', count: 1 },
      { currency: 'USD', method: 'CARD_MANUAL', amountMinor: '200', count: 1 },
      { currency: 'USD', method: 'CASH', amountMinor: '900', count: 1 },
    ]);
  });

  it('keyset pages cover every row once, in the same order as one big page', async () => {
    for (const groupBy of ['day', 'user', 'product'] as const) {
      const whole = await salesOf({ groupBy });
      const seen: unknown[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 10; guard += 1) {
        const page: Awaited<ReturnType<typeof salesOf>> = await salesOf({ groupBy, take: 2, cursor });
        seen.push(...page.rows);
        if (!page.hasMore) break;
        cursor = page.nextCursor;
      }
      expect(seen).toEqual(whole.rows);
    }
  });

  it('filters by currency', async () => {
    const r = await salesOf({ groupBy: 'day', currency: 'USD' });
    expect(r.totals.map((t: { currency: string }) => t.currency)).toEqual(['USD']);
    expect(r.rows).toHaveLength(2);
  });
});

describe('ranges and Baghdad days', () => {
  it('refuses from after to, a bad date, and more than 366 days; allows 366', async () => {
    const reversed = await sales(w.owner, { from: '2026-10-28', to: '2026-10-27' });
    expect(codeOf(reversed)).toBe('INVALID');
    expect(!reversed.ok && reversed.error.fields).toMatchObject({ from: expect.any(String) });
    const long = await sales(w.owner, { from: '2027-01-01', to: '2028-01-02' });
    expect(codeOf(long)).toBe('INVALID');
    expect(!long.ok && long.error.fields).toMatchObject({ to: 'Use a range of at most one year' });
    expect(codeOf(await sales(w.owner, { from: '2026-02-30', to: '2026-03-01' }))).toBe('INVALID');
    expect(codeOf(await sales(w.owner, { from: '2028-01-01', to: '2028-12-31' }))).toBe('OK');
  });
});

describe('returns report', () => {
  it('lists the returns newest first with sale number, reason, approver and method, and totals per currency, branch, reason and method', async () => {
    const r = dataOf(await ask(w.owner, reports.returns, { ...at(w), ...PERIOD }));
    expect(r.rows.map((x: { reason: string; refundMinor: string; method: string; currency: string; approvedById: string; approverName: string; branchId: string }) => [x.reason, x.refundMinor, x.method, x.currency, x.approvedById, x.approverName, x.branchId])).toEqual([
      ['Wrong medicine', '2000', 'TRANSFER_MANUAL', 'IQD', w.manager1.userId, 'manager1A person', w.b1],
      ['Damaged box', '450', 'CASH', 'IQD', w.manager1.userId, 'manager1A person', w.b1],
    ]);
    const numbers = await prisma().phSale.findMany({ where: { restaurantId: w.a.id, id: { in: r.rows.map((x: { saleId: string }) => x.saleId) } }, select: { id: true, number: true } });
    for (const row of r.rows) expect(row.saleNumber).toBe(numbers.find((n) => n.id === row.saleId)!.number);
    expect(r.totals).toEqual([{ currency: 'IQD', count: 2, refundMinor: '2450' }]);
    expect(r.byBranch).toEqual([{ branchId: w.b1, currency: 'IQD', count: 2, refundMinor: '2450' }]);
    expect(r.byReason).toEqual([{ reason: 'Damaged box', count: 1 }, { reason: 'Wrong medicine', count: 1 }]);
    expect(r.byMethod).toEqual([
      { currency: 'IQD', method: 'CASH', count: 1, refundMinor: '450' },
      { currency: 'IQD', method: 'TRANSFER_MANUAL', count: 1, refundMinor: '2000' },
    ]);
  });

  it('pages by keyset and filters by the seller of the sale', async () => {
    const first = dataOf(await ask(w.owner, reports.returns, { ...at(w), ...PERIOD, take: 1 }));
    expect(first.rows).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const second = dataOf(await ask(w.owner, reports.returns, { ...at(w), ...PERIOD, take: 1, cursor: first.nextCursor }));
    expect(second.rows.map((x: { reason: string }) => x.reason)).toEqual(['Damaged box']);
    expect(second.hasMore).toBe(false);
    const none = dataOf(await ask(w.owner, reports.returns, { ...at(w), ...PERIOD, userId: w.cashier2.userId }));
    expect(none.rows).toEqual([]);
    expect(none.totals).toEqual([]);
    expect(codeOf(await ask(w.owner, reports.returns, { ...at(w), ...PERIOD, cursor: Buffer.from('x').toString('base64url') }))).toBe('INVALID');
  });

  it('a return on the next Baghdad day is not in the day before', async () => {
    const d1 = dataOf(await ask(w.owner, reports.returns, { ...at(w), from: '2026-10-27', to: '2026-10-27' }));
    expect(d1.rows).toEqual([]);
  });
});

describe('discounts report', () => {
  it('gives the sales with a discount, who rang them, the percent of gross and whether it is over the limit (5%)', async () => {
    const r = dataOf(await ask(w.owner, reports.discounts, { ...at(w), ...PERIOD }));
    expect(r.maxDiscountPercent).toBe(5);
    expect(r.rows.map((x: { branchId: string; soldById: string; grossMinor: string; discountMinor: string; discountBp: number; overLimit: boolean }) => [x.branchId, x.soldById, x.grossMinor, x.discountMinor, x.discountBp, x.overLimit])).toEqual([
      [w.b1, w.owner.userId, '900', '90', 1000, true],
      [w.b1, w.cashier1.userId, '300', '15', 500, false],
    ]);
    expect(r.totals).toEqual([
      { currency: 'IQD', salesCount: 6, discountedCount: 2, grossMinor: '6500', discountMinor: '105', discountBp: 162 },
      { currency: 'USD', salesCount: 2, discountedCount: 0, grossMinor: '1100', discountMinor: '0', discountBp: 0 },
    ]);
    expect(r.byBranch).toEqual([
      { branchId: w.b1, currency: 'IQD', salesCount: 4, discountedCount: 2, grossMinor: '5000', discountMinor: '105', discountBp: 210 },
      { branchId: w.b2, currency: 'IQD', salesCount: 2, discountedCount: 0, grossMinor: '1500', discountMinor: '0', discountBp: 0 },
      { branchId: w.b1, currency: 'USD', salesCount: 1, discountedCount: 0, grossMinor: '200', discountMinor: '0', discountBp: 0 },
      { branchId: w.b2, currency: 'USD', salesCount: 1, discountedCount: 0, grossMinor: '900', discountMinor: '0', discountBp: 0 },
    ]);
    expect(r.topUsers.map((u: { userId: string; userName: string; discountMinor: string; discountedCount: number; discountBp: number }) => [u.userId, u.userName, u.discountMinor, u.discountedCount, u.discountBp])).toEqual([
      [w.owner.userId, 'ownerA person', '90', 1, 1000],
      [w.cashier1.userId, 'cashier1A person', '15', 1, 500],
    ]);
  });

  it('filters by seller and pages', async () => {
    const mine = dataOf(await ask(w.owner, reports.discounts, { ...at(w), ...PERIOD, userId: w.owner.userId }));
    expect(mine.rows).toHaveLength(1);
    expect(mine.totals[0]).toMatchObject({ currency: 'IQD', salesCount: 1, discountMinor: '90' });
    const one = dataOf(await ask(w.owner, reports.discounts, { ...at(w), ...PERIOD, take: 1 }));
    const two = dataOf(await ask(w.owner, reports.discounts, { ...at(w), ...PERIOD, take: 1, cursor: one.nextCursor }));
    expect([one.rows[0].discountMinor, two.rows[0].discountMinor, two.hasMore]).toEqual(['90', '15', false]);
  });
});

describe('margin report (estimated)', () => {
  it('is net sales (less the refunds of the same lines) minus the cost of what was sold (less the cost of what came back), per currency', async () => {
    const r = dataOf(await ask(w.owner, reports.margin, { ...at(w), ...PERIOD }));
    expect(r.estimated).toBe(true);
    // IQD, lines with a complete cost: S1 1800/1410, S2 285/211, S4 500/300, S8 810/705; R1 takes back 450 and floor(1410*5/20) = 352.
    // net 3395 - 450 = 2945, cost 2626 - 352 = 2274, margin 671 = 22.78 %.
    // USD: S6 900 / 500 = 400 = 44.44 %.
    expect(r.totals).toEqual([
      { currency: 'IQD', netMinor: '2945', costMinor: '2274', marginMinor: '671', marginBp: 2278 },
      { currency: 'USD', netMinor: '900', costMinor: '500', marginMinor: '400', marginBp: 4444 },
    ]);
    expect(r.byBranch).toEqual([
      { branchId: w.b1, currency: 'IQD', netMinor: '2445', costMinor: '1974', marginMinor: '471', marginBp: 1926 },
      { branchId: w.b2, currency: 'IQD', netMinor: '500', costMinor: '300', marginMinor: '200', marginBp: 4000 },
      { branchId: w.b2, currency: 'USD', netMinor: '900', costMinor: '500', marginMinor: '400', marginBp: 4444 },
    ]);
  });

  it('counts what it leaves out instead of treating it as free: no cost on record, cost in another currency', async () => {
    const r = dataOf(await ask(w.owner, reports.margin, { ...at(w), ...PERIOD }));
    // S3 (Q at b1, no cost) is incomplete. S5 (IQD sale of a USD-cost batch) and S7 (USD sale of an IQD-cost batch) are mixed.
    expect(r.incompleteCostRows).toBe(1);
    expect(r.mixedCurrencyRows).toBe(2);
    // IQD left out: S3 2000 + S5 1000 - R2's refund 2000 = 1000. USD: S7 200.
    expect(r.excluded).toEqual([{ currency: 'IQD', netMinor: '1000' }, { currency: 'USD', netMinor: '200' }]);
  });

  it('by day, product and category', async () => {
    const day = dataOf(await ask(w.owner, reports.margin, { ...at(w), ...PERIOD, groupBy: 'day', currency: 'IQD' }));
    expect(day.rows.map((x: { key: string; netMinor: string; costMinor: string; marginMinor: string; marginBp: number }) => [x.key, x.netMinor, x.costMinor, x.marginMinor, x.marginBp])).toEqual([
      ['2026-10-27', '2585', '1921', '664', 2569],
      ['2026-10-28', '360', '353', '7', 194],
    ]);
    const product = dataOf(await ask(w.owner, reports.margin, { ...at(w), ...PERIOD, groupBy: 'product', currency: 'IQD' }));
    expect(product.rows.map((x: { key: string; netMinor: string }) => [x.key, x.netMinor])).toEqual([[w.P.id, '2945']]);
    const category = dataOf(await ask(w.owner, reports.margin, { ...at(w), ...PERIOD, groupBy: 'category', currency: 'IQD' }));
    expect(category.rows.map((x: { key: string; costMinor: string }) => [x.key, x.costMinor])).toEqual([[w.C1, '2274']]);
  });

  it('needs profit.view and cost.view: the pharmacist in charge (cost, no profit) and the stock role are refused; the accountant and a manager are not', async () => {
    expect(codeOf(await ask(w.pic, reports.margin, { ...at(w), ...PERIOD }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(w.stockP, reports.margin, { ...at(w), ...PERIOD }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(w.accountant, reports.margin, { ...at(w), ...PERIOD }))).toBe('OK');
    expect(codeOf(await ask(w.manager1, reports.margin, { ...at(w), ...PERIOD }))).toBe('OK');
  });

  it('refuses when the actor sees cost but not profit, or profit but not cost (direct service call)', async () => {
    const owner = (await asPh(w.owner.userId, w.a.id))!;
    const scoped = scopedClient(prisma(), { restaurantId: w.a.id, allBranches: true });
    const input = { ...PERIOD, groupBy: 'day' as const, take: 100 };
    await expect(marginReport(scoped, { ...owner, role: 'STOCK' }, {}, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(marginReport(scoped, { ...owner, role: 'PHARMACIST' }, {}, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(marginReport(scoped, { ...owner, role: null }, {}, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('stock valuation', () => {
  /* Balances (hand): PB1@b1 153 avail + 5 quarantine (cost 705/strip IQD); PB2@b2 172 avail + 3 damaged (600/strip); PB2@b1 14 avail + 2 damaged;
     PB3@b2 190 (500/strip USD); QB1@b1 86 avail + 10 quarantine (no cost); QB2@b2 96 (100/strip USD).
     Valued = available + reserved + quarantine. IQD: 705*158/10 = 11139, 600*172/10 = 10320, 600*14/10 = 840 -> 22299; damaged 600*3/10 + 600*2/10 = 300.
     USD: 500*190/10 = 9500, 100*96/10 = 960 -> 10460. QB1 has no cost: noCostRows 1. */
  it('totals, by branch, with values per currency, damaged stock apart and the no-cost batch counted', async () => {
    const r = dataOf(await ask(w.owner, reports.stockValuationQuery, { ...at(w), groupBy: 'branch' }));
    expect(r.valued).toEqual(['available', 'reserved', 'quarantine']);
    expect(r.totals).toEqual({
      available: 711,
      reserved: 0,
      quarantine: 15,
      damaged: 5,
      noCostRows: 1,
      valuationComplete: false,
      values: [
        { currency: 'IQD', valueMinor: '22299', damagedValueMinor: '300' },
        { currency: 'USD', valueMinor: '10460', damagedValueMinor: '0' },
      ],
    });
    expect(r.byBranch).toEqual([
      { branchId: w.b1, available: 253, reserved: 0, quarantine: 15, damaged: 2, noCostRows: 1, values: [{ currency: 'IQD', valueMinor: '11979', damagedValueMinor: '120' }] },
      { branchId: w.b2, available: 458, reserved: 0, quarantine: 0, damaged: 3, noCostRows: 0, values: [{ currency: 'IQD', valueMinor: '10320', damagedValueMinor: '180' }, { currency: 'USD', valueMinor: '10460', damagedValueMinor: '0' }] },
    ]);
    expect(r.rows.map((x: { key: string; label: string; available: number; valuationComplete: boolean }) => [x.key, x.label, x.available, x.valuationComplete])).toEqual([
      [w.b1, 'A branch 1', 253, false],
      [w.b2, 'A branch 2', 458, true],
    ]);
  });

  it('by product and by category, and narrowed to one category', async () => {
    const product = dataOf(await ask(w.owner, reports.stockValuationQuery, { ...at(w), groupBy: 'product' }));
    const names = { [w.P.id]: 'P', [w.Q.id]: 'Q' };
    const brief = product.rows.map((x: { key: string; available: number; quarantine: number; damaged: number; noCostRows: number }) => [names[x.key as keyof typeof names], x.available, x.quarantine, x.damaged, x.noCostRows]);
    expect(brief).toHaveLength(2);
    expect(brief).toContainEqual(['P', 529, 5, 5, 0]);
    expect(brief).toContainEqual(['Q', 182, 10, 0, 1]);
    const category = dataOf(await ask(w.owner, reports.stockValuationQuery, { ...at(w), groupBy: 'category' }));
    expect(category.rows.map((x: { key: string; label: string }) => x.label).sort()).toEqual(['Cold', 'Pain']);
    const cold = dataOf(await ask(w.owner, reports.stockValuationQuery, { ...at(w), groupBy: 'branch', categoryId: w.C2 }));
    expect(cold.totals).toMatchObject({ available: 182, quarantine: 10, damaged: 0, noCostRows: 1, values: [{ currency: 'USD', valueMinor: '960', damagedValueMinor: '0' }] });
  });

  it('shows what is on the road apart from on-hand: 12 units to branch 2, worth 705*12/10 = 846 at cost', async () => {
    const r = dataOf(await ask(w.owner, reports.stockValuationQuery, { ...at(w) }));
    expect(r.inTransit).toEqual({ units: 12, transfers: 1, byDestination: [{ branchId: w.b2, units: 12 }], values: [{ currency: 'IQD', valueMinor: '846' }] });
  });

  it('agrees with an independent computation from the balances and batches (one cost rule, floored per row)', async () => {
    const balances = await prisma().phStockBalance.findMany({ where: { restaurantId: w.a.id }, include: { batch: { include: { costUnit: true } } } });
    const expected = new Map<string, bigint>();
    let noCost = 0;
    for (const b of balances) {
      const units = b.available + b.reserved + b.quarantine;
      if (units + b.damaged === 0) continue;
      if (b.batch.unitCostMinor === null || b.batch.costCurrency === null || b.batch.costUnit === null) {
        if (units > 0) noCost += 1;
        continue;
      }
      const k = `${b.branchId}|${b.batch.costCurrency}`;
      expected.set(k, (expected.get(k) ?? 0n) + costOfBaseQty(b.batch.unitCostMinor, units, b.batch.costUnit.baseQty));
    }
    const r = dataOf(await ask(w.owner, reports.stockValuationQuery, { ...at(w) }));
    const got = new Map<string, bigint>();
    for (const row of r.byBranch) for (const v of row.values) got.set(`${row.branchId}|${v.currency}`, BigInt(v.valueMinor));
    expect(got).toEqual(expected);
    expect(r.totals.noCostRows).toBe(noCost);
  });

  it('without cost.view only quantities are returned (direct service call as a role without it)', async () => {
    const owner = (await asPh(w.owner.userId, w.a.id))!;
    const scoped = scopedClient(prisma(), { restaurantId: w.a.id, allBranches: true });
    const r = await stockValuation(scoped, { ...owner, role: 'PHARMACIST' }, {}, { groupBy: 'branch', take: 100 });
    expect(r.totals).toEqual({ available: 711, reserved: 0, quarantine: 15, damaged: 5 });
    expect(r.byBranch[0]).not.toHaveProperty('values');
    expect(r.rows[0]).not.toHaveProperty('noCostRows');
    expect(r.rows[0]).not.toHaveProperty('values');
    expect(r.inTransit).not.toHaveProperty('values');
  });
});

describe('damaged, quarantined and lost stock', () => {
  const wideWindow = () => {
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const real = day(new Date(REAL_NOW.getTime() + 3 * 3_600_000));
    return { from: real < '2026-10-27' ? real : '2026-10-27', to: real > '2026-10-28' ? real : '2026-10-28' };
  };

  it('current damaged and quarantine stock; ledger write-offs by type with value; transfer losses by route', async () => {
    const win = wideWindow();
    const days = (new Date(`${win.to}T00:00:00Z`).getTime() - new Date(`${win.from}T00:00:00Z`).getTime()) / 86_400_000 + 1;
    expect(days).toBeLessThanOrEqual(366);
    const r = dataOf(await ask(w.owner, reports.damaged, { ...at(w), ...win }));
    expect(r.current.totals).toEqual({ damaged: 5, quarantine: 15, noCostRows: 1, values: [{ currency: 'IQD', damagedValueMinor: '300', quarantineValueMinor: '352' }] });
    expect(r.current.byBranch).toEqual([{ branchId: w.b1, damaged: 2, quarantine: 15 }, { branchId: w.b2, damaged: 3, quarantine: 0 }]);
    expect(r.movements.totals).toEqual([
      { type: 'DAMAGE', units: 3, values: [{ currency: 'IQD', valueMinor: '180' }] },
      { type: 'ADJUST', units: 4, values: [] },
      { type: 'SUPPLIER_RETURN', units: 0, values: [] },
    ]);
    expect(r.movements.byBranch).toEqual([{ branchId: w.b1, type: 'ADJUST', units: 4 }, { branchId: w.b2, type: 'DAMAGE', units: 3 }]);
    expect(r.movements.reasons).toEqual([{ type: 'ADJUST', reason: 'Miscount', units: 4 }, { type: 'DAMAGE', reason: 'Broken in storage', units: 3 }]);
    // T2 arrived as 14 + 2 damaged + 4 lost (PB2 at 600/strip: 240 and 120).
    expect(r.transfers).toEqual({
      totals: { lostQty: 4, damagedQty: 2, values: [{ currency: 'IQD', lostValueMinor: '240', damagedValueMinor: '120' }] },
      byRoute: [{ fromBranchId: w.b2, toBranchId: w.b1, lostQty: 4, damagedQty: 2 }],
      byReason: [{ reason: 'LOST', lostQty: 4 }],
    });
  });

  it('a range before everything shows no write-offs and no losses (the current stock is still shown)', async () => {
    const r = dataOf(await ask(w.owner, reports.damaged, { ...at(w), from: '2026-01-01', to: '2026-01-02' }));
    expect(r.movements.totals.map((t: { units: number }) => t.units)).toEqual([0, 0, 0]);
    expect(r.transfers.totals).toMatchObject({ lostQty: 0, damagedQty: 0 });
    expect(r.current.totals.damaged).toBe(5);
  });
});

describe('transfers report', () => {
  it('counts by status, sending branch (adds up to the total) and route; what is on the road; losses; time in transit; rows', async () => {
    const r = dataOf(await ask(w.owner, reports.transfers, { ...at(w), ...PERIOD }));
    expect(r.total).toBe(3);
    expect(r.byStatus).toEqual([{ status: 'PARTIAL', count: 1 }, { status: 'REQUESTED', count: 1 }, { status: 'SENT', count: 1 }]);
    expect(r.byBranch).toEqual([{ branchId: w.b1, count: 2 }, { branchId: w.b2, count: 1 }]);
    expect(r.byBranch.reduce((s: number, b: { count: number }) => s + b.count, 0)).toBe(r.total);
    expect(r.byRoute).toEqual([
      { fromBranchId: w.b1, toBranchId: w.b2, status: 'REQUESTED', count: 1 },
      { fromBranchId: w.b1, toBranchId: w.b2, status: 'SENT', count: 1 },
      { fromBranchId: w.b2, toBranchId: w.b1, status: 'PARTIAL', count: 1 },
    ]);
    expect(r.inTransit).toEqual({ units: 12, transfers: 1, byRoute: [{ fromBranchId: w.b1, toBranchId: w.b2, units: 12 }] });
    expect(r.lost).toEqual({ lostQty: 4, damagedQty: 2, byReason: [{ reason: 'LOST', lostQty: 4 }] });
    // T2 was sent 2026-10-27 10:00Z and received 2026-10-28 12:00Z: 26 hours.
    expect(r.avgTransitSeconds).toBe(93_600);
    expect(r.rows.map((x: { id: string }) => x.id)[0]).toBe(w.ids.t3);
    const byId = new Map(r.rows.map((x: { id: string }) => [x.id, x]));
    expect(byId.get(w.ids.t1)).toMatchObject({ status: 'SENT', requestedQty: 12, sentQty: 12, receivedQty: 0, lostQty: 0, damagedQty: 0, fromBranchName: 'A branch 1', toBranchName: 'A branch 2' });
    expect(byId.get(w.ids.t2)).toMatchObject({ status: 'PARTIAL', requestedQty: 20, sentQty: 20, receivedQty: 14, lostQty: 4, damagedQty: 2 });
    expect(byId.get(w.ids.t3)).toMatchObject({ status: 'REQUESTED', requestedQty: 5, sentQty: 0 });
  });

  it('filters by status and pages', async () => {
    const sent = dataOf(await ask(w.owner, reports.transfers, { ...at(w), ...PERIOD, status: 'SENT' }));
    expect(sent.total).toBe(1);
    expect(sent.rows.map((x: { id: string }) => x.id)).toEqual([w.ids.t1]);
    const one = dataOf(await ask(w.owner, reports.transfers, { ...at(w), ...PERIOD, take: 2 }));
    const two = dataOf(await ask(w.owner, reports.transfers, { ...at(w), ...PERIOD, take: 2, cursor: one.nextCursor }));
    expect([...one.rows, ...two.rows].map((x: { id: string }) => x.id).sort()).toEqual([w.ids.t1, w.ids.t2, w.ids.t3].sort());
    expect([one.hasMore, two.hasMore]).toEqual([true, false]);
  });
});

describe('low stock', () => {
  it('lists products whose sellable stock in a branch is below its minimum, with the deficit and the reorder quantity', async () => {
    const r = dataOf(await ask(w.owner, reports.lowStock, { ...at(w) }));
    // P at b1: min 200, sellable 153 (PB1) + 14 (PB2 received) = 167 -> 33 short. Q at b2: min 100, sellable 96 -> 4 short.
    // P at b2 (362 >= 100) and Q at b1 (86 >= 50) are fine.
    expect(r.rows.map((x: { tradeName: string; branchId: string; minQty: number; sellable: number; deficit: number; reorderQty: number }) => [x.tradeName, x.branchId, x.minQty, x.sellable, x.deficit, x.reorderQty])).toEqual([
      ['AspirinA', w.b2, 100, 96, 4, 50],
      ['PanadolA', w.b1, 200, 167, 33, 100],
    ]);
    expect(r.total).toBe(2);
    expect(r.byBranch).toEqual([{ branchId: w.b1, count: 1 }, { branchId: w.b2, count: 1 }]);
    const one = dataOf(await ask(w.owner, reports.lowStock, { ...at(w), take: 1 }));
    const two = dataOf(await ask(w.owner, reports.lowStock, { ...at(w), take: 1, cursor: one.nextCursor }));
    expect([one.rows[0].tradeName, two.rows[0].tradeName, two.hasMore]).toEqual(['AspirinA', 'PanadolA', false]);
  });

  it('does not count an expired or recalled batch as sellable', async () => {
    const stockless = await prisma().phStockBalance.findFirstOrThrow({ where: { restaurantId: w.a.id, batchId: w.ids.pb1! } });
    expect(stockless.available).toBe(153);
    await prisma().phBatch.update({ where: { id: w.ids.pb1! }, data: { status: 'RECALLED' } });
    try {
      const r = dataOf(await ask(w.owner, reports.lowStock, { ...at(w) }));
      expect(r.rows.find((x: { tradeName: string }) => x.tradeName === 'PanadolA')).toMatchObject({ sellable: 14, deficit: 186 });
    } finally {
      await prisma().phBatch.update({ where: { id: w.ids.pb1! }, data: { status: 'ACTIVE' } });
    }
  });
});

describe('expiry report', () => {
  it('buckets expired, up to 30, 31-60 and 61-90 days per branch with units and value at cost, and agrees with the phase 2 list counts', async () => {
    const z = x;
    const e1 = await batch(z.a.id, z.b1, z.P.id, { lot: 'E1', expiry: '2026-10-01', available: 10, cost: { minor: 200n, currency: 'IQD', unitId: z.P.strip } });
    const e2 = await batch(z.a.id, z.b2, z.P.id, { lot: 'E2', expiry: '2026-11-10', available: 20, cost: { minor: 300n, currency: 'IQD', unitId: z.P.strip } });
    const e3 = await batch(z.a.id, z.b1, z.Q.id, { lot: 'E3', expiry: '2026-12-11', available: 8 });
    const e4 = await batch(z.a.id, z.b2, z.Q.id, { lot: 'E4', expiry: '2027-01-10', available: 5, cost: { minor: 400n, currency: 'IQD', unitId: z.Q.strip } });
    await batch(z.a.id, z.b1, z.Q.id, { lot: 'E5', expiry: '2027-06-30', available: 50, cost: { minor: 400n, currency: 'IQD', unitId: z.Q.strip } });
    void [e1, e2, e3, e4];
    const r = dataOf(await ask(z.owner, reports.expiry, { ...at(z) }));
    expect(r.totals.map((t: { band: string; rows: number; units: number; noCostRows: number; values: unknown[] }) => [t.band, t.rows, t.units, t.noCostRows, t.values])).toEqual([
      ['expired', 1, 10, 0, [{ currency: 'IQD', valueMinor: '200' }]],
      ['d30', 1, 20, 0, [{ currency: 'IQD', valueMinor: '600' }]],
      ['d60', 1, 8, 1, []],
      ['d90', 1, 5, 0, [{ currency: 'IQD', valueMinor: '200' }]],
    ]);
    expect(r.byBranch.map((b: { branchId: string; bands: Array<{ band: string; units: number }> }) => [b.branchId, b.bands.map((x) => x.units)])).toEqual([
      [z.b1, [10, 0, 8, 0]],
      [z.b2, [0, 20, 0, 5]],
    ]);
    expect(r.listTotals).toEqual({ expired: 1, d30: 1, d60: 1, d90: 1, d180: 0 });
    expect(r.items.map((i: { batch: { lot: string } }) => i.batch.lot)).toEqual(['E1', 'E2', 'E3', 'E4']);
  });
});

describe('who may read, and which branches', () => {
  const ALL = [
    ['sales', { ...PERIOD }],
    ['returns', { ...PERIOD }],
    ['discounts', { ...PERIOD }],
    ['stockValuationQuery', {}],
    ['expiry', {}],
    ['damaged', { ...PERIOD }],
    ['transfers', { ...PERIOD }],
    ['lowStock', {}],
  ] as const;
  const def = (name: string) => (reports as unknown as Record<string, Parameters<typeof ask>[1]>)[name]!;

  it('a cashier, the stock role and a pharmacist read no report; the accountant and the pharmacist in charge read all but the margin', async () => {
    for (const [name, input] of ALL) {
      for (const who of [w.cashier1, w.stockP, w.pharmacist]) expect(codeOf(await ask(who, def(name), { ...at(w), ...input })), `${name} as ${who.email}`).toBe('FORBIDDEN');
      for (const who of [w.accountant, w.pic, w.manager1, w.owner]) expect(codeOf(await ask(who, def(name), { ...at(w), ...input })), `${name} as ${who.email}`).toBe('OK');
    }
    expect(codeOf(await ask(w.cashier1, reports.margin, { ...at(w), ...PERIOD }))).toBe('FORBIDDEN');
  });

  it('a support actor with a grant reads none', async () => {
    const admin = await person('supportA', { superAdmin: true });
    await grant(admin, w.a.id, { scopes: ['catalog.read', 'stock.read', 'sales.read'] });
    for (const [name, input] of ALL) expect(codeOf(await ask(admin, def(name), { ...at(w), ...input })), name).not.toBe('OK');
    expect(codeOf(await ask(admin, reports.margin, { ...at(w), ...PERIOD }))).not.toBe('OK');
  });

  it("a branch-limited manager's report is the report of that branch only, and another branch is refused", async () => {
    for (const [name, input] of [...ALL, ['margin', { ...PERIOD }] as const]) {
      const mine = dataOf(await ask(w.manager1, def(name), { ...at(w), ...input }));
      const narrowed = dataOf(await ask(w.owner, def(name), { ...at(w, w.b1), ...input }));
      expect(mine, name).toEqual(narrowed);
      const refused = await ask(w.manager1, def(name), { ...at(w, w.b2), ...input });
      expect(refused.ok, `${name} for another branch`).toBe(false);
    }
    // And it is smaller than the whole: the manager's sales total is branch 1's.
    const mine = dataOf(await ask(w.manager1, reports.sales, { ...at(w), ...PERIOD }));
    expect(mine.totals[0]).toMatchObject({ currency: 'IQD', count: 4, salesMinor: '4895', refundsMinor: '2450', netMinor: '2445' });
    expect(mine.byBranch.map((b: { branchId: string }) => b.branchId)).toEqual([w.b1, w.b1]);
  });

  it("another business's data never appears", async () => {
    const theirs = dataOf(await ask(other.owner, reports.sales, { ...at(other), ...PERIOD }));
    expect(theirs.totals).toEqual([{ currency: 'IQD', count: 1, grossMinor: '100', discountMinor: '0', roundingMinor: '0', salesMinor: '100', refundsMinor: '0', refundCount: 0, netMinor: '100', avgTicketMinor: '100' }]);
    const foreign = await ask(other.owner, reports.sales, { ...at(w), ...PERIOD });
    expect(foreign.ok).toBe(false);
    const stock = dataOf(await ask(other.owner, reports.stockValuationQuery, { ...at(other) }));
    expect(stock.totals).toMatchObject({ damaged: 0, quarantine: 0 });
    expect(stock.inTransit.units).toBe(0);
  });
});

describe('consolidation: the all-branches total is the sum of the branches (independent SQL and domain sums)', () => {
  it('sales: totals equal the sum of byBranch, and equal an independent SQL aggregate', async () => {
    const r = await salesOf();
    const summed = consolidate(
      r.byBranch.map((b: { branchId: string; currency: string; count: number; grossMinor: string; discountMinor: string; roundingMinor: string; salesMinor: string; refundsMinor: string; refundCount: number }) => ({
        branchId: b.branchId,
        currency: b.currency,
        values: { count: BigInt(b.count), gross: BigInt(b.grossMinor), disc: BigInt(b.discountMinor), rnd: BigInt(b.roundingMinor), sales: BigInt(b.salesMinor), refunds: BigInt(b.refundsMinor), refundCount: BigInt(b.refundCount) },
      })),
    );
    expect(summed.map((s) => [s.currency, ...Object.values(s.values)])).toEqual(
      r.totals.map((t: { currency: string; count: number; grossMinor: string; discountMinor: string; roundingMinor: string; salesMinor: string; refundsMinor: string; refundCount: number }) => [t.currency, BigInt(t.count), BigInt(t.grossMinor), BigInt(t.discountMinor), BigInt(t.roundingMinor), BigInt(t.salesMinor), BigInt(t.refundsMinor), BigInt(t.refundCount)]),
    );
    // Independent SQL, written differently (no GROUPING SETS, no UNION): sums per currency straight from the tables.
    // eslint-disable-next-line no-restricted-properties -- the test's own independent aggregate over the tables, bound to the business
    const sold = await prisma().$queryRaw<Array<{ cur: string; n: number; sales: bigint }>>`
      SELECT "currency"::text AS cur, COUNT(*)::int AS n, SUM("totalMinor")::bigint AS sales FROM "PhSale"
      WHERE "restaurantId" = ${w.a.id} AND "status" IN ('COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL')
        AND "completedAt" >= '2026-10-26T21:00:00' AND "completedAt" < '2026-10-28T21:00:00' GROUP BY 1 ORDER BY 1`;
    // eslint-disable-next-line no-restricted-properties -- the test's own independent aggregate over the tables, bound to the business
    const refunded = await prisma().$queryRaw<Array<{ cur: string; refunds: bigint }>>`
      SELECT "currency"::text AS cur, SUM("refundMinor")::bigint AS refunds FROM "PhReturn"
      WHERE "restaurantId" = ${w.a.id} AND "createdAt" >= '2026-10-26T21:00:00' AND "createdAt" < '2026-10-28T21:00:00' GROUP BY 1 ORDER BY 1`;
    expect(r.totals.map((t: { currency: string; count: number; salesMinor: string }) => [t.currency, t.count, BigInt(t.salesMinor)])).toEqual(sold.map((s) => [s.cur, s.n, s.sales]));
    expect(r.totals.filter((t: { refundCount: number }) => t.refundCount > 0).map((t: { currency: string; refundsMinor: string }) => [t.currency, BigInt(t.refundsMinor)])).toEqual(refunded.map((s) => [s.cur, s.refunds]));
  });

  it('every other report: totals are the sum of the branch rows', async () => {
    const margin = dataOf(await ask(w.owner, reports.margin, { ...at(w), ...PERIOD }));
    const mSum = consolidate(margin.byBranch.map((b: { branchId: string; currency: string; netMinor: string; costMinor: string }) => ({ branchId: b.branchId, currency: b.currency, values: { net: BigInt(b.netMinor), cost: BigInt(b.costMinor) } })));
    expect(mSum.map((s) => [s.currency, s.values.net, s.values.cost])).toEqual(margin.totals.map((t: { currency: string; netMinor: string; costMinor: string }) => [t.currency, BigInt(t.netMinor), BigInt(t.costMinor)]));

    const value = dataOf(await ask(w.owner, reports.stockValuationQuery, { ...at(w) }));
    const flat = value.byBranch.flatMap((b: { branchId: string; available: number; quarantine: number; damaged: number; values: Array<{ currency: string; valueMinor: string; damagedValueMinor: string }> }) =>
      b.values.map((v) => ({ branchId: b.branchId, currency: v.currency, values: { value: BigInt(v.valueMinor), damaged: BigInt(v.damagedValueMinor) } })),
    );
    expect(consolidate(flat).map((s) => [s.currency, s.values.value, s.values.damaged])).toEqual(value.totals.values.map((v: { currency: string; valueMinor: string; damagedValueMinor: string }) => [v.currency, BigInt(v.valueMinor), BigInt(v.damagedValueMinor)]));
    for (const bucket of ['available', 'reserved', 'quarantine', 'damaged'] as const) {
      expect(value.byBranch.reduce((s: number, b: Record<string, number>) => s + b[bucket]!, 0)).toBe(value.totals[bucket]);
    }

    const returns = dataOf(await ask(w.owner, reports.returns, { ...at(w), ...PERIOD }));
    expect(returns.byBranch.reduce((s: bigint, b: { refundMinor: string }) => s + BigInt(b.refundMinor), 0n)).toBe(BigInt(returns.totals[0].refundMinor));

    const discounts = dataOf(await ask(w.owner, reports.discounts, { ...at(w), ...PERIOD }));
    const dSum = consolidate(discounts.byBranch.map((b: { branchId: string; currency: string; salesCount: number; discountMinor: string; grossMinor: string }) => ({ branchId: b.branchId, currency: b.currency, values: { n: BigInt(b.salesCount), disc: BigInt(b.discountMinor), gross: BigInt(b.grossMinor) } })));
    expect(dSum.map((s) => [s.currency, s.values.n, s.values.disc, s.values.gross])).toEqual(discounts.totals.map((t: { currency: string; salesCount: number; discountMinor: string; grossMinor: string }) => [t.currency, BigInt(t.salesCount), BigInt(t.discountMinor), BigInt(t.grossMinor)]));

    const low = dataOf(await ask(w.owner, reports.lowStock, { ...at(w) }));
    expect(low.byBranch.reduce((s: number, b: { count: number }) => s + b.count, 0)).toBe(low.total);
  });
});

describe('the reports in other words', () => {
  it('give the same answer as the service called directly (the query layer adds nothing)', async () => {
    const owner = (await asPh(w.owner.userId, w.a.id))!;
    const scoped = scopedClient(prisma(), { restaurantId: w.a.id, allBranches: true });
    const direct = await salesReport(scoped, owner, {}, { ...PERIOD, groupBy: 'day', take: 100 });
    expect(direct).toEqual(await salesOf({ groupBy: 'day' }));
  });
});
