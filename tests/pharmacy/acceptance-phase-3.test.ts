import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as printActions from '@/server/pharmacy/actions/receipt-print';
import * as returnActions from '@/server/pharmacy/actions/returns';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as shiftActions from '@/server/pharmacy/actions/shifts';
import * as stockActions from '@/server/pharmacy/actions/stock';
import * as printQueries from '@/server/pharmacy/queries/receipt-print';
import * as saleQueries from '@/server/pharmacy/queries/sales';
import * as sellQueries from '@/server/pharmacy/queries/sell';
import * as shiftQueries from '@/server/pharmacy/queries/shifts';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, ask, balanceOf, codeOf, dataOf, makeBatch, makeProduct, phCodeOf } from './stock-helpers';

/**
 * Acceptance of phase 3 (spec section 12, row 3), through the same actions and queries the screens call: the full path
 * scan -> sale -> printed receipt -> shift report with hand figures; N parallel sales of the last unit -> exactly one;
 * a resend with the same key -> one payment; a print failure never cancels a sale. Plus the rest of the row: mixed
 * payments, FEFO, hold, return into quarantine and back to sale. The detailed rules live in the per-task files
 * (sales, shifts, returns, receipt-print, sell-holds); these scenarios are the owner's checklist.
 */

const BARCODE = '0012345678905'; // leading zero on purpose: it must stay a string end to end

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

let seq = 0;
const key = (label: string) => `${label}-${(seq += 1)}-${'x'.repeat(8)}`;

interface World {
  a: { id: string; branchId: string };
  at: { restaurantId: string; branchId: string };
  owner: Person;
  cashier: Person;
  helper: Person;
  manager: Person;
  p: { id: string; tablet: string; strip: string };
}

