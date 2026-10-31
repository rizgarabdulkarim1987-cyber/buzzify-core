import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as countActions from '@/server/pharmacy/actions/counts';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import * as stockActions from '@/server/pharmacy/actions/stock';
import * as expiryQueries from '@/server/pharmacy/queries/expiry';
import * as receiptQueries from '@/server/pharmacy/queries/receipts';
import * as stockQueries from '@/server/pharmacy/queries/stock';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask, balanceOf, codeOf, dataOf, makeBatch, makeProduct, phCodeOf } from './stock-helpers';

/**
 * Acceptance of phase 2 (spec section 12, row 2): one scenario per criterion, through the same actions and queries the
 * screens call. The detailed rules live in the per-task files (stock-schema, stock-service, receipts, stock-adjust,
 * stock-counts, stock-expiry); these scenarios are the owner's checklist.
 */

const DAY = 24 * 60 * 60 * 1000;
const dateOnly = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY).toISOString().slice(0, 10);

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld);

let seq = 0;
const key = () => `acceptance-key-${(seq += 1)}`;

async function world() {
  const a = await pharmacy('A', { branches: 2 });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const at = { restaurantId: a.id, branchId: a.branchId };
  return { a, owner, at };
}

type Product = Awaited<ReturnType<typeof makeProduct>>;
const receiptLine = (p: Product, over: Record<string, unknown> = {}) => ({
  productId: p.id,
  unitId: p.strip,
  qty: 5,
  lot: 'LOT-1',
  expiry: '2028-03-15',
  unitCostMinor: 2500n,
  currency: 'IQD',
  ...over,
});
const receive = async (who: Parameters<typeof act>[0], at: { restaurantId: string; branchId: string }, lines: unknown[]) => {
  const made = dataOf(
    await act(who, receiptActions.create, { ...at, clientKey: key(), supplierName: 'Acme', reference: 'INV-1', receivedOn: dateOnly(0), lines }),
  );
  return dataOf(await act(who, receiptActions.confirm, { ...at, receiptId: made.id }));
};

