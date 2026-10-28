import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { scopedClient } from '@/server/data/tenant-db';
import * as creditActions from '@/server/pharmacy/actions/credit-notes';
import * as returnActions from '@/server/pharmacy/actions/supplier-returns';
import * as payActions from '@/server/pharmacy/actions/supplier-payments';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import * as invoiceActions from '@/server/pharmacy/actions/supplier-invoices';
import * as creditQueries from '@/server/pharmacy/queries/credit-notes';
import * as returnQueries from '@/server/pharmacy/queries/supplier-returns';
import { getCreditNote, listCreditNotes } from '@/server/pharmacy/credit-notes';
import { getSupplierReturn, listSupplierReturns } from '@/server/pharmacy/supplier-returns';
import { DAY, grant, NOW, asPh, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask, balanceOf, codeOf, dataOf, makeBatch, makeProduct, phCodeOf, stockInto } from './stock-helpers';

let keySeq = 0;
const nextKey = (prefix: string) => `${prefix}-${(keySeq += 1)}-aaaa`;
type World = Awaited<ReturnType<typeof world>>;

async function world(label = 'A') {
  const a = await pharmacy(label, { branches: 2 });
  const owner = await person(`owner${label}`, { membership: [a.id, 'OWNER'] });
  const mkSupplier = (name: string, active = true) =>
    prisma().phSupplier.create({
      data: { restaurantId: a.id, name, nameKey: name.toLowerCase(), defaultCurrency: 'IQD', termsDays: 30, active, clientKey: nextKey('sup'), createdById: owner.userId },
      select: { id: true },
    });
  const supplier = await mkSupplier('Al-Noor');
  const supplierB = await mkSupplier('Beta Pharma');
  const archived = await mkSupplier('Old Co', false);
  const p = await makeProduct(a.id, 'Panadol');
  return { a, owner, supplierId: supplier.id, supplierB: supplierB.id, archivedId: archived.id, p };
}

const batchOf = (w: World, branchIndex: 0 | 1, buckets: { available?: number; quarantine?: number }, over: { lot?: string; expiry?: string; status?: 'ACTIVE' | 'RECALLED' | 'BLOCKED'; cost?: bigint } = {}) =>
  makeBatch(w.a.id, w.a.branchIds[branchIndex]!, w.p.id, {
    lot: over.lot ?? nextKey('lot'),
    buckets,
    ...(over.expiry ? { expiry: over.expiry } : {}),
    ...(over.status ? { status: over.status } : {}),
    ...(over.cost !== undefined ? { cost: { unitCostMinor: over.cost, costUnitId: w.p.strip } } : {}),
  });

const line = (batchId: string, bucket: 'AVAILABLE' | 'QUARANTINE', qty: number) => ({ batchId, bucket, qty });
const retBody = (w: World, lines: unknown[], over: Record<string, unknown> = {}) => ({
  restaurantId: w.a.id,
  branchId: w.a.branchIds[0],
  clientKey: nextKey('ret'),
  supplierId: w.supplierId,
  reason: 'Recalled by the supplier',
  lines,
  ...over,
});
const sendBack = (w: World, lines: unknown[], over: Record<string, unknown> = {}) => act(w.owner, returnActions.create, retBody(w, lines, over));

const noteBody = (w: World, over: Record<string, unknown> = {}) => ({
  restaurantId: w.a.id,
  clientKey: nextKey('cn'),
  supplierId: w.supplierId,
  number: nextKey('CN'),
  currency: 'IQD',
  amountMinor: '500000',
  noteDate: '2026-10-26',
  ...over,
});
const record = (w: World, over: Record<string, unknown> = {}) => act(w.owner, creditActions.record, noteBody(w, over));

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

