import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { scopedClient } from '@/server/data/tenant-db';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import * as returnActions from '@/server/pharmacy/actions/returns';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as shiftActions from '@/server/pharmacy/actions/shifts';
import * as transferActions from '@/server/pharmacy/actions/transfers';
import * as chain from '@/server/pharmacy/queries/chain';
import * as exportQueries from '@/server/pharmacy/queries/exports';
import * as reports from '@/server/pharmacy/queries/reports';
import * as sellQueries from '@/server/pharmacy/queries/sell';
import * as transferQueries from '@/server/pharmacy/queries/transfers';
import { stockValuation } from '@/server/pharmacy/reports-stock';
import { asPh, DAY, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { parseCsv, readXlsx, records } from './sheet-read';
import { act, ask, codeOf, dataOf as typedDataOf, makeProduct, phCodeOf } from './stock-helpers';

/* eslint-disable @typescript-eslint/no-explicit-any -- report and dashboard answers are read off the wire and checked by value */
/* eslint-disable no-restricted-properties -- the independent checks of this file are SQL written here, over the tables, on purpose */

/**
 * Acceptance of phase 6 (spec section 12, row 6): "stock in transit appears and is not sold; the sum of the branches = the sum of
 * each branch". Everything is built through the same actions the screens call (receipts, shifts, sales, transfers), in IQD and
 * USD, and every figure below is written out by hand next to the step that makes it. The independent side is plain SQL in this
 * file (no report code, no helper of the code under test).
 *
 * THE WORLD. One product P, sold by the tablet (a strip is 10 tablets). Three branches A, B and C.
 *   Receipts (cost per tablet, confirmed through the receipt service on D1 09:00Z):
 *     A: lot E (expiry 2027-06-30) 18 tablets at 100 IQD     A: lot L (expiry 2028-03-31) 40 tablets at 120 IQD
 *     B: lot LB (expiry 2028-01-31) 20 tablets at 100 IQD    C: lot LC (expiry 2028-06-30) 15 tablets at 2.00 USD (200 minor)
 *   Everything received: 18 + 40 + 20 + 15 = 93 units. Prices per tablet: 300 IQD, 1.50 USD (150 minor).
 *
 * THE STORY (all times UTC; Baghdad is UTC+3, so every sale is on the Baghdad day 2026-10-27).
 *   D1 09:00  T1: B asks A for 30 tablets; A sends them. FEFO takes 18 from lot E (earliest) and 12 from lot L.
 *   D1 10:00  Sales: A sells 5 (IQD) and 1 (USD); B sells 4 (IQD); C sells 1 (IQD) and 2 (USD).
 *   D2 09:00  B receives T1: lot E 18 in full; lot L 7 plus 5 lost. T1 is PARTIAL. (D2 = 2026-10-28)
 *             T2: C asks B for 6; B sends 6 (lot E, its earliest); D2 11:00 C receives 4 plus 2 damaged: PARTIAL.
 *             T3: A asks B for 5; B sends 5 (lot E); D2 12:00 A receives all 5, flagged quarantine: RECEIVED.
 *             T4: C asks A for 3; A sends 3 (lot L) and it stays on the road. T5: B asks A for 4; stays REQUESTED.
 */

let seq = 0;
const key = (label: string) => `${label}-${(seq += 1)}-${'x'.repeat(8)}`;
const dataOf = (result: Parameters<typeof typedDataOf>[0]): any => typedDataOf(result);

const D1 = new Date('2026-10-27T09:00:00.000Z');
const at = (h: number, day: 27 | 28 = 27) => new Date(`2026-10-${day}T${String(h).padStart(2, '0')}:00:00.000Z`);
const WINDOW = { from: '2026-10-27', to: '2026-10-28' };

interface World {
  restaurantId: string;
  A: string;
  B: string;
  C: string;
  owner: Person;
  mgrA: Person;
  mgrB: Person;
  mgrC: Person;
  mgrAB: Person;
  stockB: Person;
  pic: Person;
  accountant: Person;
  pharmacist: Person;
  cashA: Person;
  usdA: Person;
  cashB: Person;
  cashC: Person;
  usdC: Person;
  P: { id: string; tablet: string; strip: string };
  lot: Record<'E' | 'L' | 'LB' | 'LC', string>;
}

let w: World;
const place = () => ({ restaurantId: w.restaurantId });

// --- Independent SQL: stock held, on the road, lost, sold and received, per batch ------------------------------------------------------------

type PerBatch = Map<string, number>;
const mapOf = (rows: Array<{ batchId: string; n: bigint }>): PerBatch => new Map(rows.map((r) => [r.batchId, Number(r.n)]));

async function figures() {
  const id = w.restaurantId;
  const held = mapOf(await prisma().$queryRaw`SELECT "batchId", SUM("available" + "reserved" + "quarantine" + "damaged")::bigint AS n FROM "PhStockBalance" WHERE "restaurantId" = ${id} GROUP BY "batchId"`);
  const road = mapOf(await prisma().$queryRaw`SELECT l."batchId", SUM(l."sentQty" - l."receivedQty" - l."damagedQty" - l."lostQty")::bigint AS n FROM "PhTransferLine" l JOIN "PhTransfer" t ON t."id" = l."transferId" WHERE l."restaurantId" = ${id} AND t."status" = 'SENT' AND l."requestLineId" IS NOT NULL GROUP BY l."batchId"`);
  const lost = mapOf(await prisma().$queryRaw`SELECT "batchId", SUM("lostQty")::bigint AS n FROM "PhTransferLine" WHERE "restaurantId" = ${id} AND "batchId" IS NOT NULL GROUP BY "batchId"`);
  const sold = mapOf(await prisma().$queryRaw`SELECT a."batchId", SUM(a."baseQty" - a."returnedBaseQty")::bigint AS n FROM "PhSaleLineAllocation" a JOIN "PhSaleLine" l ON l."id" = a."saleLineId" JOIN "PhSale" s ON s."id" = l."saleId" WHERE a."restaurantId" = ${id} AND s."status" IN ('COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL') GROUP BY a."batchId"`);
  const received = mapOf(await prisma().$queryRaw`SELECT "batchId", SUM("availableDelta")::bigint AS n FROM "PhStockMovement" WHERE "restaurantId" = ${id} AND "type" = 'RECEIPT' GROUP BY "batchId"`);
  const ledger = Number((await prisma().$queryRaw<{ n: bigint }[]>`SELECT COALESCE(SUM("availableDelta" + "reservedDelta" + "quarantineDelta" + "damagedDelta"), 0)::bigint AS n FROM "PhStockMovement" WHERE "restaurantId" = ${id}`)[0]!.n);
  const total = (m: PerBatch) => [...m.values()].reduce((n, v) => n + v, 0);
  return { held, road, lost, sold, received, ledger, totals: { held: total(held), road: total(road), lost: total(lost), sold: total(sold), received: total(received) } };
}

/** Units are conserved: for EVERY batch, received = held + on the road + lost + sold; and the ledger of movements sums to what is held. */
async function expectConserved(expected: { held: number; road: number; lost: number; sold: number; received: number }) {
  const f = await figures();
  expect(f.totals).toEqual(expected);
  expect(f.totals.held + f.totals.road + f.totals.lost + f.totals.sold).toBe(f.totals.received);
  for (const [batch, received] of f.received) {
    const parts = (f.held.get(batch) ?? 0) + (f.road.get(batch) ?? 0) + (f.lost.get(batch) ?? 0) + (f.sold.get(batch) ?? 0);
    expect(parts, `batch ${batch}`).toBe(received);
  }
  expect(f.ledger).toBe(f.totals.held);
}

/** Held units by branch and bucket, straight from the balances. */
async function bucketsOf(branchId: string) {
  const r = (await prisma().$queryRaw<Array<{ a: bigint; r: bigint; q: bigint; d: bigint }>>`SELECT COALESCE(SUM("available"), 0)::bigint AS a, COALESCE(SUM("reserved"), 0)::bigint AS r, COALESCE(SUM("quarantine"), 0)::bigint AS q, COALESCE(SUM("damaged"), 0)::bigint AS d FROM "PhStockBalance" WHERE "restaurantId" = ${w.restaurantId} AND "branchId" = ${branchId}`)[0]!;
  return { available: Number(r.a), reserved: Number(r.r), quarantine: Number(r.q), damaged: Number(r.d) };
}

/** Completed sales per `currency`: [count, sum of totals], for the given branches. */
/** The Baghdad days of WINDOW as instants: 2026-10-27 00:00 and the end of 2026-10-28 (UTC+3). */
const WINDOW_UTC = { start: new Date('2026-10-26T21:00:00.000Z'), end: new Date('2026-10-28T21:00:00.000Z') };

async function salesSql(branchIds: string[], window = WINDOW_UTC) {
  const rows = await prisma().$queryRaw<Array<{ branchId: string; currency: string; n: bigint; total: bigint }>>`SELECT "branchId", "currency"::text AS currency, COUNT(*)::bigint AS n, SUM("totalMinor")::bigint AS total FROM "PhSale" WHERE "restaurantId" = ${w.restaurantId} AND "status" IN ('COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL') AND "branchId" = ANY(${branchIds}) AND "completedAt" >= ${window.start} AND "completedAt" < ${window.end} GROUP BY "branchId", "currency"`;
  return rows.map((r) => ({ branchId: r.branchId, currency: r.currency, count: Number(r.n), total: r.total }));
}
const sumOf = (rows: Array<{ currency: string; count: number; total: bigint }>, currency: string) => ({
  count: rows.filter((r) => r.currency === currency).reduce((n, r) => n + r.count, 0),
  total: rows.filter((r) => r.currency === currency).reduce((n, r) => n + r.total, 0n),
});

/** Minor units as a sheet writes them: IQD whole, USD with two decimals. */
const fmt = (minor: bigint, currency: string): string => {
  if (currency === 'IQD') return minor.toString();
  const abs = minor < 0n ? -minor : minor;
  return `${minor < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
};

// --- Steps through the real services ------------------------------------------------------------------------------------------------------

async function receive(branchId: string, lot: string, expiry: string, qty: number, cost: bigint, currency: 'IQD' | 'USD') {
  const where = { restaurantId: w.restaurantId, branchId };
  const draft = dataOf(await act(w.owner, receiptActions.create, { ...where, clientKey: key('rcpt'), supplierName: 'Al-Noor Pharma', reference: 'GRN', receivedOn: '2026-10-27', lines: [{ productId: w.P.id, unitId: w.P.tablet, qty, lot, expiry, unitCostMinor: cost, currency }] }));
  dataOf(await act(w.owner, receiptActions.confirm, { ...where, receiptId: draft.id }));
  return (await prisma().phBatch.findFirstOrThrow({ where: { restaurantId: w.restaurantId, lot: lot.toUpperCase() } })).id;
}

const requestTransfer = async (who: Person, from: string, to: string, qty: number) =>
  dataOf(await act(who, transferActions.request, { ...place(), clientKey: key('req'), fromBranchId: from, toBranchId: to, lines: [{ productId: w.P.id, qty }] }));
/** Refunds paid in the window, per currency of the sale, for the given branches. */
async function refundsSql(branchIds: string[], window = WINDOW_UTC): Promise<Map<string, bigint>> {
  const rows = await prisma().$queryRaw<Array<{ currency: string; total: bigint }>>`SELECT s."currency"::text AS currency, COALESCE(SUM(r."refundMinor"), 0)::bigint AS total FROM "PhReturn" r JOIN "PhSale" s ON s."id" = r."saleId" WHERE s."restaurantId" = ${w.restaurantId} AND s."branchId" = ANY(${branchIds}) AND r."createdAt" >= ${window.start} AND r."createdAt" < ${window.end} GROUP BY s."currency"`;
  return new Map(rows.map((r) => [r.currency, r.total]));
}
const sendTransfer = (who: Person, t: { id: string; version: number }, over: Record<string, unknown> = {}) =>
  act(who, transferActions.send, { ...place(), transferId: t.id, version: t.version, clientKey: key('send'), ...over });
const receiveTransfer = (who: Person, t: { id: string; version: number }, lines: unknown[]) =>
  act(who, transferActions.receive, { ...place(), transferId: t.id, version: t.version, clientKey: key('recv'), lines });

const openShift = async (who: Person, branchId: string, currency: 'IQD' | 'USD') =>
  dataOf(await act(who, shiftActions.open, { restaurantId: w.restaurantId, branchId, currency, openingFloatMinor: 0n, clientKey: key('open') }));
const sellInput = (branchId: string, currency: 'IQD' | 'USD', qty: number, price: bigint, discount = 0n) => ({
  restaurantId: w.restaurantId,
  branchId,
  clientKey: key('sale'),
  currency,
  lines: [{ productId: w.P.id, unitId: w.P.tablet, qty }],
  ...(discount > 0n ? { invoiceDiscount: { kind: 'amount' as const, value: discount, reason: 'Regular customer' } } : {}),
  payments: [{ method: 'CASH', amountMinor: price * BigInt(qty) - discount, clientKey: key('pay') }],
});
const sell = (who: Person, branchId: string, currency: 'IQD' | 'USD', qty: number, price: bigint, discount = 0n) => act(who, saleActions.create, sellInput(branchId, currency, qty, price, discount));

/** The sale screen's own search at a branch: what a seller is shown as sellable for P. */
const sellScreen = async (who: Person, branchId: string) => {
  const found = dataOf(await ask(who, sellQueries.search, { restaurantId: w.restaurantId, branchId, q: 'Panadol' }));
  const item = found.items.find((i: any) => i.productId === w.P.id);
  return { sellable: item?.sellableQty ?? 0, lots: (item?.batches ?? []).map((b: any) => [b.lot, b.available]) as Array<[string, number]> };
};

const dash = (who: Person, extra: Record<string, unknown> = {}) => ask(who, chain.dashboard, { ...place(), ...WINDOW, ...extra });
const valuation = (who: Person, extra: Record<string, unknown> = {}) => ask(who, reports.stockValuationQuery, { ...place(), groupBy: 'branch', ...extra });
const road = (who: Person) => ask(who, transferQueries.inTransit, place());

const T: Record<string, { id: string; version: number }> = {};

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(D1);
  await resetWorld();
  const a = await pharmacy('Acc6', { branches: 3 });
  const [A, B, C] = a.branchIds as [string, string, string];
  const staff = (name: string, role: 'BRANCH_MANAGER' | 'STOCK' | 'PHARMACIST_IN_CHARGE' | 'ACCOUNTANT' | 'PHARMACIST' | 'CASHIER', branches: string[]) =>
    person(`${name}Acc6`, { staff: [a.id, role, branches] });
  const P = await makeProduct(a.id, 'Panadol');
  w = {
    restaurantId: a.id,
    A,
    B,
    C,
    owner: await person('ownerAcc6', { membership: [a.id, 'OWNER'] }),
    mgrA: await staff('mgrA', 'BRANCH_MANAGER', [A]),
    mgrB: await staff('mgrB', 'BRANCH_MANAGER', [B]),
    mgrC: await staff('mgrC', 'BRANCH_MANAGER', [C]),
    mgrAB: await staff('mgrAB', 'BRANCH_MANAGER', [A, B]),
    stockB: await staff('stockB', 'STOCK', [B]),
    pic: await staff('pic', 'PHARMACIST_IN_CHARGE', [A, B, C]),
    accountant: await staff('accountant', 'ACCOUNTANT', [A, B, C]),
    pharmacist: await staff('pharmacist', 'PHARMACIST', [A]),
    cashA: await staff('cashA', 'CASHIER', [A]),
    usdA: await staff('usdA', 'CASHIER', [A]),
    cashB: await staff('cashB', 'CASHIER', [B]),
    cashC: await staff('cashC', 'CASHIER', [C]),
    usdC: await staff('usdC', 'CASHIER', [C]),
    P,
    lot: { E: '', L: '', LB: '', LC: '' },
  };
  await prisma().phSettings.create({ data: { restaurantId: a.id, enabledCurrencies: ['IQD', 'USD'] } });
  for (const [currency, amountMinor] of [['IQD', 300n], ['USD', 150n]] as const) {
    await prisma().phPrice.create({ data: { restaurantId: a.id, productId: P.id, unitId: P.tablet, branchId: null, currency, amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
  }
  w.lot.E = await receive(A, 'E', '2027-06-30', 18, 100n, 'IQD');
  w.lot.L = await receive(A, 'L', '2028-03-31', 40, 120n, 'IQD');
  w.lot.LB = await receive(B, 'LB', '2028-01-31', 20, 100n, 'IQD');
  w.lot.LC = await receive(C, 'LC', '2028-06-30', 15, 200n, 'USD');
  await openShift(w.cashA, A, 'IQD');
  await openShift(w.usdA, A, 'USD');
  await openShift(w.cashB, B, 'IQD');
  await openShift(w.cashC, C, 'IQD');
  await openShift(w.usdC, C, 'USD');
}, 240_000);

afterAll(() => {
  vi.useRealTimers();
});

describe('phase 6 acceptance: stock in transit appears and is not sold; the sum of the branches is the sum of each branch', () => {
  it('starts with 93 units received and held, none on the road', async () => {
    await expectConserved({ held: 93, road: 0, lost: 0, sold: 0, received: 93 });
    expect([await bucketsOf(w.A), await bucketsOf(w.B), await bucketsOf(w.C)].map((b) => b.available)).toEqual([58, 20, 15]);
  });

  // ---- STEP 1: 30 tablets leave A for B ----------------------------------------------------------------------------------------------

  it('T1: B asks A for 30; A sends them FEFO as 18 (lot E) + 12 (lot L): A has -30, 30 are on the road', async () => {
    const requested = await requestTransfer(w.mgrB, w.A, w.B, 30);
    expect(requested).toMatchObject({ status: 'REQUESTED', fromBranchId: w.A, toBranchId: w.B });
    const sent = dataOf(await sendTransfer(w.mgrA, requested));
    expect(sent).toMatchObject({ status: 'SENT', totalQty: 30, override: false });
    expect(sent.lines.map((l: any) => [l.batchId, l.sentQty]).sort()).toEqual([[w.lot.E, 18], [w.lot.L, 12]].sort());
    T.t1 = { id: requested.id, version: sent.version };

    // A: E 18 -> 0, L 40 -> 28 (-30 in all). B and C untouched. The other 30 exist only on the road.
    const a = await prisma().phStockBalance.findMany({ where: { branchId: w.A }, select: { batchId: true, available: true } });
    expect(Object.fromEntries(a.map((b) => [b.batchId, b.available]))).toEqual({ [w.lot.E]: 0, [w.lot.L]: 28 });
    expect((await bucketsOf(w.A)).available).toBe(28);
    expect((await bucketsOf(w.B)).available).toBe(20);
    expect((await bucketsOf(w.C)).available).toBe(15);
    await expectConserved({ held: 63, road: 30, lost: 0, sold: 0, received: 93 });
  });

  it('shows the 30 on the road in the transfers screen read and in the chain dashboard, per branch and once in the total', async () => {
    const rows = dataOf(await road(w.owner)) as any[];
    expect(rows.map((r) => [r.lot, r.fromBranchId, r.toBranchId, r.qty]).sort()).toEqual([['E', w.A, w.B, 18], ['L', w.A, w.B, 12]].sort());
    expect(rows.reduce((n, r) => n + r.qty, 0)).toBe(30);

    const d = dataOf(await dash(w.owner));
    expect(d.total.transit).toEqual({ units: 30, transfers: 1 });
    expect(d.total.openTransfers).toEqual({ requested: 0, sent: 1 });
    const card = (id: string) => d.branches.find((b: any) => b.branchId === id);
    expect(card(w.A).transit).toEqual({ incoming: { units: 0, transfers: 0 }, outgoing: { units: 30, transfers: 1 } });
    expect(card(w.B).transit).toEqual({ incoming: { units: 30, transfers: 1 }, outgoing: { units: 0, transfers: 0 } });
    expect(card(w.C).transit).toEqual({ incoming: { units: 0, transfers: 0 }, outgoing: { units: 0, transfers: 0 } });
    // On-hand does NOT include the 30: 28 + 20 + 15 = 63.
    expect([card(w.A).stock.available, card(w.B).stock.available, card(w.C).stock.available, d.total.stock.available]).toEqual([28, 20, 15, 63]);

    // The valuation report keeps them apart from on-hand too: 18 x 100 + 12 x 120 = 3,240 IQD on the road to B.
    const v = dataOf(await valuation(w.owner));
    expect(v.inTransit).toEqual({ units: 30, transfers: 1, byDestination: [{ branchId: w.B, units: 30 }], values: [{ currency: 'IQD', valueMinor: '3240' }] });
  });

  it('stock value on hand with the goods on the road: A 28 x 120 = 3,360, B 20 x 100 = 2,000 (IQD 5,360); C 15 x 2.00 = 3,000.00 USD', async () => {
    const v = dataOf(await valuation(w.owner));
    expect(v.byBranch.map((b: any) => [b.branchId, b.available, b.values.map((x: any) => [x.currency, x.valueMinor])])).toEqual([
      [w.A, 28, [['IQD', '3360']]],
      [w.B, 20, [['IQD', '2000']]],
      [w.C, 15, [['USD', '3000']]],
    ]);
    expect(v.totals).toMatchObject({ available: 63, reserved: 0, quarantine: 0, damaged: 0, noCostRows: 0, valuationComplete: true });
    expect(v.totals.values).toEqual([{ currency: 'IQD', valueMinor: '5360', damagedValueMinor: '0' }, { currency: 'USD', valueMinor: '3000', damagedValueMinor: '0' }]);
  });

  it('the sale screen and the sale service cannot sell the units on the road, at the sender or at the destination', async () => {
    // Sale screen: A offers 28 (lot L only: lot E has 0 left), B offers 20 (its own lot LB only); nothing from the road.
    expect(await sellScreen(w.cashA, w.A)).toEqual({ sellable: 28, lots: [['L', 28]] });
    expect(await sellScreen(w.cashB, w.B)).toEqual({ sellable: 20, lots: [['LB', 20]] });
    expect(await sellScreen(w.cashC, w.C)).toEqual({ sellable: 15, lots: [['LC', 15]] });

    // Sale service: 29 at A (28 + 1 of the road) and 21 at B (20 + 1 of the road) are refused, and nothing is written.
    const movements = await prisma().phStockMovement.count();
    const sales = await prisma().phSale.count();
    expect(phCodeOf(await sell(w.cashA, w.A, 'IQD', 29, 300n))).toBe('INSUFFICIENT_STOCK');
    expect(phCodeOf(await sell(w.cashB, w.B, 'IQD', 21, 300n))).toBe('INSUFFICIENT_STOCK');
    expect(await prisma().phStockMovement.count()).toBe(movements);
    expect(await prisma().phSale.count()).toBe(sales);
    await expectConserved({ held: 63, road: 30, lost: 0, sold: 0, received: 93 });
  });

  // ---- STEP 2: sales ------------------------------------------------------------------------------------------------------------------

  it('sells at the three branches in IQD and USD (D1 10:00Z)', async () => {
    vi.setSystemTime(at(10));
    expect(codeOf(await sell(w.cashA, w.A, 'IQD', 5, 300n, 60n))).toBe('OK'); // 1,500 IQD less a 60 IQD invoice discount (4%, inside the cashier's 5%) = 1,440 IQD
    expect(codeOf(await sell(w.usdA, w.A, 'USD', 1, 150n))).toBe('OK'); // 1.50 USD
    expect(codeOf(await sell(w.cashB, w.B, 'IQD', 4, 300n))).toBe('OK'); // 1,200 IQD
    expect(codeOf(await sell(w.cashC, w.C, 'IQD', 1, 300n))).toBe('OK'); // 300 IQD
    expect(codeOf(await sell(w.usdC, w.C, 'USD', 2, 150n))).toBe('OK'); // 3.00 USD
    // A: 28 - 6 = 22; B: 20 - 4 = 16; C: 15 - 3 = 12. Sold 13 in all.
    expect(await Promise.all([w.A, w.B, w.C].map(async (b) => (await bucketsOf(b)).available))).toEqual([22, 16, 12]);
    await expectConserved({ held: 50, road: 30, lost: 0, sold: 13, received: 93 });
  });

  it('a customer of B brings back 1 of the 4 tablets (D1 10:30Z): 300 IQD refunded, the tablet waits in quarantine, 12 are sold net', async () => {
    vi.setSystemTime(new Date('2026-10-27T10:30:00.000Z'));
    await openShift(w.mgrB, w.B, 'IQD'); // the refund is paid from the manager's own drawer
    const sale = await prisma().phSale.findFirstOrThrow({ where: { restaurantId: w.restaurantId, branchId: w.B, currency: 'IQD' }, include: { lines: true } });
    const made = await act(w.mgrB, returnActions.create, { restaurantId: w.restaurantId, branchId: w.B, saleId: sale.id, lines: [{ saleLineId: sale.lines[0]!.id, baseQty: 1 }], reason: 'Customer changed their mind', clientKey: key('ret') });
    expect(codeOf(made)).toBe('OK');
    expect((await prisma().phReturn.findMany({ where: { saleId: sale.id } })).map((r) => r.refundMinor)).toEqual([300n]);
    expect(await bucketsOf(w.B)).toMatchObject({ available: 16, quarantine: 1 });
    await expectConserved({ held: 51, road: 30, lost: 0, sold: 12, received: 93 });
  });

  // ---- STEP 3: the destination receives 25 and 5 are lost ----------------------------------------------------------------------------

  it('a stock clerk (no report.view) cannot close a transfer with lost units, and nothing changes', async () => {
    vi.setSystemTime(at(9, 28));
    const lines = await prisma().phTransferLine.findMany({ where: { transferId: T.t1!.id, requestLineId: { not: null } } });
    const l = (batchId: string) => lines.find((x) => x.batchId === batchId)!.id;
    const before = await figures();
    const refused = await receiveTransfer(w.stockB, T.t1!, [{ lineId: l(w.lot.E), receivedQty: 18 }, { lineId: l(w.lot.L), receivedQty: 7, lostQty: 5, lostReason: 'LOST' }]);
    expect(phCodeOf(refused)).toBe('LOSS_NEEDS_REPORT_VIEW');
    const after = await figures();
    expect(after.totals).toEqual(before.totals);
    expect((await prisma().phTransfer.findUniqueOrThrow({ where: { id: T.t1!.id } })).status).toBe('SENT');
    // ...but the same clerk CAN receive a transfer with nothing lost (the right is for losses only): proven on T2 below.
  });

  it('B receives 18 + 7 and records 5 lost: PARTIAL, B +25, the road back to 0, 5 lost, every unit still counted', async () => {
    const lines = await prisma().phTransferLine.findMany({ where: { transferId: T.t1!.id, requestLineId: { not: null } } });
    const l = (batchId: string) => lines.find((x) => x.batchId === batchId)!.id;
    const done = dataOf(await receiveTransfer(w.mgrB, T.t1!, [{ lineId: l(w.lot.E), receivedQty: 18 }, { lineId: l(w.lot.L), receivedQty: 7, lostQty: 5, lostReason: 'LOST' }]));
    expect(done).toMatchObject({ status: 'PARTIAL', receivedQty: 25, damagedQty: 0, lostQty: 5 });

    const b = await prisma().phStockBalance.findMany({ where: { branchId: w.B }, select: { batchId: true, available: true } });
    expect(Object.fromEntries(b.map((x) => [x.batchId, x.available]))).toEqual({ [w.lot.LB]: 16, [w.lot.E]: 18, [w.lot.L]: 7 }); // 41 = 16 + 25
    expect(dataOf(await road(w.owner))).toEqual([]);
    // Held 22 + 41 + 12 = 75, on the road 0, lost 5, sold 13: 93.
    await expectConserved({ held: 76, road: 0, lost: 5, sold: 12, received: 93 });
    const d = dataOf(await dash(w.owner));
    expect(d.total.transit).toEqual({ units: 0, transfers: 0 });
    expect(d.total.stock.available).toBe(75);
  });

  // ---- STEP 4: the variants: damaged on the road, quarantine, a transfer left on the road, a request ---------------------------------

  it('T2 (damaged on the road): B sends 6 (lot E) to C; a stock clerk of C may receive it; 4 arrive, 2 damaged: PARTIAL, C damaged +2', async () => {
    const t = await requestTransfer(w.mgrC, w.B, w.C, 6);
    const sent = dataOf(await sendTransfer(w.mgrB, t));
    expect(sent.lines.map((l: any) => [l.batchId, l.sentQty])).toEqual([[w.lot.E, 6]]);
    // B: E 18 - 6 = 12. On the road 6.
    await expectConserved({ held: 70, road: 6, lost: 5, sold: 12, received: 93 });
    expect(dataOf(await dash(w.owner)).total.transit).toEqual({ units: 6, transfers: 1 });

    vi.setSystemTime(at(11, 28));
    const stockC = await person('stockCAcc6', { staff: [w.restaurantId, 'STOCK', [w.C]] });
    const done = dataOf(await receiveTransfer(stockC, { id: t.id, version: sent.version }, [{ lineId: sent.lines[0].lineId, receivedQty: 4, damagedQty: 2 }]));
    expect(done).toMatchObject({ status: 'PARTIAL', receivedQty: 4, damagedQty: 2, lostQty: 0 });
    const c = await prisma().phStockBalance.findFirstOrThrow({ where: { branchId: w.C, batchId: w.lot.E } });
    expect([c.available, c.damaged]).toEqual([4, 2]);
    // The damaged units are held (in the damaged bucket), not lost: held 75, lost still 5.
    await expectConserved({ held: 76, road: 0, lost: 5, sold: 12, received: 93 });
    T.t2 = { id: t.id, version: done.version };
  });

  it('T3 (quarantine): B sends 5 (lot E) to A; A receives them flagged quarantine: RECEIVED, A quarantine +5, not sellable', async () => {
    const t = await requestTransfer(w.mgrA, w.B, w.A, 5);
    const sent = dataOf(await sendTransfer(w.mgrB, t));
    expect(sent.lines.map((l: any) => [l.batchId, l.sentQty])).toEqual([[w.lot.E, 5]]); // B: E 12 - 5 = 7
    vi.setSystemTime(at(12, 28));
    const done = dataOf(await receiveTransfer(w.mgrA, { id: t.id, version: sent.version }, [{ lineId: sent.lines[0].lineId, receivedQty: 5, quarantine: true }]));
    expect(done).toMatchObject({ status: 'RECEIVED', receivedQty: 5, lostQty: 0, damagedQty: 0 });
    const a = await prisma().phStockBalance.findFirstOrThrow({ where: { branchId: w.A, batchId: w.lot.E } });
    expect([a.available, a.quarantine]).toEqual([0, 5]);
    expect(await sellScreen(w.cashA, w.A)).toEqual({ sellable: 22, lots: [['L', 22]] }); // the 5 in quarantine are not offered
    await expectConserved({ held: 76, road: 0, lost: 5, sold: 12, received: 93 });
  });

  it('T4 (left on the road) and T5 (only asked): 3 tablets from A to C stay in transit; the request moves nothing', async () => {
    const t4 = await requestTransfer(w.mgrC, w.A, w.C, 3);
    const sent = dataOf(await sendTransfer(w.mgrA, t4));
    expect(sent.lines.map((l: any) => [l.batchId, l.sentQty])).toEqual([[w.lot.L, 3]]); // A: L 22 - 3 = 19
    await requestTransfer(w.mgrB, w.A, w.B, 4); // T5
    T.t4 = { id: t4.id, version: sent.version };
    expect(await sellScreen(w.cashA, w.A)).toEqual({ sellable: 19, lots: [['L', 19]] });
    await expectConserved({ held: 73, road: 3, lost: 5, sold: 12, received: 93 });
  });

  // ---- STEP 5: the final reports, each equal to hand figures ----------------------------------------------------------------------------
  //
  // Final stock (hand): A: lot L 19 available + lot E 5 quarantine. B: E 7, LB 16, L 7 (all available) and 1 of LB in quarantine (the return). C: LC 12 + E 4 available, E 2 damaged.
  // Value = (available + reserved + quarantine) x cost: A 19 x 120 + 5 x 100 = 2,780; B 7 x 100 + 16 x 100 + 7 x 120 + 1 x 100 returned = 3,240;
  // C 4 x 100 = 400 IQD and 12 x 2.00 = 2,400.00 USD; damaged C 2 x 100 = 200 IQD, apart.

  it('stock valuation equals the hand figures per branch and in total (damaged apart, quarantine valued, the road shown apart)', async () => {
    const v = dataOf(await valuation(w.owner));
    const brief = (id: string) => v.byBranch.find((b: any) => b.branchId === id);
    expect([brief(w.A).available, brief(w.A).quarantine, brief(w.A).damaged]).toEqual([19, 5, 0]);
    expect([brief(w.B).available, brief(w.B).quarantine, brief(w.B).damaged]).toEqual([30, 1, 0]);
    expect([brief(w.C).available, brief(w.C).quarantine, brief(w.C).damaged]).toEqual([16, 0, 2]);
    expect(brief(w.A).values).toEqual([{ currency: 'IQD', valueMinor: '2780', damagedValueMinor: '0' }]);
    expect(brief(w.B).values).toEqual([{ currency: 'IQD', valueMinor: '3240', damagedValueMinor: '0' }]);
    expect(brief(w.C).values).toEqual([{ currency: 'IQD', valueMinor: '400', damagedValueMinor: '200' }, { currency: 'USD', valueMinor: '2400', damagedValueMinor: '0' }]);
    expect(v.totals).toEqual({
      available: 65,
      reserved: 0,
      quarantine: 6,
      damaged: 2,
      noCostRows: 0,
      valuationComplete: true,
      values: [{ currency: 'IQD', valueMinor: '6420', damagedValueMinor: '200' }, { currency: 'USD', valueMinor: '2400', damagedValueMinor: '0' }],
    });
    expect(v.inTransit).toEqual({ units: 3, transfers: 1, byDestination: [{ branchId: w.C, units: 3 }], values: [{ currency: 'IQD', valueMinor: '360' }] });
    // The buckets agree with the balances read by SQL.
    for (const [id, b] of [[w.A, brief(w.A)], [w.B, brief(w.B)], [w.C, brief(w.C)]] as const) {
      expect(await bucketsOf(id)).toEqual({ available: b.available, reserved: b.reserved, quarantine: b.quarantine, damaged: b.damaged });
    }
  });

  it('the transfers report: 5 transfers, 5 lost and 2 damaged in transit, 3 units on the road, average time in transit 9 hours', async () => {
    const r = dataOf(await ask(w.owner, reports.transfers, { ...place(), ...WINDOW }));
    expect(r.total).toBe(5);
    expect(r.byStatus).toEqual([{ status: 'PARTIAL', count: 2 }, { status: 'RECEIVED', count: 1 }, { status: 'REQUESTED', count: 1 }, { status: 'SENT', count: 1 }]);
    // by SENDING branch: A sent T4 and was asked T5 and T1 (3), B sent T2 and T3 (2); they add up to the total.
    expect(r.byBranch).toEqual([{ branchId: w.A, count: 3 }, { branchId: w.B, count: 2 }]);
    expect(r.inTransit).toEqual({ units: 3, transfers: 1, byRoute: [{ fromBranchId: w.A, toBranchId: w.C, units: 3 }] });
    expect(r.lost).toEqual({ lostQty: 5, damagedQty: 2, byReason: [{ reason: 'LOST', lostQty: 5 }] });
    // T1 sent D1 09:00 received D2 09:00 = 86,400 s; T2 09:00 -> 11:00 = 7,200 s; T3 11:00 -> 12:00 = 3,600 s; mean 32,400 s = 9 h.
    expect(r.avgTransitSeconds).toBe(32_400);
    const t1 = r.rows.find((x: any) => x.id === T.t1!.id);
    expect(t1).toMatchObject({ status: 'PARTIAL', requestedQty: 30, sentQty: 30, receivedQty: 25, lostQty: 5, damagedQty: 0 });
    // The report's own rows equal the rows of the database.
    const sql = await prisma().$queryRaw<Array<{ lost: bigint; damaged: bigint }>>`SELECT COALESCE(SUM("lostQty"), 0)::bigint AS lost, COALESCE(SUM("damagedQty"), 0)::bigint AS damaged FROM "PhTransferLine" WHERE "restaurantId" = ${w.restaurantId}`;
    expect([Number(sql[0]!.lost), Number(sql[0]!.damaged)]).toEqual([r.lost.lostQty, r.lost.damagedQty]);
  });

  // Sales (hand): IQD  A 1,440 (1 sale: 1,500 less a 60 discount)  B 1,200 (1)  C 300 (1)  total 2,940 (3 sales); B refunded 300 (net 2,640);  USD  A 1.50 (1)  C 3.00 (1)  total 4.50 (2).

  it('the sum of the branches = the chain total = the sum of each branch asked alone, per currency, and all equal independent SQL', async () => {
    const sql = await salesSql([w.A, w.B, w.C]);
    expect(sumOf(sql, 'IQD')).toEqual({ count: 3, total: 2940n });
    expect(sumOf(sql, 'USD')).toEqual({ count: 2, total: 450n });
    expect(sql.map((r) => [r.branchId === w.A ? 'A' : r.branchId === w.B ? 'B' : 'C', r.currency, r.count, r.total]).sort()).toEqual([
      ['A', 'IQD', 1, 1440n], ['A', 'USD', 1, 150n], ['B', 'IQD', 1, 1200n], ['C', 'IQD', 1, 300n], ['C', 'USD', 1, 300n],
    ].sort());

    const refunds = await refundsSql([w.A, w.B, w.C]);
    expect(refunds.get('IQD')).toBe(300n);
    const sales = dataOf(await ask(w.owner, reports.sales, { ...place(), ...WINDOW, groupBy: 'branch' }));
    const dashboard = dataOf(await dash(w.owner));
    for (const currency of ['IQD', 'USD']) {
      const expected = sumOf(sql, currency);
      // (1) the report's total, (2) the sum of the report's own per-branch rows, (3) the dashboard total, (4) the sum of the dashboard cards.
      const total = sales.totals.find((t: any) => t.currency === currency);
      const byBranch = sales.byBranch.filter((b: any) => b.currency === currency);
      const cards = dashboard.branches.flatMap((b: any) => b.sales.filter((s: any) => s.currency === currency));
      const dashTotal = dashboard.total.sales.find((s: any) => s.currency === currency);
      expect([total.count, BigInt(total.salesMinor)], `report ${currency}`).toEqual([expected.count, expected.total]);
      expect([byBranch.reduce((n: number, b: any) => n + b.count, 0), byBranch.reduce((n: bigint, b: any) => n + BigInt(b.salesMinor), 0n)], `rows ${currency}`).toEqual([expected.count, expected.total]);
      expect([dashTotal.count, BigInt(dashTotal.salesMinor), BigInt(dashTotal.netMinor)], `dashboard ${currency}`).toEqual([expected.count, expected.total, expected.total - (refunds.get(currency) ?? 0n)]);
      expect([cards.reduce((n: number, s: any) => n + s.count, 0), cards.reduce((n: bigint, s: any) => n + BigInt(s.salesMinor), 0n)], `cards ${currency}`).toEqual([expected.count, expected.total]);
      // (5) each branch asked alone (the branch filter) and summed.
      let count = 0;
      let money = 0n;
      for (const branchId of [w.A, w.B, w.C]) {
        const one = dataOf(await ask(w.owner, reports.sales, { ...place(), ...WINDOW, groupBy: 'day', branchId }));
        const row = one.totals.find((t: any) => t.currency === currency);
        const mine = sql.find((r) => r.branchId === branchId && r.currency === currency);
        expect([row?.count ?? 0, BigInt(row?.salesMinor ?? '0')], `${branchId} ${currency}`).toEqual([mine?.count ?? 0, mine?.total ?? 0n]);
        count += row?.count ?? 0;
        money += BigInt(row?.salesMinor ?? '0');
      }
      expect([count, money], `alone ${currency}`).toEqual([expected.count, expected.total]);
    }
  });

  it('a window that holds no sale gives no sale, in the report and in the independent SQL alike', async () => {
    const later = { start: new Date('2026-10-28T21:00:00.000Z'), end: new Date('2026-10-30T21:00:00.000Z') };
    expect(await salesSql([w.A, w.B, w.C], later)).toEqual([]);
    expect((await refundsSql([w.A, w.B, w.C], later)).size).toBe(0);
    const sales = dataOf(await ask(w.owner, reports.sales, { ...place(), from: '2026-10-29', to: '2026-10-30', groupBy: 'branch' }));
    expect(sales.totals).toEqual([]);
  });

  it('a person who works in A and B gets the total of A and B only (2,640 IQD, 1.50 USD), in the report, the dashboard and the stock value', async () => {
    const sql = await salesSql([w.A, w.B]);
    expect(sumOf(sql, 'IQD')).toEqual({ count: 2, total: 2640n });
    expect(sumOf(sql, 'USD')).toEqual({ count: 1, total: 150n });
    const sales = dataOf(await ask(w.mgrAB, reports.sales, { ...place(), ...WINDOW, groupBy: 'branch' }));
    expect(sales.totals.map((t: any) => [t.currency, t.count, t.salesMinor])).toEqual([['IQD', 2, '2640'], ['USD', 1, '150']]);
    expect(sales.byBranch.every((b: any) => b.branchId !== w.C)).toBe(true);
    const d = dataOf(await dash(w.mgrAB));
    expect(d.branches.map((b: any) => b.branchId)).toEqual([w.A, w.B]);
    expect(d.total.sales.map((t: any) => [t.currency, t.count, t.salesMinor])).toEqual([['IQD', 2, '2640'], ['USD', 1, '150']]);
    expect(d.total.stock.available).toBe(19 + 30); // A + B only
    expect(d.total.stock.values).toEqual([{ currency: 'IQD', valueMinor: '6020', damagedValueMinor: '0' }]); // 2,780 + 3,240
    expect(d.total.transit).toEqual({ units: 3, transfers: 1 }); // T4 leaves A (a branch of theirs): counted once
    expect(JSON.stringify(d)).not.toContain(w.C); // C is never named, though T4 goes there
    const v = dataOf(await valuation(w.mgrAB));
    expect(v.byBranch.map((b: any) => b.branchId)).toEqual([w.A, w.B]);
    expect(v.totals.values).toEqual([{ currency: 'IQD', valueMinor: '6020', damagedValueMinor: '0' }]);
    expect(JSON.stringify(v)).not.toContain(w.C);
  });

  it('the dashboard equals the hand figures: stock, value, road, open transfers', async () => {
    const d = dataOf(await dash(w.owner));
    const card = (id: string) => d.branches.find((b: any) => b.branchId === id);
    expect(d.branches.map((b: any) => b.branchId)).toEqual([w.A, w.B, w.C]);
    expect([card(w.A).stock.available, card(w.A).stock.quarantine, card(w.B).stock.available, card(w.C).stock.available, card(w.C).stock.damaged]).toEqual([19, 5, 30, 16, 2]);
    expect(card(w.A).stock.values).toEqual([{ currency: 'IQD', valueMinor: '2780', damagedValueMinor: '0' }]);
    expect(card(w.C).stock.values).toEqual([{ currency: 'IQD', valueMinor: '400', damagedValueMinor: '200' }, { currency: 'USD', valueMinor: '2400', damagedValueMinor: '0' }]);
    expect(d.total.stock).toMatchObject({ available: 65, quarantine: 6, damaged: 2, valuationComplete: true });
    expect(d.total.stock.values).toEqual([{ currency: 'IQD', valueMinor: '6420', damagedValueMinor: '200' }, { currency: 'USD', valueMinor: '2400', damagedValueMinor: '0' }]);
    expect(d.total.transit).toEqual({ units: 3, transfers: 1 });
    expect(card(w.A).transit.outgoing).toEqual({ units: 3, transfers: 1 });
    expect(card(w.C).transit.incoming).toEqual({ units: 3, transfers: 1 });
    expect(d.total.openTransfers).toEqual({ requested: 1, sent: 1 });
    await expectConserved({ held: 73, road: 3, lost: 5, sold: 12, received: 93 });
  });

  // ---- STEP 6: exports equal the screens ----------------------------------------------------------------------------------------------------

  const exported = async (who: Person, report: string, format: 'csv' | 'xlsx', input: Record<string, unknown> = {}) => {
    const data = dataOf(await ask(who, exportQueries.report, { ...place(), report, format, ...input }));
    const bytes = new Uint8Array(Buffer.from(data.base64, 'base64'));
    return { data, rows: records(format === 'csv' ? parseCsv(bytes) : await readXlsx(bytes)) };
  };

  it('the sales export (CSV and Excel) has the report rows and totals, cell for cell', async () => {
    const report = dataOf(await ask(w.owner, reports.sales, { ...place(), ...WINDOW, groupBy: 'branch' }));
    for (const format of ['csv', 'xlsx'] as const) {
      const { rows } = await exported(w.owner, 'sales', format, { ...WINDOW, groupBy: 'branch' });
      const lines = rows.filter((r) => r.rowType === 'row');
      expect(lines).toHaveLength(report.rows.length);
      for (const row of report.rows) {
        const got = lines.find((r) => r.key === row.key && r.currency === row.currency)!;
        expect([got.count, got.sales, got.net], `${format} ${row.key}`).toEqual([String(row.count), fmt(BigInt(row.salesMinor), row.currency), fmt(BigInt(row.netMinor), row.currency)]);
      }
      for (const t of report.totals) {
        const got = rows.find((r) => r.rowType === 'total' && r.currency === t.currency)!;
        expect([got.count, got.sales], `${format} total ${t.currency}`).toEqual([String(t.count), fmt(BigInt(t.salesMinor), t.currency)]);
      }
    }
  });

  it('the stock valuation, transfers and chain exports equal their screens', async () => {
    const v = dataOf(await valuation(w.owner));
    const valuationRows = (await exported(w.owner, 'stockValuation', 'csv', { groupBy: 'branch' })).rows;
    for (const b of v.byBranch) {
      const mine = valuationRows.filter((r) => r.rowType === 'row' && r.key === b.branchId);
      expect([mine[0]!.available, mine[0]!.quarantine, mine[0]!.damaged]).toEqual([String(b.available), String(b.quarantine), String(b.damaged)]);
      for (const x of b.values) expect(mine.find((r) => r.currency === x.currency)!.value, `${b.branchId} ${x.currency}`).toBe(fmt(BigInt(x.valueMinor), x.currency));
    }
    for (const x of v.totals.values) expect(valuationRows.find((r) => r.rowType === 'total' && r.currency === x.currency)!.value).toBe(fmt(BigInt(x.valueMinor), x.currency));

    const t = dataOf(await ask(w.owner, reports.transfers, { ...place(), ...WINDOW }));
    const transferRows = (await exported(w.owner, 'transfers', 'xlsx', WINDOW)).rows.filter((r) => r.rowType === 'row');
    expect(transferRows).toHaveLength(t.rows.length);
    for (const row of t.rows) {
      const got = transferRows.find((r) => r.number === row.number)!;
      expect([got.status, got.sent, got.received, got.lost, got.damaged], row.number).toEqual([row.status, String(row.sentQty), String(row.receivedQty), String(row.lostQty), String(row.damagedQty)]);
    }
    expect(transferRows.reduce((n, r) => n + Number(r.lost), 0)).toBe(5);

    const d = dataOf(await dash(w.owner));
    const chainRows = (await exported(w.owner, 'chain', 'csv', WINDOW)).rows;
    const total = chainRows.find((r) => r.rowType === 'total')!;
    for (const currency of ['IQD', 'USD']) {
      expect(total[`net_${currency}`]).toBe(fmt(BigInt(d.total.sales.find((s: any) => s.currency === currency).netMinor), currency));
      expect(chainRows.filter((r) => r.rowType === 'branch').reduce((n, r) => n + BigInt(Math.round(Number(r[`net_${currency}`]) * (currency === 'USD' ? 100 : 1))), 0n)).toBe(BigInt(d.total.sales.find((s: any) => s.currency === currency).netMinor));
    }
    expect(total.inTransitOnce).toBe('3');
  });

  // ---- STEP 7: who sees what ------------------------------------------------------------------------------------------------------------

  it('gated keys are absent and gated screens refused without the permissions', async () => {
    // Cost keys: no real role has report.view without cost.view, so the service is called as a role that lacks cost.view.
    const owner = (await asPh(w.owner.userId, w.restaurantId))!;
    const scoped = scopedClient(prisma(), { restaurantId: w.restaurantId, allBranches: true });
    const bare = await stockValuation(scoped, { ...owner, role: 'PHARMACIST' }, {}, { groupBy: 'branch', take: 100 });
    expect(bare.totals).toEqual({ available: 65, reserved: 0, quarantine: 6, damaged: 2 });
    expect(JSON.stringify(bare)).not.toMatch(/valueMinor|noCostRows|valuationComplete/);

    // Roles: cashier, pharmacist and stock clerk read no report, no dashboard, no export.
    for (const who of [w.cashA, w.pharmacist, w.stockB]) {
      expect(codeOf(await ask(who, reports.sales, { ...place(), ...WINDOW })), 'sales').toBe('FORBIDDEN');
      expect(codeOf(await ask(who, reports.stockValuationQuery, place())), 'valuation').toBe('FORBIDDEN');
      expect(codeOf(await ask(who, reports.transfers, { ...place(), ...WINDOW })), 'transfers').toBe('FORBIDDEN');
      expect(codeOf(await dash(who)), 'chain').toBe('FORBIDDEN');
      expect(codeOf(await ask(who, exportQueries.report, { ...place(), report: 'sales', format: 'csv', ...WINDOW })), 'export').toBe('FORBIDDEN');
    }
    // Transfers are for transfer.manage: a cashier and a pharmacist read none; an accountant (reports only) reads reports but not transfers.
    for (const who of [w.cashA, w.pharmacist, w.accountant, w.pic]) expect(codeOf(await road(who)), 'road').toBe('FORBIDDEN');
    expect(codeOf(await ask(w.accountant, reports.transfers, { ...place(), ...WINDOW }))).toBe('OK');
    // Margin needs profit.view as well: the pharmacist in charge (report.view, cost.view, no profit.view) is refused, the accountant is not.
    expect(codeOf(await ask(w.pic, reports.margin, { ...place(), ...WINDOW }))).not.toBe('OK');
    expect(codeOf(await ask(w.accountant, reports.margin, { ...place(), ...WINDOW }))).toBe('OK');
    // Another business sees none of this.
    const other = await pharmacy('Other6', { branches: 1 });
    const stranger = await person('strangerAcc6', { membership: [other.id, 'OWNER'] });
    expect((await ask(stranger, reports.sales, { restaurantId: w.restaurantId, ...WINDOW })).ok).toBe(false);
    expect((await ask(stranger, chain.dashboard, { restaurantId: w.restaurantId, ...WINDOW })).ok).toBe(false);
    expect((await ask(stranger, transferQueries.inTransit, place())).ok).toBe(false);
  });

  // ---- STEP 8: read-only (lapsed) mode ----------------------------------------------------------------------------------------------------

  it('after the subscription lapses (read-only) reports and exports stay open and transfers, sales and receipts are blocked', async () => {
    const before = await figures();
    const sql = await salesSql([w.A, w.B, w.C]);
    // The period ended 25 days after D1 and the grace is 7 days: 40 days on, the business is read-only.
    vi.setSystemTime(new Date(NOW.getTime() + 40 * DAY));

    const sales = dataOf(await ask(w.owner, reports.sales, { ...place(), ...WINDOW, groupBy: 'branch' }));
    expect(sales.totals.map((t: any) => [t.currency, t.count, t.salesMinor])).toEqual([['IQD', sumOf(sql, 'IQD').count, '2940'], ['USD', sumOf(sql, 'USD').count, '450']]);
    expect(dataOf(await valuation(w.owner)).totals.available).toBe(65);
    expect(dataOf(await dash(w.owner)).total.transit).toEqual({ units: 3, transfers: 1 });
    expect(dataOf(await ask(w.owner, reports.transfers, { ...place(), ...WINDOW })).lost.lostQty).toBe(5);
    const file = await exported(w.owner, 'sales', 'csv', { ...WINDOW, groupBy: 'branch' });
    expect(file.rows.filter((r) => r.rowType === 'row')).toHaveLength(5);

    // Writes are refused: a new request, the receipt of the transfer still on the road, a sale, a receipt of goods.
    expect(codeOf(await act(w.mgrB, transferActions.request, { ...place(), clientKey: key('req'), fromBranchId: w.A, toBranchId: w.B, lines: [{ productId: w.P.id, qty: 1 }] }))).toBe('FORBIDDEN');
    const lines = await prisma().phTransferLine.findMany({ where: { transferId: T.t4!.id, requestLineId: { not: null } } });
    expect(codeOf(await receiveTransfer(w.mgrC, T.t4!, [{ lineId: lines[0]!.id, receivedQty: 3 }]))).toBe('FORBIDDEN');
    expect(codeOf(await sell(w.cashA, w.A, 'IQD', 1, 300n))).toBe('FORBIDDEN');
    expect((await figures()).totals).toEqual(before.totals);
    expect((await prisma().phTransfer.findUniqueOrThrow({ where: { id: T.t4!.id } })).status).toBe('SENT');
  });
});
