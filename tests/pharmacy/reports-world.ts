import { expect, vi } from 'vitest';
import * as returnActions from '@/server/pharmacy/actions/returns';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as stockActions from '@/server/pharmacy/actions/stock';
import * as transferActions from '@/server/pharmacy/actions/transfers';
import type { ActionResult } from '@/server/studio/framework/result';
import { NOW, person, pharmacy, prisma, type Person } from './fixture';
import { act, dataOf as typedDataOf, makeProduct, stockInto } from './stock-helpers';

/* eslint-disable @typescript-eslint/no-explicit-any -- the tests read many shapes of report off the wire and check them by value */
export const dataOf = (result: ActionResult<unknown>): any => typedDataOf(result);

/**
 * The hand-figure world of the report tests (phase 6, task 4), built through the real services. See `reports.test.ts` for the
 * figures. `build(label, true)` is the full world; `build(label, false)` is a business with one sale.
 *
 * Clock: D1 = 2026-10-27 (Baghdad), D2 = 2026-10-28. S3 is rung at 21:30 UTC on the 27th, which is 00:30 on the 28th in Baghdad.
 * Stock movements take the database clock (a column default), so no test asks for a window around "today" without reading the
 * movement's own stored time first.
 */

let seq = 0;
export const key = (label: string) => `${label}-${(seq += 1)}-${'x'.repeat(8)}`;