/** One pharmacy, one branch, one product (tablet 100, strip of 10 tablets 900 IQD) with a barcode on the strip. No shift is open yet. */
async function world(): Promise<World> {
  const a = await pharmacy('A', { branches: 1 });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [a.branchId]] });
  const helper = await person('helper', { staff: [a.id, 'CASHIER', [a.branchId]] });
  const manager = await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [a.branchId]] });
  await prisma().phSettings.create({ data: { restaurantId: a.id } });
  const p = await makeProduct(a.id, 'Panadol');
  for (const [unitId, amountMinor] of [[p.tablet, 100n], [p.strip, 900n]] as const) {
    await prisma().phPrice.create({ data: { restaurantId: a.id, productId: p.id, unitId, branchId: null, currency: 'IQD', amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
  }
  await prisma().phBarcode.create({ data: { restaurantId: a.id, productId: p.id, unitId: p.strip, code: BARCODE } });
  return { a, at: { restaurantId: a.id, branchId: a.branchId }, owner, cashier, helper, manager, p };
}

/** Opens a shift through the real action; returns its id. */
const openShift = async (w: World, who: Person, openingFloatMinor = 0n) =>
  dataOf(await act(who, shiftActions.open, { ...w.at, currency: 'IQD', openingFloatMinor, clientKey: key('open') })).id;

const stock = (w: World, buckets: Record<string, number>, over: { lot?: string; expiry?: string } = {}) =>
  makeBatch(w.a.id, w.a.branchId, w.p.id, { lot: over.lot ?? 'L1', expiry: over.expiry ?? '2028-03-31', buckets });

const cash = (amountMinor: bigint) => ({ method: 'CASH', amountMinor, clientKey: key('pay') });
const sale = (w: World, lines: { unitId: string; qty: number }[], payments: unknown[], over: Record<string, unknown> = {}) => ({
  ...w.at,
  clientKey: key('sale'),
  currency: 'IQD',
  lines: lines.map((l) => ({ productId: w.p.id, ...l })),
  payments,
  ...over,
});

const everything = async () => ({
  sales: await prisma().phSale.count(),
  lines: await prisma().phSaleLine.count(),
  allocations: await prisma().phSaleLineAllocation.count(),
  payments: await prisma().phPayment.count(),
  cashRows: await prisma().phCashMovement.count(),
  stockMovements: await prisma().phStockMovement.count(),
  returns: await prisma().phReturn.count(),
  audit: await prisma().auditLog.count(),
});

describe('phase 3 acceptance', () => {
  it('scan -> sale with change -> printed receipt -> shift report -> close with no variance, all against hand figures', async () => {
    const w = await world();
    const batch = await stock(w, { available: 100 });
    const shiftId = await openShift(w, w.cashier, 5000n);

    // 1. Scan: the barcode string (leading zero kept) finds the strip and its price.
    const found = dataOf(await ask(w.cashier, sellQueries.search, { ...w.at, q: BARCODE }));
    expect(found.items[0]).toMatchObject({ productId: w.p.id, tradeName: 'Panadol', matchedUnitId: w.p.strip, sellableQty: 100 });
    expect(found.items[0]!.units.find((u) => u.id === w.p.strip)).toMatchObject({ priceMinor: '900', noPrice: false });
    expect(dataOf(await ask(w.cashier, sellQueries.search, { ...w.at, q: BARCODE.replace(/^0+/, '') })).items).toHaveLength(0);

    // 2. Sale 1: two strips and three tablets = 2 x 900 + 3 x 100 = 2100, paid 2500 cash, change 400.
    const one = dataOf(await act(w.cashier, saleActions.create, sale(w, [{ unitId: found.items[0]!.matchedUnitId!, qty: 2 }, { unitId: w.p.tablet, qty: 3 }], [cash(2500n)])));
    expect(one).toMatchObject({ status: 'COMPLETED', subtotalMinor: '2100', totalMinor: '2100', paidMinor: '2500', changeMinor: '400', number: '20261027-000001', replayed: false });

    // 3. Sale 2: one strip, 900, split over cash 500 and card 400 (mixed payment, exact, no change).
    const two = dataOf(await act(w.cashier, saleActions.create, sale(w, [{ unitId: w.p.strip, qty: 1 }], [cash(500n), { method: 'CARD_MANUAL', amountMinor: 400n, clientKey: key('pay'), reference: 'C-1' }])));
    expect(two).toMatchObject({ totalMinor: '900', paidMinor: '900', changeMinor: '0', number: '20261027-000002' });

    // 4. Stock: 23 + 10 tablets gone, one SALE movement per allocation.
    expect(await balanceOf(batch, w.a.branchId)).toMatchObject({ available: 67 });
    expect(await prisma().phStockMovement.count({ where: { type: 'SALE' } })).toBe(3);

    // 5. Receipt of sale 1, rendered from the stored sale: number, lines, total, tendered and change on the paper.
    const receipt = dataOf(await ask(w.cashier, printQueries.get, { ...w.at, saleId: one.id, width: '80', locale: 'en' }));
    expect(receipt.html).toContain(one.number!);
    expect(receipt.text).toContain(one.number!);
    expect(receipt.model).toMatchObject({ kind: 'sale', number: one.number, copy: false, currency: 'IQD' });
    expect(receipt.model.lines).toHaveLength(2);
    expect(receipt.text).toMatch(/2,?100/);
    expect(receipt.text).toMatch(/2,?500/);
    expect(receipt.text).toMatch(/400/);
    const slim = dataOf(await ask(w.cashier, printQueries.get, { ...w.at, saleId: one.id, width: '58', locale: 'en' }));
    expect(slim.model.width).toBe('58');
    expect(slim.html).toContain(one.number!);

    // 6. Paid in 300 and paid out 150 on the same shift.
    dataOf(await act(w.cashier, shiftActions.paidIn, { ...w.at, amountMinor: 300n, reason: 'Change from the safe', clientKey: key('in') }));
    dataOf(await act(w.cashier, shiftActions.paidOut, { ...w.at, amountMinor: 150n, reason: 'Courier fee', clientKey: key('out') }));

    // 7. Report, hand figures: float 5000 + cash 2500 + 500 - change 400 + paid in 300 - paid out 150 = 7750 (the 400 by card is not in the drawer).
    const report = dataOf(await ask(w.cashier, shiftQueries.report, { ...w.at, shiftId }));
    expect(report.totals).toMatchObject({
      openingFloatMinor: '5000',
      expectedMinor: '7750',
      salesCount: 2,
      salesTotalMinor: '3000',
      cash: { tenderedMinor: '3000', changeMinor: '400', refundsMinor: '0', paidInMinor: '300', paidOutMinor: '150' },
    });
    expect(report.totals.payments).toEqual([
      { method: 'CARD_MANUAL', count: 1, amountMinor: '400' },
      { method: 'CASH', count: 2, amountMinor: '3000' },
    ]);

    // 8. Close with exactly the expected cash: variance 0, no reason, no approval needed.
    const closed = dataOf(await act(w.cashier, shiftActions.close, { ...w.at, shiftId, countedMinor: 7750n }));
    expect(closed).toMatchObject({ status: 'CLOSED', expectedMinor: '7750', countedMinor: '7750', varianceMinor: '0', approvedById: null });
    expect(await prisma().phShift.findUniqueOrThrow({ where: { id: shiftId } })).toMatchObject({ status: 'CLOSED' });
    // A closed shift sells nothing more.
    expect(codeOf(await act(w.cashier, saleActions.create, sale(w, [{ unitId: w.p.tablet, qty: 1 }], [cash(100n)])))).toBe('CONFLICT');
  });

  it('eight parallel sales of the last unit: exactly one succeeds, the others are refused, stock is 0 and there is one SALE movement', async () => {
    const w = await world();
    const batch = await stock(w, { available: 1 });
    const sellers = [w.cashier, w.helper, w.manager];
    for (const who of sellers) await openShift(w, who);

    const answers = await Promise.all(
      Array.from({ length: 8 }, (_, i) => act(sellers[i % sellers.length]!, saleActions.create, sale(w, [{ unitId: w.p.tablet, qty: 1 }], [cash(100n)]))),
    );
    expect(answers.filter((r) => r.ok)).toHaveLength(1);
    const refused = answers.filter((r) => !r.ok);
    expect(refused).toHaveLength(7);
    expect(refused.map((r) => [codeOf(r), phCodeOf(r)])).toEqual(Array(7).fill(['CONFLICT', 'INSUFFICIENT_STOCK']));

    expect(await balanceOf(batch, w.a.branchId)).toEqual({ available: 0, reserved: 0, quarantine: 0, damaged: 0 });
    expect(await prisma().phStockMovement.count({ where: { type: 'SALE' } })).toBe(1);
    expect(await prisma().phSale.count({ where: { status: 'COMPLETED' } })).toBe(1);
    expect(await prisma().phSale.count()).toBe(1); // a refused sale leaves nothing behind
    expect(await prisma().phPayment.count()).toBe(1);
    expect(await prisma().phCashMovement.count({ where: { type: 'SALE_CASH' } })).toBe(1);
  });

  it('the same sale key sent five times at once: one sale, one payment, one cash movement, one stock movement, the same answer', async () => {
    const w = await world();
    const batch = await stock(w, { available: 50 });
    await openShift(w, w.cashier);
    const body = sale(w, [{ unitId: w.p.strip, qty: 2 }], [cash(2000n)]);

    const answers = await Promise.all(Array.from({ length: 5 }, () => act(w.cashier, saleActions.create, body)));
    const data = answers.map((r) => dataOf(r));
    expect(data.filter((d) => !d.replayed)).toHaveLength(1);
    expect(new Set(data.map((d) => d.id)).size).toBe(1);
    const strip = (d: (typeof data)[number]) => ({ ...d, replayed: null });
    for (const d of data) expect(strip(d)).toEqual(strip(data[0]!));
    expect(data[0]).toMatchObject({ totalMinor: '1800', paidMinor: '2000', changeMinor: '200', number: '20261027-000001' });

    expect(await prisma().phSale.count()).toBe(1);
    expect(await prisma().phPayment.count()).toBe(1);
    expect(await prisma().phCashMovement.count({ where: { type: 'SALE_CASH' } })).toBe(1);
    expect(await prisma().phCashMovement.count({ where: { type: 'CHANGE_OUT' } })).toBe(1);
    expect(await prisma().phStockMovement.count({ where: { type: 'SALE' } })).toBe(1);
    expect(await balanceOf(batch, w.a.branchId)).toMatchObject({ available: 30 });
    // A later resend, after the answer was lost, still returns the stored sale and writes nothing.
    const before = await everything();
    expect(dataOf(await act(w.cashier, saleActions.create, body))).toMatchObject({ id: data[0]!.id, replayed: true });
    expect(await everything()).toEqual(before);
  });

  it('a print failure never cancels a sale: reading the receipt writes nothing, a reprint is logged once per key, the sale stays COMPLETED', async () => {
    const w = await world();
    const batch = await stock(w, { available: 20 });
    const shiftId = await openShift(w, w.cashier);
    const made = dataOf(await act(w.cashier, saleActions.create, sale(w, [{ unitId: w.p.strip, qty: 1 }], [cash(1000n)])));
    const frozen = await everything();
    const row = () => prisma().phSale.findUniqueOrThrow({ where: { id: made.id }, include: { payments: true } });
    const rowBefore = await row();

    // The printer fails: the screen asks for the receipt again, as often as the cashier presses Print. Nothing changes.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const again = dataOf(await ask(w.cashier, printQueries.get, { ...w.at, saleId: made.id, width: '80' }));
      expect(again.model.copy).toBe(false);
    }
    expect(await everything()).toEqual(frozen);
    expect(await prisma().phReceiptReprint.count()).toBe(0);

    // A real reprint (the copy marker) is logged once per key, however often the same key arrives.
    const k = key('rp');
    const first = dataOf(await act(w.cashier, printActions.reprintReceipt, { ...w.at, saleId: made.id, width: '80', clientKey: k }));
    const repeat = dataOf(await act(w.cashier, printActions.reprintReceipt, { ...w.at, saleId: made.id, width: '80', clientKey: k }));
    expect([first.copyNumber, first.replayed, repeat.copyNumber, repeat.replayed]).toEqual([1, false, 1, true]);
    expect(first.model.copy).toBe(true);
    expect(await prisma().phReceiptReprint.count({ where: { saleId: made.id } })).toBe(1);
    const second = dataOf(await act(w.cashier, printActions.reprintReceipt, { ...w.at, saleId: made.id, width: '58', clientKey: key('rp') }));
    expect(second.copyNumber).toBe(2);
    expect(await prisma().phReceiptReprint.count({ where: { saleId: made.id } })).toBe(2);

    // The sale, its payment, its stock and the shift are exactly as before: only the reprint log grew.
    expect(await row()).toEqual(rowBefore);
    expect(rowBefore.status).toBe('COMPLETED');
    expect({ ...(await everything()), audit: 0 }).toEqual({ ...frozen, audit: 0 });
    expect(await balanceOf(batch, w.a.branchId)).toMatchObject({ available: 10 });
    expect(await prisma().phShift.findUniqueOrThrow({ where: { id: shiftId } })).toMatchObject({ status: 'OPEN' });
    expect(dataOf(await ask(w.cashier, saleQueries.get, { ...w.at, saleId: made.id }))).toMatchObject({ status: 'COMPLETED' });
  });

  it('a partial return goes to quarantine, refunds exactly the money, and the stock sells again only after the quarantine release', async () => {
    const w = await world();
    const batch = await stock(w, { available: 10 });
    await openShift(w, w.cashier);
    const managerShift = await openShift(w, w.manager);
    const made = dataOf(await act(w.cashier, saleActions.create, sale(w, [{ unitId: w.p.tablet, qty: 10 }], [cash(1000n)])));
    expect(await balanceOf(batch, w.a.branchId)).toMatchObject({ available: 0 });
    const line = await prisma().phSaleLine.findFirstOrThrow({ where: { saleId: made.id } });

    // A cashier cannot return; the manager can, up to what was sold.
    const body = { ...w.at, saleId: made.id, lines: [{ saleLineId: line.id, baseQty: 4 }], reason: 'Customer changed their mind', refundMethod: 'CASH', clientKey: key('ret') };
    expect(codeOf(await act(w.cashier, returnActions.create, body))).toBe('FORBIDDEN');
    expect(phCodeOf(await act(w.manager, returnActions.create, { ...body, clientKey: key('ret'), lines: [{ saleLineId: line.id, baseQty: 11 }] }))).toBe('RETURN_LIMIT');

    const returned = dataOf(await act(w.manager, returnActions.create, body));
    expect(returned).toMatchObject({ refundMinor: '400', refundMethod: 'CASH', saleStatus: 'RETURNED_PARTIAL', replayed: false });
    // Not sellable: the 4 tablets wait in quarantine.
    expect(await balanceOf(batch, w.a.branchId)).toEqual({ available: 0, reserved: 0, quarantine: 4, damaged: 0 });
    expect(phCodeOf(await act(w.cashier, saleActions.create, sale(w, [{ unitId: w.p.tablet, qty: 1 }], [cash(100n)])))).toBe('INSUFFICIENT_STOCK');
    // The refund is a cash movement on the approver's open shift, and the receipt slip names it.
    expect(await prisma().phCashMovement.findMany({ where: { shiftId: managerShift, type: 'REFUND_CASH' }, select: { amountMinor: true } })).toEqual([{ amountMinor: -400n }]);
    const slip = dataOf(await ask(w.manager, printQueries.returnReceipt, { ...w.at, returnId: returned.id }));
    expect(slip.model).toMatchObject({ kind: 'return', saleNumber: made.number });
    // A resent return key refunds once.
    expect(dataOf(await act(w.manager, returnActions.create, body))).toMatchObject({ id: returned.id, replayed: true });
    expect(await prisma().phReturn.count()).toBe(1);

    // Release from quarantine, then it sells again.
    dataOf(await act(w.manager, stockActions.quarantineRelease, { ...w.at, batchId: batch, decision: 'RESTOCK', baseQty: 4, reason: 'Sealed, in date' }));
    expect(await balanceOf(batch, w.a.branchId)).toMatchObject({ available: 4, quarantine: 0 });
    dataOf(await act(w.cashier, saleActions.create, sale(w, [{ unitId: w.p.tablet, qty: 4 }], [cash(400n)])));
    expect(await balanceOf(batch, w.a.branchId)).toMatchObject({ available: 0 });
  });

  it('FEFO: the earliest expiry sells first and a sale larger than it spills into the next batch; an expired batch is never sold', async () => {
    const w = await world();
    const late = await stock(w, { available: 50 }, { lot: 'LATE', expiry: '2029-01-31' });
    const early = await stock(w, { available: 5 }, { lot: 'EARLY', expiry: '2027-06-30' });
    const expired = await stock(w, { available: 100 }, { lot: 'OLD', expiry: '2026-09-30' });
    await openShift(w, w.cashier);

    dataOf(await act(w.cashier, saleActions.create, sale(w, [{ unitId: w.p.tablet, qty: 8 }], [cash(800n)])));
    expect(await balanceOf(early, w.a.branchId)).toMatchObject({ available: 0 });
    expect(await balanceOf(late, w.a.branchId)).toMatchObject({ available: 47 });
    expect(await balanceOf(expired, w.a.branchId)).toMatchObject({ available: 100 });
    const allocations = await prisma().phSaleLineAllocation.findMany({ orderBy: { baseQty: 'asc' } });
    expect(allocations.map((x) => [x.batchId, x.baseQty])).toEqual([[late, 3], [early, 5]]);
    // Only 47 are sellable; the 100 expired ones do not count.
    expect(phCodeOf(await act(w.cashier, saleActions.create, sale(w, [{ unitId: w.p.tablet, qty: 48 }], [cash(4800n)])))).toBe('INSUFFICIENT_STOCK');
  });

  it('a hold takes no stock and no money; completing it makes one sale and the hold is gone', async () => {
    const w = await world();
    const batch = await stock(w, { available: 10 });
    await openShift(w, w.cashier);
    const held = dataOf(await act(w.cashier, saleActions.hold, { ...w.at, clientKey: key('hold'), currency: 'IQD', lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 4 }] }));
    expect(held).toMatchObject({ status: 'HELD', number: null, totalMinor: '400' });
    expect(await balanceOf(batch, w.a.branchId)).toMatchObject({ available: 10 });
    expect(await prisma().phPayment.count()).toBe(0);

    const done = dataOf(await act(w.cashier, saleActions.create, sale(w, [{ unitId: w.p.tablet, qty: 4 }], [cash(400n)], { fromHoldId: held.id })));
    expect(done).toMatchObject({ status: 'COMPLETED', totalMinor: '400' });
    expect(await prisma().phSale.count({ where: { status: 'HELD' } })).toBe(0);
    expect(await prisma().phSale.count()).toBe(1);
    expect(await balanceOf(batch, w.a.branchId)).toMatchObject({ available: 6 });
    // The hold cannot be used twice.
    expect(codeOf(await act(w.cashier, saleActions.create, sale(w, [{ unitId: w.p.tablet, qty: 4 }], [cash(400n)], { fromHoldId: held.id })))).toBe('CONFLICT');
    expect(await prisma().phSale.count()).toBe(1);
  });

  it('cancelling a sale is a full return into quarantine, once; nothing is deleted', async () => {
    const w = await world();
    const batch = await stock(w, { available: 12 });
    await openShift(w, w.cashier);
    await openShift(w, w.manager);
    const made = dataOf(await act(w.cashier, saleActions.create, sale(w, [{ unitId: w.p.strip, qty: 1 }, { unitId: w.p.tablet, qty: 2 }], [cash(1100n)])));
    expect(made.totalMinor).toBe('1100');
    const cancel = { ...w.at, saleId: made.id, reason: 'Wrong customer', refundMethod: 'CASH', clientKey: key('cancel') };
    expect(codeOf(await act(w.cashier, returnActions.cancel, cancel))).toBe('FORBIDDEN');
    const done = dataOf(await act(w.manager, returnActions.cancel, cancel));
    expect(done).toMatchObject({ refundMinor: '1100', saleStatus: 'RETURNED_FULL' });
    expect(await balanceOf(batch, w.a.branchId)).toEqual({ available: 0, reserved: 0, quarantine: 12, damaged: 0 });
    expect(await prisma().phSale.count()).toBe(1);
    expect(phCodeOf(await act(w.manager, returnActions.cancel, { ...cancel, clientKey: key('cancel') }))).not.toBe('OK');
    expect(await prisma().phReturn.count()).toBe(1);
  });
});