describe('phase 2 acceptance', () => {
  it('no negative stock: the database CHECK refuses even a direct write, and the service refuses first', async () => {
    const { a, owner, at } = await world();
    const p = await makeProduct(a.id);
    const batchId = await makeBatch(a.id, a.branchId, p.id, { buckets: { available: 10 } });
    const movementsBefore = await prisma().phStockMovement.count();

    // The service: asking for more than the bucket holds is refused and writes nothing.
    const over = await act(owner, stockActions.adjust, { ...at, batchId, direction: 'out', bucketFrom: 'available', baseQty: 11, reason: 'Too much', clientKey: key() });
    expect(codeOf(over)).toBe('CONFLICT');
    expect(phCodeOf(over)).toBe('INSUFFICIENT_STOCK');
    expect(await prisma().phStockMovement.count()).toBe(movementsBefore);
    expect(await balanceOf(batchId, at.branchId)).toEqual({ available: 10, reserved: 0, quarantine: 0, damaged: 0 });

    // The database: skipping the service and writing a negative balance directly is refused by the CHECK constraint.
    const row = await prisma().phStockBalance.findFirstOrThrow({ where: { batchId, branchId: at.branchId } });
    await expect(prisma().phStockBalance.update({ where: { id: row.id }, data: { available: { decrement: 11 } } })).rejects.toThrow(/PhStockBalance_available_nonnegative/);
    expect(await balanceOf(batchId, at.branchId)).toMatchObject({ available: 10 });
  });

  it('a correction is a reversing entry (original untouched, reversal row linked, double reversal refused)', async () => {
    const { a, owner, at } = await world();
    const p = await makeProduct(a.id);
    const batchId = await makeBatch(a.id, a.branchId, p.id, { buckets: { available: 100 } });
    const original = dataOf(await act(owner, stockActions.adjust, { ...at, batchId, direction: 'out', bucketFrom: 'available', baseQty: 30, reason: 'Counted wrong', clientKey: key() }));
    const before = await prisma().phStockMovement.findUniqueOrThrow({ where: { id: original.id } });
    expect(await balanceOf(batchId, at.branchId)).toMatchObject({ available: 70 });

    const reversal = dataOf(await act(owner, stockActions.reverse, { ...at, movementId: original.id, reason: 'It was a mistake' }));
    expect(reversal.id).not.toBe(original.id);

    // The original row is exactly as it was; a new row carries the opposite delta and points to it.
    expect(await prisma().phStockMovement.findUniqueOrThrow({ where: { id: original.id } })).toEqual(before);
    expect(await prisma().phStockMovement.findUniqueOrThrow({ where: { id: reversal.id } })).toMatchObject({
      reversesId: original.id,
      batchId,
      availableDelta: 30,
      reason: 'It was a mistake',
    });
    expect(await balanceOf(batchId, at.branchId)).toMatchObject({ available: 100 });

    // A second reversal of the same movement, and a reversal of the reversal, are refused and change nothing.
    const again = await act(owner, stockActions.reverse, { ...at, movementId: original.id, reason: 'Again' });
    expect(codeOf(again)).toBe('CONFLICT');
    expect(phCodeOf(again)).toBe('ALREADY_REVERSED');
    expect(codeOf(await act(owner, stockActions.reverse, { ...at, movementId: reversal.id, reason: 'Undo the undo' }))).toBe('CONFLICT');
    expect(await prisma().phStockMovement.count({ where: { reversesId: { not: null } } })).toBe(1);
    expect(await balanceOf(batchId, at.branchId)).toMatchObject({ available: 100 });
  });

  it('the 90 day expiry alert equals its independent query', async () => {
    const { a, owner, at } = await world();
    const p = await makeProduct(a.id);
    const days: Record<string, number> = { EXPIRED: -3, D10: 10, D90: 90, D91: 91, D400: 400 };
    for (const [lot, offset] of Object.entries(days)) await makeBatch(a.id, a.branchId, p.id, { lot, expiry: dateOnly(offset), buckets: { available: 4 } });
    await makeBatch(a.id, a.branchId, p.id, { lot: 'NO-STOCK', expiry: dateOnly(5), buckets: {} });
    await makeBatch(a.id, a.branchId, p.id, { lot: 'DAMAGED-ONLY', expiry: dateOnly(5), buckets: { damaged: 3 } });
    await makeBatch(a.id, a.branchId, p.id, { lot: 'QUAR', expiry: dateOnly(20), buckets: { quarantine: 2 } });

    // Independent computation: plain rows and plain date arithmetic, no helper from the expiry code.
    const today = Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate());
    const balances = await prisma().phStockBalance.findMany({ where: { restaurantId: a.id }, include: { batch: true } });
    const expected = balances
      .filter((b) => b.available + b.reserved + b.quarantine > 0)
      .filter((b) => (b.batch.expiryDate.getTime() - today) / DAY <= 90)
      .map((b) => b.batch.lot)
      .sort();
    expect(expected).toEqual(['D10', 'D90', 'EXPIRED', 'QUAR']);

    const got = dataOf(await ask(owner, expiryQueries.expiry, { ...at, days: 90 }));
    expect(got.items.map((r) => r.batch.lot).sort()).toEqual(expected);
    expect(got.totals.expired + got.totals.d30 + got.totals.d60 + got.totals.d90).toBe(expected.length);
  });

  it('a count with differences needs a reason and approval, applied once', async () => {
    const { a, owner, at } = await world();
    const pic = await person('pic', { staff: [a.id, 'PHARMACIST_IN_CHARGE', [a.branchId]] });
    const p = await makeProduct(a.id);
    const batchId = await makeBatch(a.id, a.branchId, p.id, { buckets: { available: 10 } });

    const count = dataOf(await act(pic, countActions.open, { ...at, scope: 'BRANCH', blind: true, note: '' }));
    const line = await prisma().phStockCountLine.findFirstOrThrow({ where: { countId: count.id, batchId } });
    dataOf(await act(pic, countActions.record, { ...at, countId: count.id, lines: [{ lineId: line.id, countedQty: 7 }] }));
    dataOf(await act(pic, countActions.submit, { ...at, countId: count.id }));
    // Counting alone moves nothing.
    expect(await balanceOf(batchId, at.branchId)).toMatchObject({ available: 10 });

    // Differences need a reason; the counter may not approve their own count while another approver exists.
    expect(codeOf(await act(owner, countActions.approve, { ...at, countId: count.id }))).toBe('INVALID');
    expect(phCodeOf(await act(pic, countActions.approve, { ...at, countId: count.id, reason: 'Recount found a shortage' }))).toBe('SELF_APPROVAL');
    expect(await balanceOf(batchId, at.branchId)).toMatchObject({ available: 10 });

    const done = dataOf(await act(owner, countActions.approve, { ...at, countId: count.id, reason: 'Recount found a shortage' }));
    expect(done).toMatchObject({ status: 'APPROVED', movements: 1, selfApproved: false });
    expect(await balanceOf(batchId, at.branchId)).toMatchObject({ available: 7 });

    // Applied once: a second approval is refused and adds no movement.
    expect(codeOf(await act(owner, countActions.approve, { ...at, countId: count.id, reason: 'Recount found a shortage' }))).toBe('CONFLICT');
    const applied = await prisma().phStockMovement.findMany({ where: { countId: count.id } });
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ type: 'COUNT', availableDelta: -3, reason: 'Recount found a shortage', userId: owner.userId });
    expect(await balanceOf(batchId, at.branchId)).toMatchObject({ available: 7 });
  });

  it('a receipt of the same lot while a count is open is not counted twice: the final stock is the physical count', async () => {
    const { a, owner, at } = await world();
    const p = await makeProduct(a.id);
    await receive(owner, at, [receiptLine(p)]);
    const batch = await prisma().phBatch.findFirstOrThrow({ where: { productId: p.id, lot: 'LOT-1' } });
    const before = (await balanceOf(batch.id, at.branchId))!.available;

    const count = dataOf(await act(owner, countActions.open, { ...at, scope: 'BRANCH', blind: false, note: '' }));
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    await receive(owner, at, [receiptLine(p, { qty: 2 })]);
    const physical = (await balanceOf(batch.id, at.branchId))!.available;
    expect(physical).toBeGreaterThan(before);

    vi.setSystemTime(new Date(NOW.getTime() + 120_000));
    const line = await prisma().phStockCountLine.findFirstOrThrow({ where: { countId: count.id, batchId: batch.id } });
    dataOf(await act(owner, countActions.record, { ...at, countId: count.id, lines: [{ lineId: line.id, countedQty: physical }] }));
    dataOf(await act(owner, countActions.submit, { ...at, countId: count.id }));
    vi.setSystemTime(new Date(NOW.getTime() + 180_000));
    const done = dataOf(await act(owner, countActions.approve, { ...at, countId: count.id }));
    expect(done.movements).toBe(0);
    expect(await balanceOf(batch.id, at.branchId)).toMatchObject({ available: physical });
    vi.setSystemTime(NOW);
  });

  it('receiving the same lot twice adds to one batch', async () => {
    const { a, owner, at } = await world();
    const p = await makeProduct(a.id);
    await receive(owner, at, [receiptLine(p, { qty: 5 })]); // 5 strips = 50 tablets
    await receive(owner, at, [receiptLine(p, { qty: 2, lot: ' lot-1 ' })]); // same lot, spelled differently

    const batches = await prisma().phBatch.findMany({ where: { restaurantId: a.id, productId: p.id } });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ lot: 'LOT-1' });
    expect(await balanceOf(batches[0]!.id, at.branchId)).toMatchObject({ available: 70 });
    const entries = await prisma().phStockMovement.findMany({ where: { batchId: batches[0]!.id, type: 'RECEIPT' }, orderBy: { createdAt: 'asc' } });
    expect(entries.map((m) => m.availableDelta)).toEqual([50, 20]);
    expect(await prisma().phReceipt.count({ where: { restaurantId: a.id, status: 'CONFIRMED' } })).toBe(2);
  });

  it('movements are append-only', async () => {
    const { a, owner, at } = await world();
    const p = await makeProduct(a.id);
    const batchId = await makeBatch(a.id, a.branchId, p.id, { buckets: { available: 10 } });
    const done = dataOf(await act(owner, stockActions.damage, { ...at, batchId, fromBucket: 'available', baseQty: 2, reason: 'Dropped' }));
    const count = await prisma().phStockMovement.count();

    await expect(prisma().phStockMovement.update({ where: { id: done.id }, data: { reason: 'edited' } })).rejects.toThrow(/append-only/);
    await expect(prisma().phStockMovement.updateMany({ data: { availableDelta: 99 } })).rejects.toThrow(/append-only/);
    await expect(prisma().phStockMovement.delete({ where: { id: done.id } })).rejects.toThrow(/append-only/);
    await expect(prisma().phStockMovement.deleteMany()).rejects.toThrow(/append-only/);
    expect(await prisma().phStockMovement.count()).toBe(count);
    expect(await prisma().phStockMovement.findUniqueOrThrow({ where: { id: done.id } })).toMatchObject({ reason: 'Dropped', damagedDelta: 2 });
  });

  it('cost is never shown without cost.view', async () => {
    const { a, owner, at } = await world();
    const pharmacist = await person('pharmacist', { staff: [a.id, 'PHARMACIST', [a.branchId]] });
    const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [a.branchId]] });
    const p = await makeProduct(a.id);
    const received = await receive(owner, at, [receiptLine(p, { expiry: dateOnly(20) })]);
    const receiptId = (await prisma().phReceipt.findFirstOrThrow({ where: { restaurantId: a.id } })).id;
    expect(received).toBeTruthy();

    const everything = async (who: Parameters<typeof ask>[0]) =>
      JSON.stringify([
        dataOf(await ask(who, stockQueries.balances, at)),
        dataOf(await ask(who, expiryQueries.expiry, at)),
        dataOf(await ask(who, receiptQueries.get, { ...at, receiptId })),
      ]);
    expect(await everything(owner)).toMatch(/2500/);
    for (const who of [pharmacist, cashier]) {
      const text = await everything(who);
      expect(text).toContain('LOT-1'); // they do see the stock itself
      expect(text).not.toMatch(/2500|unitCost|costUnit|currency/i);
    }
  });

  it('end to end: receive two products, see the totals, adjust and damage, release quarantine, count and approve, then the expiry list', async () => {
    const { a, owner, at } = await world();
    const pic = await person('pic', { staff: [a.id, 'PHARMACIST_IN_CHARGE', [a.branchId]] });
    const panadol = await makeProduct(a.id, 'Panadol');
    const brufen = await makeProduct(a.id, 'Brufen');

    // 1. Receive two products; Brufen expires in a month.
    await receive(owner, at, [
      receiptLine(panadol, { qty: 10, lot: 'P-1', expiry: '2028-06-30' }), // 100 tablets
      receiptLine(brufen, { qty: 4, lot: 'B-1', expiry: dateOnly(30) }), // 40 tablets
    ]);

    // 2. The stock overview totals.
    const totals = async () => {
      const res = dataOf(await ask(owner, stockQueries.balances, { ...at, onlyWithStock: true }));
      return Object.fromEntries(res.items.map((i) => [i.tradeName, i.branches.find((b) => b.branchId === a.branchId)]));
    };
    expect(await totals()).toMatchObject({
      Panadol: { available: 100, sellable: 100 },
      Brufen: { available: 40, sellable: 40 },
    });

    // 3. Adjust and damage: lose 5 Panadol, break 2 Brufen.
    const pBatch = (await prisma().phBatch.findFirstOrThrow({ where: { restaurantId: a.id, lot: 'P-1' } })).id;
    const bBatch = (await prisma().phBatch.findFirstOrThrow({ where: { restaurantId: a.id, lot: 'B-1' } })).id;
    dataOf(await act(owner, stockActions.adjust, { ...at, batchId: pBatch, direction: 'out', bucketFrom: 'available', baseQty: 5, reason: 'Lost in the shop', clientKey: key() }));
    dataOf(await act(owner, stockActions.damage, { ...at, batchId: bBatch, fromBucket: 'available', baseQty: 2, reason: 'Dropped box' }));
    expect(await totals()).toMatchObject({ Panadol: { available: 95 }, Brufen: { available: 38, damaged: 2, sellable: 38 } });

    // 4. Quarantine and release: 6 Brufen set aside, 4 go back to sale, 2 are written off as damaged.
    dataOf(await act(owner, stockActions.adjust, { ...at, batchId: bBatch, direction: 'move', bucketFrom: 'available', bucketTo: 'quarantine', baseQty: 6, reason: 'Waiting for inspection', clientKey: key() }));
    expect(await totals()).toMatchObject({ Brufen: { available: 32, quarantine: 6, sellable: 32 } });
    dataOf(await act(owner, stockActions.quarantineRelease, { ...at, batchId: bBatch, decision: 'RESTOCK', baseQty: 4, reason: 'Inspection passed' }));
    dataOf(await act(owner, stockActions.quarantineRelease, { ...at, batchId: bBatch, decision: 'DAMAGE', baseQty: 2, reason: 'Inspection failed' }));
    expect(await totals()).toMatchObject({ Brufen: { available: 36, quarantine: 0, damaged: 4, sellable: 36 } });

    // 5. A blind count by the pharmacist in charge finds 3 fewer Panadol; the owner approves.
    const count = dataOf(await act(pic, countActions.open, { ...at, scope: 'BRANCH', blind: true, note: 'Monthly count' }));
    const lines = await prisma().phStockCountLine.findMany({ where: { countId: count.id } });
    expect(lines.map((l) => l.batchId).sort()).toEqual([pBatch, bBatch].sort());
    dataOf(
      await act(pic, countActions.record, {
        ...at,
        countId: count.id,
        lines: lines.map((l) => ({ lineId: l.id, countedQty: l.batchId === pBatch ? 92 : l.expectedQty })),
      }),
    );
    dataOf(await act(pic, countActions.submit, { ...at, countId: count.id }));
    dataOf(await act(owner, countActions.approve, { ...at, countId: count.id, reason: 'Three boxes missing at the shelf' }));
    expect(await totals()).toMatchObject({ Panadol: { available: 92 }, Brufen: { available: 36 } });
    expect(await prisma().phStockMovement.count({ where: { countId: count.id } })).toBe(1);

    // 6. The expiry list shows the month-expiry Brufen with its current buckets and not the far-dated Panadol.
    const expiry = dataOf(await ask(owner, expiryQueries.expiry, { ...at, days: 90 }));
    expect(expiry.items.map((r) => r.batch.lot)).toEqual(['B-1']);
    expect(expiry.items[0]).toMatchObject({ band: 'd30', daysToExpiry: 30, buckets: { available: 36, reserved: 0, quarantine: 0 } });
    expect(expiry.totals).toEqual({ expired: 0, d30: 1, d60: 0, d90: 0, d180: 0 });

    // The whole story is in the ledger: every change is a row, and the balances are exactly the sum of the rows.
    const ledger = await prisma().phStockMovement.findMany({ where: { restaurantId: a.id } });
    for (const [batchId, available] of [[pBatch, 92], [bBatch, 36]] as const) {
      const sum = ledger.filter((m) => m.batchId === batchId).reduce((total, m) => total + m.availableDelta, 0);
      expect(sum).toBe(available);
    }
  });
});