export interface Biz {
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

export const price = (restaurantId: string, p: Biz['P'], currency: 'IQD' | 'USD', tablet: bigint, strip: bigint) =>
  prisma().phPrice.createMany({
    data: [
      { restaurantId, productId: p.id, unitId: p.tablet, branchId: null, currency, amountMinor: tablet, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' },
      { restaurantId, productId: p.id, unitId: p.strip, branchId: null, currency, amountMinor: strip, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' },
    ],
  });
export const shift = (restaurantId: string, branchId: string, who: Person, currency: 'IQD' | 'USD' = 'IQD') =>
  prisma().phShift.create({ data: { restaurantId, branchId, userId: who.userId, currency, openingFloatMinor: 0n } });

/** A batch with a cost in any currency, and its stock put there by real movements. */
export async function batch(restaurantId: string, branchId: string, productId: string, over: { lot: string; expiry?: string; available: number; cost?: { minor: bigint; currency: 'IQD' | 'USD'; unitId: string } }) {
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

export const at = (w: Biz, branchId?: string) => ({ restaurantId: w.a.id, ...(branchId ? { branchId } : {}) });
export const cash = (amountMinor: bigint) => ({ method: 'CASH', amountMinor, clientKey: key('pay') });
export const card = (amountMinor: bigint) => ({ method: 'CARD_MANUAL', amountMinor, clientKey: key('pay') });
export const transfer = (amountMinor: bigint) => ({ method: 'TRANSFER_MANUAL', amountMinor, clientKey: key('pay') });

export async function sell(w: Biz, who: Person, branchId: string, currency: 'IQD' | 'USD', lines: unknown[], payments: unknown[], extra: Record<string, unknown> = {}) {
  const made = dataOf(await act(who, saleActions.create, { ...at(w, branchId), clientKey: key('sale'), currency, lines, payments, ...extra }));
  const row = await prisma().phSale.findUniqueOrThrow({ where: { id: made.id }, include: { lines: { include: { allocations: true } } } });
  return { id: made.id as string, number: made.number as string, lineId: row.lines[0]!.id, allocationId: row.lines[0]!.allocations[0]!.id };
}

export async function build(label: string, full: boolean): Promise<Biz> {
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


export interface MarginTruth {
  /** Per currency: net, cost, margin of the lines with a complete cost. */
  totals: Map<string, { net: bigint; cost: bigint }>;
  /** Per `branchId|currency`. */
  byBranch: Map<string, { net: bigint; cost: bigint }>;
  excluded: Map<string, bigint>;
  nulls: number;
  mixed: number;
  nullsByBranch: Map<string, number>;
  mixedByBranch: Map<string, number>;
}

/**
 * The margin the way the rules say it, worked out in plain code straight from the rows (no SQL aggregate, no report code): a sold
 * line counts only when every allocation has a cost in the sale's currency; a return takes back its line refund and the cost in
 * proportion (floored) on the day of the return. `from`/`to` are instants (inclusive start, exclusive end).
 */
export async function marginTruth(restaurantId: string, branchIds: string[], start: Date, endExclusive: Date): Promise<MarginTruth> {
  const out: MarginTruth = { totals: new Map(), byBranch: new Map(), excluded: new Map(), nulls: 0, mixed: 0, nullsByBranch: new Map(), mixedByBranch: new Map() };
  const add = (m: Map<string, { net: bigint; cost: bigint }>, k: string, net: bigint, cost: bigint) => m.set(k, { net: (m.get(k)?.net ?? 0n) + net, cost: (m.get(k)?.cost ?? 0n) + cost });
  const complete = (sale: { currency: string }, allocations: Array<{ costSnapshotMinor: bigint | null; costCurrency: string | null }>) =>
    allocations.every((a) => a.costSnapshotMinor !== null && a.costCurrency === sale.currency);
  const sales = await prisma().phSale.findMany({
    where: { restaurantId, branchId: { in: branchIds }, status: { in: ['COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL'] }, completedAt: { gte: start, lt: endExclusive } },
    include: { lines: { include: { allocations: true } } },
  });
  for (const sale of sales) {
    for (const line of sale.lines) {
      if (complete(sale, line.allocations)) {
        add(out.totals, sale.currency, line.totalMinor, line.allocations.reduce((s, a) => s + a.costSnapshotMinor!, 0n));
        add(out.byBranch, `${sale.branchId}|${sale.currency}`, line.totalMinor, line.allocations.reduce((s, a) => s + a.costSnapshotMinor!, 0n));
      } else {
        out.excluded.set(sale.currency, (out.excluded.get(sale.currency) ?? 0n) + line.totalMinor);
        for (const a of line.allocations) {
          if (a.costSnapshotMinor === null) {
            out.nulls += 1;
            out.nullsByBranch.set(sale.branchId, (out.nullsByBranch.get(sale.branchId) ?? 0) + 1);
          } else if (a.costCurrency !== sale.currency) {
            out.mixed += 1;
            out.mixedByBranch.set(sale.branchId, (out.mixedByBranch.get(sale.branchId) ?? 0) + 1);
          }
        }
      }
    }
  }
  const returns = await prisma().phReturn.findMany({
    where: { restaurantId, branchId: { in: branchIds }, createdAt: { gte: start, lt: endExclusive } },
    include: { lines: { include: { allocation: { include: { saleLine: { include: { sale: true, allocations: true } } } } } } },
  });
  for (const r of returns) {
    for (const rl of r.lines) {
      const a = rl.allocation;
      const sale = a.saleLine.sale;
      if (complete(sale, a.saleLine.allocations)) {
        const back = a.costSnapshotMinor === null ? 0n : (a.costSnapshotMinor * BigInt(rl.baseQty)) / BigInt(a.baseQty);
        add(out.totals, r.currency, -rl.refundMinor, -back);
        add(out.byBranch, `${r.branchId}|${r.currency}`, -rl.refundMinor, -back);
      } else {
        out.excluded.set(r.currency, (out.excluded.get(r.currency) ?? 0n) - rl.refundMinor);
      }
    }
  }
  return out;
}

/** The Baghdad-day window `from..to` as instants, the way the rules define it (written again here, not imported). */
export const instants = (from: string, to: string) => ({
  start: new Date(new Date(`${from}T00:00:00.000Z`).getTime() - 3 * 3_600_000),
  endExclusive: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 24 * 3_600_000 - 3 * 3_600_000),
});