describe('returning stock to a supplier', () => {
  it('takes exactly the named buckets, writes one SUPPLIER_RETURN movement per line with the return as its reference, and numbers the return', async () => {
    const w = await world();
    const b = await batchOf(w, 0, { available: 50, quarantine: 20 }, { cost: 1000n });
    const made = dataOf(await sendBack(w, [line(b, 'AVAILABLE', 30), line(b, 'QUARANTINE', 5)], { note: 'Box 4 and 5' }));
    expect(made).toMatchObject({ number: 'SR-20261027-000001', supplierId: w.supplierId, branchId: w.a.branchIds[0], replayed: false });
    expect(made.lines).toEqual([
      { lineNo: 1, batchId: b, bucket: 'AVAILABLE', qty: 30 },
      { lineNo: 2, batchId: b, bucket: 'QUARANTINE', qty: 5 },
    ]);
    expect(await balanceOf(b, w.a.branchIds[0]!)).toEqual({ available: 20, reserved: 0, quarantine: 15, damaged: 0 });
    const moves = await prisma().phStockMovement.findMany({ where: { type: 'SUPPLIER_RETURN' }, orderBy: { availableDelta: 'asc' } });
    expect(moves.map((m) => [m.availableDelta, m.quarantineDelta, m.refType, m.refId, m.batchId, m.branchId, m.userId, m.reason])).toEqual([
      [-30, 0, 'PhSupplierReturn', made.id, b, w.a.branchIds[0], w.owner.userId, 'Recalled by the supplier'],
      [0, -5, 'PhSupplierReturn', made.id, b, w.a.branchIds[0], w.owner.userId, 'Recalled by the supplier'],
    ]);
    const row = await prisma().phSupplierReturn.findUniqueOrThrow({ where: { id: made.id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    expect(row).toMatchObject({ number: 'SR-20261027-000001', reason: 'Recalled by the supplier', note: 'Box 4 and 5', createdById: w.owner.userId });
    expect(row.lines.map((l) => [l.bucket, l.qty, l.unitCostMinor, l.costCurrency])).toEqual([
      ['AVAILABLE', 30, 1000n, 'IQD'],
      ['QUARANTINE', 5, 1000n, 'IQD'],
    ]);
  });

  it('refuses more than a bucket holds and leaves no trace of the lines before it', async () => {
    const w = await world();
    const b = await batchOf(w, 0, { available: 10, quarantine: 4 });
    const other = await batchOf(w, 0, { available: 7 });
    const before = await balanceOf(b, w.a.branchIds[0]!);
    const movements = await prisma().phStockMovement.count();
    const short = await sendBack(w, [line(other, 'AVAILABLE', 7), line(b, 'AVAILABLE', 10), line(b, 'QUARANTINE', 5)]);
    expect(phCodeOf(short)).toBe('INSUFFICIENT_STOCK');
    expect(await balanceOf(b, w.a.branchIds[0]!)).toEqual(before);
    expect(await balanceOf(other, w.a.branchIds[0]!)).toMatchObject({ available: 7 });
    expect(await prisma().phStockMovement.count()).toBe(movements);
    expect(await prisma().phSupplierReturn.count()).toBe(0);
    expect(await prisma().phSupplierReturnLine.count()).toBe(0);
    expect(await prisma().auditLog.count({ where: { action: 'ph.supplierReturn.create' } })).toBe(0);
    // One more than there is in either bucket, alone: the same refusal, nothing taken.
    expect(phCodeOf(await sendBack(w, [line(b, 'AVAILABLE', 11)]))).toBe('INSUFFICIENT_STOCK');
    expect(phCodeOf(await sendBack(w, [line(b, 'QUARANTINE', 5)]))).toBe('INSUFFICIENT_STOCK');
    expect(await balanceOf(b, w.a.branchIds[0]!)).toEqual(before);
    // Reserved and damaged stock cannot be returned: only the two buckets exist for a line.
    expect(codeOf(await sendBack(w, [line(b, 'DAMAGED' as 'AVAILABLE', 1)]))).toBe('INVALID');
  });

  it('takes back a recalled batch, a blocked batch and an expired one', async () => {
    const w = await world();
    const recalled = await batchOf(w, 0, { available: 5 }, { status: 'RECALLED' });
    const blocked = await batchOf(w, 0, { quarantine: 5 }, { status: 'BLOCKED' });
    const expired = await batchOf(w, 0, { available: 5 }, { expiry: '2026-01-31' });
    const made = dataOf(await sendBack(w, [line(recalled, 'AVAILABLE', 5), line(blocked, 'QUARANTINE', 5), line(expired, 'AVAILABLE', 5)]));
    expect(made.lines).toHaveLength(3);
    expect(await balanceOf(recalled, w.a.branchIds[0]!)).toMatchObject({ available: 0 });
    expect(await balanceOf(blocked, w.a.branchIds[0]!)).toMatchObject({ quarantine: 0 });
    expect(await balanceOf(expired, w.a.branchIds[0]!)).toMatchObject({ available: 0 });
  });

  it('lets only one of two returns of the last units win', async () => {
    const w = await world();
    const b = await batchOf(w, 0, { available: 10 });
    const results = await Promise.all([sendBack(w, [line(b, 'AVAILABLE', 10)]), sendBack(w, [line(b, 'AVAILABLE', 10)])]);
    expect(results.map((r) => phCodeOf(r)).sort()).toEqual(['INSUFFICIENT_STOCK', 'OK']);
    expect(await balanceOf(b, w.a.branchIds[0]!)).toMatchObject({ available: 0 });
    expect(await prisma().phSupplierReturn.count()).toBe(1);
    expect(await prisma().phStockMovement.count({ where: { type: 'SUPPLIER_RETURN' } })).toBe(1);
  });

  it('numbers per branch and per UTC day', async () => {
    const w = await world();
    const b1 = await batchOf(w, 0, { available: 20 });
    const b2 = await batchOf(w, 1, { available: 20 });
    const number = async (r: Promise<Awaited<ReturnType<typeof sendBack>>>) => dataOf(await r).number;
    expect(await number(sendBack(w, [line(b1, 'AVAILABLE', 1)]))).toBe('SR-20261027-000001');
    expect(await number(sendBack(w, [line(b1, 'AVAILABLE', 1)]))).toBe('SR-20261027-000002');
    expect(await number(sendBack(w, [line(b2, 'AVAILABLE', 1)], { branchId: w.a.branchIds[1] }))).toBe('SR-20261027-000001');
    vi.setSystemTime(new Date(NOW.getTime() + DAY));
    expect(await number(sendBack(w, [line(b1, 'AVAILABLE', 1)]))).toBe('SR-20261028-000001');
    expect(await number(sendBack(w, [line(b1, 'AVAILABLE', 1)]))).toBe('SR-20261028-000002');
  });

  it('numbers parallel returns of one branch without a gap or a repeat', async () => {
    const w = await world();
    const b = await batchOf(w, 0, { available: 20 });
    const results = await Promise.all([1, 2, 3, 4].map(() => sendBack(w, [line(b, 'AVAILABLE', 1)])));
    expect(results.map((r) => dataOf(r).number).sort()).toEqual(['SR-20261027-000001', 'SR-20261027-000002', 'SR-20261027-000003', 'SR-20261027-000004']);
  });
});

describe('what a return needs', () => {
  it('validates the reason, the lines and the quantities', async () => {
    const w = await world();
    const b = await batchOf(w, 0, { available: 10 });
    expect(codeOf(await sendBack(w, [line(b, 'AVAILABLE', 1)], { reason: 'ab' }))).toBe('INVALID');
    expect(codeOf(await sendBack(w, [line(b, 'AVAILABLE', 1)], { reason: '   ' }))).toBe('INVALID');
    expect(codeOf(await sendBack(w, [line(b, 'AVAILABLE', 1)], { reason: 'x'.repeat(301) }))).toBe('INVALID');
    expect(codeOf(await sendBack(w, []))).toBe('INVALID');
    expect(codeOf(await sendBack(w, Array.from({ length: 101 }, () => line(b, 'AVAILABLE', 1))))).toBe('INVALID');
    expect(codeOf(await sendBack(w, [line(b, 'AVAILABLE', 0)]))).toBe('INVALID');
    expect(codeOf(await sendBack(w, [line(b, 'AVAILABLE', 1.5)]))).toBe('INVALID');
    expect(codeOf(await sendBack(w, [line(b, 'AVAILABLE', 1)], { clientKey: 'short' }))).toBe('INVALID');
    expect(codeOf(await sendBack(w, [line(b, 'AVAILABLE', 1)], { branchId: undefined }))).toBe('INVALID');
    expect(await prisma().phSupplierReturn.count()).toBe(0);
  });

  it('refuses the same batch and bucket twice with DUPLICATE_LINE, but allows both buckets of one batch', async () => {
    const w = await world();
    const b = await batchOf(w, 0, { available: 10, quarantine: 10 });
    const twice = await sendBack(w, [line(b, 'AVAILABLE', 1), line(b, 'AVAILABLE', 2)]);
    expect(phCodeOf(twice)).toBe('DUPLICATE_LINE');
    expect(await prisma().phSupplierReturn.count()).toBe(0);
    expect(codeOf(await sendBack(w, [line(b, 'AVAILABLE', 1), line(b, 'QUARANTINE', 2)]))).toBe('OK');
  });

  it('needs a live supplier of this business and a batch of this business', async () => {
    const w = await world('A');
    const other = await world('B');
    const b = await batchOf(w, 0, { available: 10 });
    const foreignBatch = await makeBatch(other.a.id, other.a.branchIds[0]!, other.p.id, { lot: 'FB', buckets: { available: 10 } });
    expect(codeOf(await sendBack(w, [line(b, 'AVAILABLE', 1)], { supplierId: other.supplierId }))).toBe('NOT_FOUND');
    expect(codeOf(await sendBack(w, [line(b, 'AVAILABLE', 1)], { supplierId: 'nope' }))).toBe('NOT_FOUND');
    expect(phCodeOf(await sendBack(w, [line(b, 'AVAILABLE', 1)], { supplierId: w.archivedId }))).toBe('SUPPLIER_ARCHIVED');
    expect(codeOf(await sendBack(w, [line('nope', 'AVAILABLE', 1)]))).toBe('NOT_FOUND');
    expect(codeOf(await sendBack(w, [line(foreignBatch, 'AVAILABLE', 1)]))).toBe('NOT_FOUND');
    expect(await balanceOf(foreignBatch, other.a.branchIds[0]!)).toMatchObject({ available: 10 });
    expect(await prisma().phSupplierReturn.count()).toBe(0);
  });

  it('does not check the supplier against the batch: a batch received from another supplier can go back', async () => {
    const w = await world();
    const b = await batchOf(w, 0, { available: 10 });
    expect(codeOf(await sendBack(w, [line(b, 'AVAILABLE', 1)], { supplierId: w.supplierB }))).toBe('OK');
  });
});

describe('replaying a return', () => {
  it('answers the same key and payload with the stored return and takes nothing twice', async () => {
    const w = await world();
    const b = await batchOf(w, 0, { available: 10 });
    const body = retBody(w, [line(b, 'AVAILABLE', 4)]);
    const first = dataOf(await act(w.owner, returnActions.create, body));
    const again = dataOf(await act(w.owner, returnActions.create, body));
    expect(again).toMatchObject({ id: first.id, number: first.number, replayed: true });
    expect(again.lines).toEqual(first.lines);
    expect(await prisma().phSupplierReturn.count()).toBe(1);
    expect(await prisma().phStockMovement.count({ where: { type: 'SUPPLIER_RETURN' } })).toBe(1);
    expect(await balanceOf(b, w.a.branchIds[0]!)).toMatchObject({ available: 6 });
    expect(await prisma().auditLog.count({ where: { action: 'ph.supplierReturn.create' } })).toBe(1);
  });

  it('refuses the same key with another payload, another branch or another person', async () => {
    const w = await world();
    const b = await batchOf(w, 0, { available: 10 });
    const b2 = await batchOf(w, 1, { available: 10 });
    const body = retBody(w, [line(b, 'AVAILABLE', 4)]);
    dataOf(await act(w.owner, returnActions.create, body));
    expect(phCodeOf(await act(w.owner, returnActions.create, { ...body, lines: [line(b, 'AVAILABLE', 5)] }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.owner, returnActions.create, { ...body, reason: 'Another reason' }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.owner, returnActions.create, { ...body, supplierId: w.supplierB }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.owner, returnActions.create, { ...body, branchId: w.a.branchIds[1], lines: [line(b2, 'AVAILABLE', 4)] }))).toBe('CLIENT_KEY_MISMATCH');
    const manager = await person('manager', { staff: [w.a.id, 'BRANCH_MANAGER', [w.a.branchIds[0]!]] });
    expect(phCodeOf(await act(manager, returnActions.create, body))).toBe('CLIENT_KEY_MISMATCH');
    expect(await prisma().phSupplierReturn.count()).toBe(1);
    expect(await balanceOf(b, w.a.branchIds[0]!)).toMatchObject({ available: 6 });
  });

  it('keeps one return when two requests with one key arrive together', async () => {
    const w = await world();
    const b = await batchOf(w, 0, { available: 10, quarantine: 2 });
    const body = retBody(w, [line(b, 'AVAILABLE', 3), line(b, 'QUARANTINE', 1)]);
    const results = await Promise.all([act(w.owner, returnActions.create, body), act(w.owner, returnActions.create, body)]);
    const ok = results.map((r) => dataOf(r));
    expect(ok[0]!.id).toBe(ok[1]!.id);
    expect(ok.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(await prisma().phSupplierReturn.count()).toBe(1);
    expect(await prisma().phStockMovement.count({ where: { type: 'SUPPLIER_RETURN' } })).toBe(2);
    expect(await balanceOf(b, w.a.branchIds[0]!)).toMatchObject({ available: 7, quarantine: 1 });
  });
});

describe('who may return stock and who may read returns', () => {
  it('lets OWNER, BRANCH_MANAGER and PHARMACIST_IN_CHARGE return; refuses STOCK, ACCOUNTANT, PHARMACIST, CASHIER and a support grant', async () => {
    const w = await world();
    const b = await batchOf(w, 0, { available: 50 });
    const mk = (role: 'STOCK' | 'ACCOUNTANT' | 'BRANCH_MANAGER' | 'PHARMACIST_IN_CHARGE' | 'PHARMACIST' | 'CASHIER') =>
      person(role.toLowerCase(), { staff: [w.a.id, role, [w.a.branchIds[0]!]] });
    const refused = new Map<string, Awaited<ReturnType<typeof mk>>>();
    for (const role of ['STOCK', 'ACCOUNTANT', 'PHARMACIST', 'CASHIER'] as const) {
      const who = await mk(role);
      refused.set(role, who);
      expect(codeOf(await act(who, returnActions.create, retBody(w, [line(b, 'AVAILABLE', 1)]))), `${role} returns`).toBe('FORBIDDEN');
    }
    expect(await prisma().phSupplierReturn.count()).toBe(0);
    expect(await balanceOf(b, w.a.branchIds[0]!)).toMatchObject({ available: 50 });

    for (const role of ['BRANCH_MANAGER', 'PHARMACIST_IN_CHARGE'] as const) {
      const who = await mk(role);
      expect(codeOf(await act(who, returnActions.create, retBody(w, [line(b, 'AVAILABLE', 1)]))), `${role} returns`).toBe('OK');
    }
    const made = dataOf(await sendBack(w, [line(b, 'AVAILABLE', 1)]));

    // Reading needs purchase.manage only: a stock clerk and an accountant read, a pharmacist and a cashier do not.
    for (const role of ['STOCK', 'ACCOUNTANT'] as const) {
      const who = refused.get(role)!;
      expect(codeOf(await ask(who, returnQueries.list, { restaurantId: w.a.id })), `${role} lists`).toBe('OK');
      expect(codeOf(await ask(who, returnQueries.get, { restaurantId: w.a.id, returnId: made.id })), `${role} reads`).toBe('OK');
    }
    for (const role of ['PHARMACIST', 'CASHIER'] as const) {
      const who = refused.get(role)!;
      expect(codeOf(await ask(who, returnQueries.list, { restaurantId: w.a.id })), `${role} lists`).toBe('FORBIDDEN');
      expect(codeOf(await ask(who, returnQueries.get, { restaurantId: w.a.id, returnId: made.id })), `${role} reads`).toBe('FORBIDDEN');
    }

    const admin = await person('support', { superAdmin: true });
    await grant(admin, w.a.id, { scopes: ['catalog.read', 'stock.read'] });
    expect(codeOf(await act(admin, returnActions.create, retBody(w, [line(b, 'AVAILABLE', 1)])))).toBe('FORBIDDEN');
    expect(codeOf(await ask(admin, returnQueries.list, { restaurantId: w.a.id }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(admin, returnQueries.get, { restaurantId: w.a.id, returnId: made.id }))).toBe('FORBIDDEN');
    expect(await prisma().phSupplierReturn.count()).toBe(3);
  });
});

describe('branches and businesses', () => {
  it('lets a branch-1 person return branch-1 stock only, and never touches branch 2 stock', async () => {
    const w = await world();
    const b = await batchOf(w, 1, { available: 10 });
    const manager = await person('manager1', { staff: [w.a.id, 'BRANCH_MANAGER', [w.a.branchIds[0]!]] });
    // The batch is the business's, but this branch holds none of it.
    expect(phCodeOf(await act(manager, returnActions.create, retBody(w, [line(b, 'AVAILABLE', 1)])))).toBe('INSUFFICIENT_STOCK');
    // Naming branch 2 as the place is refused outright.
    expect(codeOf(await act(manager, returnActions.create, retBody(w, [line(b, 'AVAILABLE', 1)], { branchId: w.a.branchIds[1] })))).toBe('FORBIDDEN');
    expect(await balanceOf(b, w.a.branchIds[1]!)).toMatchObject({ available: 10 });
    expect(await prisma().phSupplierReturn.count()).toBe(0);
  });

  it('takes from the returning branch only when the batch is held in both branches', async () => {
    const w = await world();
    const b = await batchOf(w, 0, { available: 10, quarantine: 4 });
    await stockInto(w.a.id, w.a.branchIds[1]!, b, { available: 7, quarantine: 3 });
    const made = dataOf(await sendBack(w, [line(b, 'AVAILABLE', 6), line(b, 'QUARANTINE', 4)]));
    expect(await balanceOf(b, w.a.branchIds[0]!)).toMatchObject({ available: 4, quarantine: 0 });
    expect(await balanceOf(b, w.a.branchIds[1]!)).toMatchObject({ available: 7, quarantine: 3 });
    const moves = await prisma().phStockMovement.findMany({ where: { refType: 'PhSupplierReturn', refId: made.id } });
    expect(moves.map((m) => m.branchId)).toEqual([w.a.branchIds[0], w.a.branchIds[0]]);
    // Branch 1 holds 4 now, though branch 2 holds 7: a return from branch 1 cannot reach into it.
    expect(phCodeOf(await sendBack(w, [line(b, 'AVAILABLE', 5)]))).toBe('INSUFFICIENT_STOCK');
    expect(await balanceOf(b, w.a.branchIds[1]!)).toMatchObject({ available: 7, quarantine: 3 });
  });

  it('keeps a return of branch 2 out of branch 1 lists and reads, and shows the owner both', async () => {
    const w = await world();
    const b1 = await batchOf(w, 0, { available: 10 });
    const b2 = await batchOf(w, 1, { available: 10 });
    const r1 = dataOf(await sendBack(w, [line(b1, 'AVAILABLE', 1)]));
    const r2 = dataOf(await sendBack(w, [line(b2, 'AVAILABLE', 1)], { branchId: w.a.branchIds[1] }));
    const manager = await person('manager1', { staff: [w.a.id, 'BRANCH_MANAGER', [w.a.branchIds[0]!]] });
    const seen = dataOf(await ask(manager, returnQueries.list, { restaurantId: w.a.id }));
    expect(seen.items.map((x) => x.id)).toEqual([r1.id]);
    expect(codeOf(await ask(manager, returnQueries.get, { restaurantId: w.a.id, returnId: r2.id }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(manager, returnQueries.get, { restaurantId: w.a.id, returnId: r1.id }))).toBe('OK');
    const all = dataOf(await ask(w.owner, returnQueries.list, { restaurantId: w.a.id }));
    expect(all.items.map((x) => x.id).sort()).toEqual([r1.id, r2.id].sort());
    // A filter by supplier, and by day (created times are the database's own clock: put them on the test's day).
    const other = dataOf(await sendBack(w, [line(b1, 'AVAILABLE', 1)], { supplierId: w.supplierB }));
    expect(dataOf(await ask(w.owner, returnQueries.list, { restaurantId: w.a.id, supplierId: w.supplierB })).items.map((x) => x.id)).toEqual([other.id]);
    await prisma().phSupplierReturn.updateMany({ data: { createdAt: NOW } });
    expect(dataOf(await ask(w.owner, returnQueries.list, { restaurantId: w.a.id, from: '2026-10-28' })).items).toEqual([]);
    expect(dataOf(await ask(w.owner, returnQueries.list, { restaurantId: w.a.id, from: '2026-10-27', to: '2026-10-27' })).items).toHaveLength(3);
  });

  it('leaves another business untouched and treats its ids as not found, both ways', async () => {
    const w = await world('A');
    const o = await world('B');
    const theirs = await makeBatch(o.a.id, o.a.branchIds[0]!, o.p.id, { lot: 'TH', buckets: { available: 10 } });
    const theirReturn = dataOf(await act(o.owner, returnActions.create, retBody(o, [line(theirs, 'AVAILABLE', 1)])));
    const theirNote = dataOf(await act(o.owner, creditActions.record, noteBody(o)));
    const mine = await batchOf(w, 0, { available: 10 });
    expect(codeOf(await act(w.owner, returnActions.create, { ...retBody(o, [line(theirs, 'AVAILABLE', 1)]), restaurantId: w.a.id, branchId: w.a.branchIds[0] }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.owner, returnActions.create, retBody(o, [line(mine, 'AVAILABLE', 1)])))).toBe('FORBIDDEN');
    expect(codeOf(await ask(w.owner, returnQueries.get, { restaurantId: w.a.id, returnId: theirReturn.id }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(w.owner, creditQueries.get, { restaurantId: w.a.id, creditNoteId: theirNote.id }))).toBe('NOT_FOUND');
    expect(codeOf(await record(w, { supplierId: o.supplierId }))).toBe('NOT_FOUND');
    expect(codeOf(await record(w, { supplierReturnId: theirReturn.id }))).toBe('NOT_FOUND');
    expect(await balanceOf(theirs, o.a.branchIds[0]!)).toMatchObject({ available: 9 });
    expect(await prisma().phSupplierReturn.count({ where: { restaurantId: o.a.id } })).toBe(1);
    expect(await prisma().phCreditNote.count({ where: { restaurantId: o.a.id } })).toBe(1);
    expect(dataOf(await ask(w.owner, returnQueries.list, { restaurantId: w.a.id })).items).toEqual([]);
    expect(dataOf(await ask(w.owner, creditQueries.list, { restaurantId: w.a.id })).items).toEqual([]);
  });
});

describe('the cost of a return', () => {
  it('copies the batch cost onto the line only when the batch has one, and values the return by the sales rule', async () => {
    const w = await world();
    // 1000 per strip (10 tablets): 25 tablets are floor(1000 x 25 / 10) = 2500. 333 per strip: 7 tablets are floor(333 x 7 / 10) = 233.
    const a = await batchOf(w, 0, { available: 40 }, { cost: 1000n });
    const b = await batchOf(w, 0, { available: 40 }, { cost: 333n });
    const bare = await batchOf(w, 0, { available: 40 });
    const usd = await batchOf(w, 0, { available: 40 }, { cost: 100n });
    await prisma().phBatch.update({ where: { id: usd }, data: { costCurrency: 'USD' } });
    const made = dataOf(await sendBack(w, [line(a, 'AVAILABLE', 25), line(b, 'AVAILABLE', 7), line(bare, 'AVAILABLE', 9), line(usd, 'AVAILABLE', 3)]));
    const rows = await prisma().phSupplierReturnLine.findMany({ where: { returnId: made.id }, orderBy: { lineNo: 'asc' } });
    expect(rows.map((r) => [r.unitCostMinor, r.costCurrency])).toEqual([[1000n, 'IQD'], [333n, 'IQD'], [null, null], [100n, 'USD']]);
    const read = dataOf(await ask(w.owner, returnQueries.get, { restaurantId: w.a.id, returnId: made.id }));
    // 2500 + 233 = 2733 IQD; floor(100 x 3 / 10) = 30 USD; the batch with no cost adds nothing.
    // The batch with no cost makes the value a floor, and the payload says so.
    expect(read.returnValue).toEqual({ IQD: '2733', USD: '30', incomplete: true });
    expect(read.lines.map((l) => [l.qty, l.unitCostMinor ?? null, l.costCurrency ?? null])).toEqual([[25, '1000', 'IQD'], [7, '333', 'IQD'], [9, null, null], [3, '100', 'USD']]);
    expect(read.lines[0]).toMatchObject({ productName: 'Panadol', bucket: 'AVAILABLE', expiryDate: '2028-03-31', batchId: a });
    const listed = dataOf(await ask(w.owner, returnQueries.list, { restaurantId: w.a.id }));
    expect(listed.items[0]).toMatchObject({ id: made.id, number: made.number, supplierName: 'Al-Noor', lineCount: 4, returnValue: { IQD: '2733', USD: '30', incomplete: true } });
  });

  it('marks the value incomplete only when a returned line has no cost', async () => {
    const w = await world();
    const costed = await batchOf(w, 0, { available: 40 }, { cost: 1000n });
    const bare = await batchOf(w, 0, { available: 40 });
    const whole = dataOf(await sendBack(w, [line(costed, 'AVAILABLE', 10)]));
    const partial = dataOf(await sendBack(w, [line(costed, 'AVAILABLE', 10), line(bare, 'AVAILABLE', 1)]));
    const onlyBare = dataOf(await sendBack(w, [line(bare, 'AVAILABLE', 2)]));
    const value = async (id: string) => dataOf(await ask(w.owner, returnQueries.get, { restaurantId: w.a.id, returnId: id })).returnValue;
    expect(await value(whole.id)).toEqual({ IQD: '1000' });
    expect(await value(partial.id)).toEqual({ IQD: '1000', incomplete: true });
    expect(await value(onlyBare.id)).toEqual({ incomplete: true });
    const listed = dataOf(await ask(w.owner, returnQueries.list, { restaurantId: w.a.id }));
    expect(Object.fromEntries(listed.items.map((i) => [i.id, i.returnValue]))).toEqual({
      [whole.id]: { IQD: '1000' },
      [partial.id]: { IQD: '1000', incomplete: true },
      [onlyBare.id]: { incomplete: true },
    });
  });

  it('shows no cost, no value and no money to a role without cost.view', async () => {
    const w = await world();
    const b = await batchOf(w, 0, { available: 40 }, { cost: 1000n });
    const made = dataOf(await sendBack(w, [line(b, 'AVAILABLE', 25)]));
    await dataOf(await record(w, { supplierReturnId: made.id, amountMinor: '777000' }));
    const clerk = await person('pharmacist', { staff: [w.a.id, 'PHARMACIST', [w.a.branchIds[0]!]] });
    const ph = (await asPh(clerk.userId, w.a.id, w.a.branchIds[0]))!;
    expect(ph.role).toBe('PHARMACIST');
    const scoped = scopedClient(prisma(), { restaurantId: w.a.id, branchIds: ph.branchIds });
    const text = JSON.stringify([await getSupplierReturn(scoped, ph, made.id), await listSupplierReturns(scoped, ph, {}), await listCreditNotes(scoped, ph, {})]);
    expect(text).toContain(made.id);
    expect(text).not.toMatch(/unitCostMinor|costCurrency|returnValue|amountMinor|appliedMinor|availableMinor/);
    expect(text).not.toContain('2500');
    expect(text).not.toContain('777000');
  });

  it('writes an audit row of ids, quantities, buckets and counts, never the reason or the note', async () => {
    const w = await world();
    const b = await batchOf(w, 0, { available: 40, quarantine: 4 }, { cost: 1000n });
    const made = dataOf(await sendBack(w, [line(b, 'AVAILABLE', 25), line(b, 'QUARANTINE', 2)], { reason: 'SECRET-REASON patient 0770', note: 'SECRET-NOTE call Ali' }));
    const rows = await prisma().auditLog.findMany({ where: { action: 'ph.supplierReturn.create' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: 'PhSupplierReturn', entityId: made.id, restaurantId: w.a.id });
    const text = JSON.stringify(rows[0]!.changes);
    expect(text).toContain(w.supplierId);
    expect(text).toContain(w.a.branchIds[0]!);
    expect(text).toContain('SR-20261027-000001');
    expect(text).not.toMatch(/SECRET|0770|Ali|Recalled/);
  });
});

describe('recording a credit note', () => {
  it('stores the note with its number normalised, nothing applied and everything available', async () => {
    const w = await world();
    const made = dataOf(await record(w, { number: '  cn ٠٠٧/a ', note: 'For batch L7' }));
    expect(made).toMatchObject({ number: 'CN 007/A', supplierId: w.supplierId, currency: 'IQD', amountMinor: '500000', appliedMinor: '0', availableMinor: '500000', noteDate: '2026-10-26', supplierReturnId: null, replayed: false });
    const row = await prisma().phCreditNote.findUniqueOrThrow({ where: { id: made.id } });
    expect(row).toMatchObject({ number: 'CN 007/A', amountMinor: 500_000n, appliedMinor: 0n, note: 'For batch L7', createdById: w.owner.userId, supplierReturnId: null });
    expect(row.noteDate.toISOString().slice(0, 10)).toBe('2026-10-26');
  });

  it('refuses a number that is already the supplier\'s, whatever the spacing and digits, and names the existing note', async () => {
    const w = await world();
    const first = dataOf(await record(w, { number: 'CN-77 A' }));
    for (const again of ['cn-77  a', ' CN-٧٧ A ', 'Cn-۷۷ a']) {
      const refused = await record(w, { number: again });
      expect(phCodeOf(refused), again).toBe('DUPLICATE_CREDIT_NOTE');
      expect(refused.ok ? null : refused.error.fields?.existingCreditNoteId, again).toBe(first.id);
    }
    expect(await prisma().phCreditNote.count()).toBe(1);
    // Another supplier may use the same number.
    expect(codeOf(await record(w, { number: 'CN-77 A', supplierId: w.supplierB }))).toBe('OK');
    expect(await prisma().phCreditNote.count()).toBe(2);
  });

  it('validates the number, the amount, the currency and the date', async () => {
    const w = await world();
    expect(codeOf(await record(w, { number: '   ' }))).toBe('INVALID');
    expect(codeOf(await record(w, { number: 'x'.repeat(61) }))).toBe('INVALID');
    expect(codeOf(await record(w, { amountMinor: '0' }))).toBe('INVALID');
    expect(codeOf(await record(w, { amountMinor: '-5' }))).toBe('INVALID');
    expect(codeOf(await record(w, { amountMinor: '1.5' }))).toBe('INVALID');
    expect(codeOf(await record(w, { currency: 'EUR' }))).toBe('INVALID');
    expect(codeOf(await record(w, { noteDate: '2026-02-30' }))).toBe('INVALID');
    expect(codeOf(await record(w, { noteDate: '2026-11-05' }))).toBe('INVALID');
    expect(codeOf(await record(w, { clientKey: 'short' }))).toBe('INVALID');
    expect(codeOf(await record(w, { supplierId: 'nope' }))).toBe('NOT_FOUND');
    expect(await prisma().phCreditNote.count()).toBe(0);
  });

  it('accepts a note from an archived supplier', async () => {
    const w = await world();
    expect(codeOf(await record(w, { supplierId: w.archivedId }))).toBe('OK');
  });

  it('links a note to a return of the same supplier, several notes to one return, and refuses another supplier\'s return', async () => {
    const w = await world();
    const b = await batchOf(w, 0, { available: 10 });
    const ret = dataOf(await sendBack(w, [line(b, 'AVAILABLE', 2)]));
    const one = dataOf(await record(w, { supplierReturnId: ret.id }));
    const two = dataOf(await record(w, { supplierReturnId: ret.id, amountMinor: '100' }));
    expect(one.supplierReturnId).toBe(ret.id);
    expect(two.supplierReturnId).toBe(ret.id);
    expect(phCodeOf(await record(w, { supplierId: w.supplierB, supplierReturnId: ret.id }))).toBe('SUPPLIER_MISMATCH');
    expect(codeOf(await record(w, { supplierReturnId: 'nope' }))).toBe('NOT_FOUND');
    expect(await prisma().phCreditNote.count()).toBe(2);
    const read = dataOf(await ask(w.owner, returnQueries.get, { restaurantId: w.a.id, returnId: ret.id }));
    expect(read.creditNotes.map((n) => n.id).sort()).toEqual([one.id, two.id].sort());
    expect(read.creditNotes.find((n) => n.id === two.id)).toMatchObject({ currency: 'IQD', amountMinor: '100' });
    // A branch-1-only person cannot link a note to a return of branch 2: it is not theirs to see.
    const b2 = await batchOf(w, 1, { available: 5 });
    const ret2 = dataOf(await sendBack(w, [line(b2, 'AVAILABLE', 1)], { branchId: w.a.branchIds[1] }));
    const accountant = await person('accountant1', { staff: [w.a.id, 'ACCOUNTANT', [w.a.branchIds[0]!]] });
    expect(codeOf(await act(accountant, creditActions.record, noteBody(w, { supplierReturnId: ret2.id })))).toBe('NOT_FOUND');
  });

  it('answers a repeat with the stored note, refuses a changed payload and keeps one row under a race', async () => {
    const w = await world();
    const body = noteBody(w);
    const first = dataOf(await act(w.owner, creditActions.record, body));
    const again = dataOf(await act(w.owner, creditActions.record, body));
    expect(again).toMatchObject({ id: first.id, number: first.number, replayed: true });
    expect(phCodeOf(await act(w.owner, creditActions.record, { ...body, amountMinor: '500001' }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.owner, creditActions.record, { ...body, currency: 'USD' }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.owner, creditActions.record, { ...body, noteDate: '2026-10-25' }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.owner, creditActions.record, { ...body, number: nextKey('CN') }))).toBe('CLIENT_KEY_MISMATCH');
    const manager = await person('manager', { staff: [w.a.id, 'BRANCH_MANAGER', [w.a.branchIds[0]!]] });
    expect(phCodeOf(await act(manager, creditActions.record, body))).toBe('CLIENT_KEY_MISMATCH');
    expect(await prisma().phCreditNote.count()).toBe(1);
    const race = noteBody(w);
    const results = await Promise.all([act(w.owner, creditActions.record, race), act(w.owner, creditActions.record, race)]);
    expect(dataOf(results[0]!).id).toBe(dataOf(results[1]!).id);
    expect(await prisma().phCreditNote.count()).toBe(2);
    expect(await prisma().auditLog.count({ where: { action: 'ph.credit.record' } })).toBe(2);
  });

  it('answers a repeat with the totals it stored, not the ones the note has now', async () => {
    const w = await world();
    const body = noteBody(w, { amountMinor: '500000' });
    const first = dataOf(await act(w.owner, creditActions.record, body));
    expect(first).toMatchObject({ appliedMinor: '0', availableMinor: '500000', replayed: false });
    await prisma().phCreditNote.update({ where: { id: first.id }, data: { appliedMinor: 200_000n } });
    const again = dataOf(await act(w.owner, creditActions.record, body));
    expect(again).toMatchObject({ id: first.id, appliedMinor: '0', availableMinor: '500000', amountMinor: '500000', replayed: true });
    // The note itself carries the new figure.
    expect(dataOf(await ask(w.owner, creditQueries.get, { restaurantId: w.a.id, creditNoteId: first.id }))).toMatchObject({ appliedMinor: '200000', availableMinor: '300000' });
  });

  it('lets two different keys race for one number: one wins and the other is told which note has it', async () => {
    const w = await world();
    const results = await Promise.all([record(w, { number: 'RACE-1' }), record(w, { number: 'race-1' })]);
    expect(results.map((r) => phCodeOf(r)).sort()).toEqual(['DUPLICATE_CREDIT_NOTE', 'OK']);
    expect(await prisma().phCreditNote.count()).toBe(1);
  });

  it('lets OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE and ACCOUNTANT record; refuses STOCK, PHARMACIST, CASHIER and support', async () => {
    const w = await world();
    const mk = (role: 'STOCK' | 'ACCOUNTANT' | 'BRANCH_MANAGER' | 'PHARMACIST_IN_CHARGE' | 'PHARMACIST' | 'CASHIER') =>
      person(role.toLowerCase(), { staff: [w.a.id, role, [w.a.branchIds[0]!]] });
    for (const role of ['STOCK', 'PHARMACIST', 'CASHIER'] as const) {
      expect(codeOf(await act(await mk(role), creditActions.record, noteBody(w))), `${role} records`).toBe('FORBIDDEN');
    }
    for (const role of ['ACCOUNTANT', 'BRANCH_MANAGER', 'PHARMACIST_IN_CHARGE'] as const) {
      expect(codeOf(await act(await mk(role), creditActions.record, noteBody(w))), `${role} records`).toBe('OK');
    }
    const admin = await person('support', { superAdmin: true });
    await grant(admin, w.a.id, { scopes: ['catalog.read', 'stock.read'] });
    expect(codeOf(await act(admin, creditActions.record, noteBody(w)))).toBe('FORBIDDEN');
    expect(codeOf(await ask(admin, creditQueries.list, { restaurantId: w.a.id }))).toBe('FORBIDDEN');
    expect(await prisma().phCreditNote.count()).toBe(3);
  });

  it('audits ids, currency, amount and date, never the note or the number text', async () => {
    const w = await world();
    const made = dataOf(await record(w, { number: 'SECRET-CN-9', note: 'SECRET-NOTE phone 0771' }));
    const rows = await prisma().auditLog.findMany({ where: { action: 'ph.credit.record' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: 'PhCreditNote', entityId: made.id });
    const text = JSON.stringify(rows[0]!.changes);
    expect(text).toContain(w.supplierId);
    expect(text).toContain('500000');
    expect(text).not.toMatch(/SECRET|0771/);
  });
});

describe('reading credit notes', () => {
  async function invoice(w: World, total: number): Promise<string> {
    const made = dataOf(
      await act(w.owner, receiptActions.create, {
        restaurantId: w.a.id,
        branchId: w.a.branchIds[0],
        clientKey: nextKey('rcpt'),
        supplierId: w.supplierId,
        supplierName: '',
        reference: 'GRN',
        receivedOn: '2026-10-20',
        lines: [{ productId: w.p.id, unitId: w.p.strip, qty: 1, lot: nextKey('lot'), expiry: '2028-03-15', unitCostMinor: String(total), currency: 'IQD' }],
      }),
    );
    dataOf(await act(w.owner, receiptActions.confirm, { restaurantId: w.a.id, branchId: w.a.branchIds[0], receiptId: made.id }));
    const rcptLine = await prisma().phReceiptLine.findFirstOrThrow({ where: { receiptId: made.id }, select: { id: true } });
    return dataOf(
      await act(w.owner, invoiceActions.create, {
        restaurantId: w.a.id,
        clientKey: nextKey('inv'),
        supplierId: w.supplierId,
        number: 'INV-' + keySeq,
        invoiceDate: '2026-10-21',
        dueDate: '2026-11-20',
        currency: 'IQD',
        lines: [{ receiptLineId: rcptLine.id, qtyInvoiced: 1, unitCostMinor: String(total) }],
      }),
    ).id;
  }

  it('keeps available consistent when the note is applied to an invoice, and lists the allocations with invoice numbers', async () => {
    const w = await world();
    const inv = await invoice(w, 1_000_000);
    const note = dataOf(await record(w, { amountMinor: '600000' }));
    const spent = dataOf(await act(w.owner, payActions.applyCreditNote, { restaurantId: w.a.id, clientKey: nextKey('cr'), creditNoteId: note.id, allocations: [{ invoiceId: inv, amountMinor: '250000' }] }));
    expect(spent.appliedMinor).toBe('250000');
    const read = dataOf(await ask(w.owner, creditQueries.get, { restaurantId: w.a.id, creditNoteId: note.id }));
    expect(read).toMatchObject({ id: note.id, number: note.number, supplierId: w.supplierId, supplierName: 'Al-Noor', currency: 'IQD', amountMinor: '600000', appliedMinor: '250000', availableMinor: '350000', noteDate: '2026-10-26' });
    const invoiceNumber = (await prisma().phSupplierInvoice.findUniqueOrThrow({ where: { id: inv } })).number;
    expect(read.allocations).toEqual([{ invoiceId: inv, invoiceNumber, amountMinor: '250000' }]);
  });

  it('lists notes of a supplier, open ones only when asked, newest first', async () => {
    const w = await world();
    const inv = await invoice(w, 1_000_000);
    const spentNote = dataOf(await record(w, { amountMinor: '300000' }));
    const openNote = dataOf(await record(w, { amountMinor: '200000' }));
    const otherSupplier = dataOf(await record(w, { supplierId: w.supplierB, amountMinor: '100' }));
    dataOf(await act(w.owner, payActions.applyCreditNote, { restaurantId: w.a.id, clientKey: nextKey('cr'), creditNoteId: spentNote.id, allocations: [{ invoiceId: inv, amountMinor: '300000' }] }));
    const all = dataOf(await ask(w.owner, creditQueries.list, { restaurantId: w.a.id }));
    expect(all.items.map((n) => n.id)).toEqual([otherSupplier.id, openNote.id, spentNote.id]);
    expect(all.items.find((n) => n.id === spentNote.id)).toMatchObject({ amountMinor: '300000', appliedMinor: '300000', availableMinor: '0', supplierName: 'Al-Noor' });
    expect(dataOf(await ask(w.owner, creditQueries.list, { restaurantId: w.a.id, supplierId: w.supplierId })).items.map((n) => n.id)).toEqual([openNote.id, spentNote.id]);
    expect(dataOf(await ask(w.owner, creditQueries.list, { restaurantId: w.a.id, openOnly: true })).items.map((n) => n.id)).toEqual([otherSupplier.id, openNote.id]);
    expect(codeOf(await ask(w.owner, creditQueries.get, { restaurantId: w.a.id, creditNoteId: 'nope' }))).toBe('NOT_FOUND');
  });

  it('pages the open notes by a keyset: many spent notes in between never hide an open one, and each page is full', async () => {
    const w = await world();
    const make = (n: number, spent: boolean) => ({
      restaurantId: w.a.id,
      supplierId: w.supplierId,
      number: `BULK-${n}`,
      currency: 'IQD' as const,
      amountMinor: 1000n,
      appliedMinor: spent ? 1000n : 400n,
      noteDate: new Date('2026-10-20T00:00:00Z'),
      clientKey: `bulk-key-${n}`,
      createdById: w.owner.userId,
      createdAt: new Date(NOW.getTime() - n * 60_000),
    });
    // Newest first: 120 spent notes, then 60 open ones, with a spent note every fifth among the open.
    const rows = [
      ...Array.from({ length: 120 }, (_, i) => make(i, true)),
      ...Array.from({ length: 60 }, (_, i) => make(1000 + i * 2, false)),
      ...Array.from({ length: 12 }, (_, i) => make(1001 + i * 10, true)),
    ];
    await prisma().phCreditNote.createMany({ data: rows });
    const open = rows.filter((r) => r.appliedMinor < r.amountMinor).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((r) => r.number);
    const first = dataOf(await ask(w.owner, creditQueries.list, { restaurantId: w.a.id, openOnly: true }));
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = dataOf(await ask(w.owner, creditQueries.list, { restaurantId: w.a.id, openOnly: true, cursor: first.nextCursor }));
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((n) => n.number)).toEqual(open);
    expect(open).toHaveLength(60);
    // A cursor that points at an open note which has since been spent still leads on to the next ones.
    await prisma().phCreditNote.updateMany({ where: { number: first.items[49]!.number }, data: { appliedMinor: 1000n } });
    const after = dataOf(await ask(w.owner, creditQueries.list, { restaurantId: w.a.id, openOnly: true, cursor: first.nextCursor }));
    expect(after.items.map((n) => n.number)).toEqual(open.slice(50));
  });

  it('lets a stock clerk and an accountant read, and refuses a cashier', async () => {
    const w = await world();
    const note = dataOf(await record(w));
    for (const role of ['STOCK', 'ACCOUNTANT'] as const) {
      const who = await person(role.toLowerCase(), { staff: [w.a.id, role, [w.a.branchIds[0]!]] });
      expect(codeOf(await ask(who, creditQueries.list, { restaurantId: w.a.id })), role).toBe('OK');
      expect(codeOf(await ask(who, creditQueries.get, { restaurantId: w.a.id, creditNoteId: note.id })), role).toBe('OK');
    }
    const cashier = await person('cashier', { staff: [w.a.id, 'CASHIER', [w.a.branchIds[0]!]] });
    expect(codeOf(await ask(cashier, creditQueries.list, { restaurantId: w.a.id }))).toBe('FORBIDDEN');
    expect((await getCreditNote(scopedClient(prisma(), { restaurantId: w.a.id, allBranches: true }), (await asPh(w.owner.userId, w.a.id))!, note.id)).id).toBe(note.id);
  });
});
