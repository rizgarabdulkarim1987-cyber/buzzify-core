import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as countActions from '@/server/pharmacy/actions/counts';
import * as productActions from '@/server/pharmacy/actions/products';
import * as countQueries from '@/server/pharmacy/queries/counts';
import { scopedClient } from '@/server/data/tenant-db';
import { applyMovement } from '@/server/pharmacy/stock';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';

const META = { ip: '203.0.113.19', userAgent: 'vitest' };
const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
const phCodeOf = (result: ActionResult<unknown>) => (result.ok ? null : (result.error.fields?.phCode ?? null));
const actorOf = async (who: Person): Promise<Actor> => (await loadActor(prisma(), who.userId)) as Actor;
const act = async <I, O>(who: Person, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), await actorOf(who), def, input, META);
const ask = async <I, O>(who: Person, def: QueryDef<I, O>, input: unknown) => runQuery(prisma(), await actorOf(who), def, input);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected OK, got ${result.error.code}: ${result.error.message} ${JSON.stringify(result.error.fields)}`);
  return result.data;
};

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld, 60_000);
afterEach(() => {
  vi.setSystemTime(NOW);
});

let seq = 0;
async function makeProduct(restaurantId: string, tradeName: string, over: { categoryId?: string; shelfLocation?: string } = {}) {
  seq += 1;
  return prisma().phProduct.create({
    data: {
      restaurantId,
      tradeName,
      identityKey: `${tradeName}|${seq}`,
      searchText: searchTextOf({ tradeName, genericName: '', activeIngredient: '', strength: '', form: '', manufacturer: '' }),
      categoryId: over.categoryId ?? null,
      shelfLocation: over.shelfLocation ?? '',
    },
    select: { id: true },
  });
}

async function makeBatch(restaurantId: string, productId: string, lot: string) {
  return prisma().phBatch.create({
    data: { restaurantId, productId, lot, expiryDate: new Date('2028-03-31T00:00:00.000Z') },
    select: { id: true },
  });
}

/** Direct ledger writes (the test's stock source and "a sale after the count opened"). */
async function move(
  restaurantId: string,
  branchId: string,
  batchId: string,
  type: 'RECEIPT' | 'SALE' | 'ADJUST',
  deltas: { available?: number; quarantine?: number },
  reason = '',
) {
  const scoped = scopedClient(prisma(), { restaurantId, allBranches: true });
  await scoped.$transaction((tx) => applyMovement(tx, { restaurantId, branchId, batchId, type, deltas, reason, userId: 'seed' }));
}

async function world() {
  const a = await pharmacy('A', { branches: 2 });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const catA = await prisma().phCategory.create({ data: { restaurantId: a.id, name: 'Pain', nameKey: 'pain' }, select: { id: true } });
  const catB = await prisma().phCategory.create({ data: { restaurantId: a.id, name: 'Antibiotics', nameKey: 'antibiotics' }, select: { id: true } });
  const p1 = await makeProduct(a.id, 'Panadol', { categoryId: catA.id, shelfLocation: 'A-1-3' });
  const p2 = await makeProduct(a.id, 'Brufen', { categoryId: catA.id, shelfLocation: 'B-2' });
  const p3 = await makeProduct(a.id, 'Amoxil', { categoryId: catB.id, shelfLocation: 'A-9' });
  const b1 = await makeBatch(a.id, p1.id, 'L1');
  const b2 = await makeBatch(a.id, p2.id, 'L2');
  const b3 = await makeBatch(a.id, p3.id, 'L3');
  const b4 = await makeBatch(a.id, p1.id, 'L4'); // stock only in branch 2
  await move(a.id, a.branchId, b1.id, 'RECEIPT', { available: 10 });
  await move(a.id, a.branchId, b2.id, 'RECEIPT', { available: 20 });
  await move(a.id, a.branchId, b3.id, 'RECEIPT', { available: 5 });
  await move(a.id, a.branchIds[1]!, b4.id, 'RECEIPT', { available: 8 });
  return { a, owner, catA, catB, p1, p2, p3, b1, b2, b3, b4 };
}
type W = Awaited<ReturnType<typeof world>>;

const place = (a: { id: string; branchId: string }) => ({ restaurantId: a.id, branchId: a.branchId });
const openInput = (w: W, over: Record<string, unknown> = {}) => ({ ...place(w.a), scope: 'BRANCH', blind: false, note: '', ...over });
async function openCount(who: Person, w: W, over: Record<string, unknown> = {}) {
  return dataOf(await act(who, countActions.open, openInput(w, over)));
}
const linesOf = (countId: string) => prisma().phStockCountLine.findMany({ where: { countId }, orderBy: { batchId: 'asc' } });
async function countAll(who: Person, w: W, countId: string, counted: Record<string, number>) {
  const lines = await linesOf(countId);
  return act(who, countActions.record, {
    ...place(w.a),
    countId,
    lines: lines.map((l) => ({ lineId: l.id, countedQty: counted[l.batchId] ?? l.expectedQty })),
  });
}
const avail = async (batchId: string, branchId: string) => (await prisma().phStockBalance.findFirst({ where: { batchId, branchId } }))?.available ?? 0;
const approveInput = (w: W, countId: string, over: Record<string, unknown> = {}) => ({ ...place(w.a), countId, reason: 'Recount found a difference', ...over });

describe('opening a count', () => {
  it('a branch count snapshots one line per batch with stock in that branch only', async () => {
    const w = await world();
    const r = await openCount(w.owner, w);
    expect(r.lineCount).toBe(3);
    const lines = await linesOf(r.id);
    expect(lines.map((l) => `${l.batchId}:${l.expectedQty}:${l.countedQty}`).sort()).toEqual(
      [`${w.b1.id}:10:null`, `${w.b2.id}:20:null`, `${w.b3.id}:5:null`].sort(),
    );
    const head = await prisma().phStockCount.findUniqueOrThrow({ where: { id: r.id } });
    expect(head).toMatchObject({ status: 'OPEN', branchId: w.a.branchId, scope: 'BRANCH', blind: false, countedById: w.owner.userId });
    expect(await prisma().auditLog.count({ where: { action: 'ph.count.open', entityId: r.id } })).toBe(1);
  });

  it('a batch with only quarantine stock is included; one with nothing anywhere is not', async () => {
    const w = await world();
    const p = await makeProduct(w.a.id, 'Quarantined');
    const q = await makeBatch(w.a.id, p.id, 'Q1');
    await makeBatch(w.a.id, p.id, 'EMPTY');
    await move(w.a.id, w.a.branchId, q.id, 'RECEIPT', { available: 4 });
    await move(w.a.id, w.a.branchId, q.id, 'ADJUST', { available: -4, quarantine: 4 }, 'expired');
    const r = await openCount(w.owner, w);
    const lines = await linesOf(r.id);
    expect(lines.find((l) => l.batchId === q.id)).toMatchObject({ expectedQty: 0 });
    expect(lines).toHaveLength(4);
  });

  it('a category count takes only that category', async () => {
    const w = await world();
    const r = await openCount(w.owner, w, { scope: 'CATEGORY', categoryId: w.catA.id });
    expect((await linesOf(r.id)).map((l) => l.batchId).sort()).toEqual([w.b1.id, w.b2.id].sort());
    expect(await prisma().phStockCount.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ scope: 'CATEGORY', scopeValue: w.catA.id });
  });

  it('a location count takes the shelf-location prefix (case-insensitive)', async () => {
    const w = await world();
    const r = await openCount(w.owner, w, { scope: 'LOCATION', location: ' a-' });
    expect((await linesOf(r.id)).map((l) => l.batchId).sort()).toEqual([w.b1.id, w.b3.id].sort());
  });

  it('the other branch counts its own stock', async () => {
    const w = await world();
    const r = await openCount(w.owner, w, { branchId: w.a.branchIds[1] });
    expect((await linesOf(r.id)).map((l) => l.batchId)).toEqual([w.b4.id]);
  });

  it('refuses a missing scope value, a category of another business, an empty scope, a missing branch', async () => {
    const w = await world();
    expect(codeOf(await act(w.owner, countActions.open, openInput(w, { scope: 'CATEGORY' })))).toBe('INVALID');
    expect(codeOf(await act(w.owner, countActions.open, openInput(w, { scope: 'LOCATION', location: '  ' })))).toBe('INVALID');
    const b = await pharmacy('B');
    const cat = await prisma().phCategory.create({ data: { restaurantId: b.id, name: 'X', nameKey: 'x' }, select: { id: true } });
    expect(codeOf(await act(w.owner, countActions.open, openInput(w, { scope: 'CATEGORY', categoryId: cat.id })))).toBe('INVALID');
    const empty = await act(w.owner, countActions.open, openInput(w, { scope: 'LOCATION', location: 'ZZZ' }));
    expect(codeOf(empty)).toBe('INVALID');
    expect(phCodeOf(empty)).toBe('EMPTY_SCOPE');
    expect(codeOf(await act(w.owner, countActions.open, { restaurantId: w.a.id, scope: 'BRANCH', blind: false, note: '' }))).toBe('INVALID');
    expect(await prisma().phStockCount.count()).toBe(0);
  });

  it('refuses a scope above 5000 lines and creates nothing', async () => {
    const w = await world();
    const rows = Array.from({ length: 5001 }, (_, i) => ({ restaurantId: w.a.id, productId: w.p1.id, lot: `BULK${i}`, expiryDate: new Date('2029-01-31T00:00:00.000Z') }));
    await prisma().phBatch.createMany({ data: rows });
    const batches = await prisma().phBatch.findMany({ where: { lot: { startsWith: 'BULK' } }, select: { id: true } });
    await prisma().phStockBalance.createMany({
      data: batches.map((b) => ({ restaurantId: w.a.id, branchId: w.a.branchId, productId: w.p1.id, batchId: b.id, available: 1 })),
    });
    const r = await act(w.owner, countActions.open, openInput(w));
    expect(codeOf(r)).toBe('INVALID');
    expect(phCodeOf(r)).toBe('SCOPE_TOO_LARGE');
    expect(await prisma().phStockCount.count()).toBe(0);
  }, 60_000);

  it('several counts may be open for the same scope; the result reports the others', async () => {
    const w = await world();
    const first = await openCount(w.owner, w);
    expect(first.otherOpen).toBe(0);
    const second = await openCount(w.owner, w);
    expect(second.otherOpen).toBe(1);
  });
});

describe('who may count', () => {
  it('role matrix: CASHIER and PHARMACIST cannot count; STOCK can count but not approve; PIC can both', async () => {
    const w = await world();
    const cashier = await person('cashier', { staff: [w.a.id, 'CASHIER', [w.a.branchId]] });
    const pharmacist = await person('pharmacist', { staff: [w.a.id, 'PHARMACIST', [w.a.branchId]] });
    const stock = await person('stock', { staff: [w.a.id, 'STOCK', [w.a.branchId]] });
    const pic = await person('pic', { staff: [w.a.id, 'PHARMACIST_IN_CHARGE', [w.a.branchId]] });
    expect(codeOf(await act(cashier, countActions.open, openInput(w)))).toBe('FORBIDDEN');
    expect(codeOf(await act(pharmacist, countActions.open, openInput(w)))).toBe('FORBIDDEN');
    expect(codeOf(await ask(cashier, countQueries.list, place(w.a)))).toBe('FORBIDDEN');
    const r = await openCount(stock, w);
    dataOf(await countAll(stock, w, r.id, {}));
    dataOf(await act(stock, countActions.submit, { ...place(w.a), countId: r.id }));
    expect(codeOf(await act(stock, countActions.approve, approveInput(w, r.id)))).toBe('FORBIDDEN');
    expect(codeOf(await act(pic, countActions.approve, approveInput(w, r.id)))).toBe('OK');
  });

  it('a branch-limited actor opens, sees and changes only their branch’s counts', async () => {
    const w = await world();
    const stock1 = await person('stock1', { staff: [w.a.id, 'STOCK', [w.a.branchId]] });
    const other = await openCount(w.owner, w, { branchId: w.a.branchIds[1] });
    const mine = await openCount(stock1, w);
    expect(codeOf(await act(stock1, countActions.open, openInput(w, { branchId: w.a.branchIds[1] })))).toBe('FORBIDDEN');
    const list = dataOf(await ask(stock1, countQueries.list, place(w.a)));
    expect(list.items.map((c) => c.id)).toEqual([mine.id]);
    expect(codeOf(await ask(stock1, countQueries.get, { ...place(w.a), countId: other.id }))).toBe('NOT_FOUND');
    expect(codeOf(await act(stock1, countActions.cancel, { ...place(w.a), countId: other.id }))).toBe('NOT_FOUND');
    const lineOfOther = (await linesOf(other.id))[0]!;
    expect(codeOf(await act(stock1, countActions.record, { ...place(w.a), countId: other.id, lines: [{ lineId: lineOfOther.id, countedQty: 1 }] }))).toBe('NOT_FOUND');
  });

  it('ids of another business are not found', async () => {
    const w = await world();
    const b = await pharmacy('B');
    const bOwner = await person('bowner', { membership: [b.id, 'OWNER'] });
    const p = await makeProduct(b.id, 'Foreign');
    const batch = await makeBatch(b.id, p.id, 'F1');
    await move(b.id, b.branchId, batch.id, 'RECEIPT', { available: 3 });
    const theirs = dataOf(await act(bOwner, countActions.open, { ...place(b), scope: 'BRANCH', blind: false, note: '' }));
    expect(codeOf(await ask(w.owner, countQueries.get, { ...place(w.a), countId: theirs.id }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.owner, countActions.submit, { ...place(w.a), countId: theirs.id }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.owner, countActions.approve, approveInput(w, theirs.id)))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.owner, countActions.cancel, { ...place(w.a), countId: theirs.id }))).toBe('NOT_FOUND');
  });
});

describe('recording and submitting', () => {
  it('records counts, refuses negative or fractional, a line of another count, duplicates; only while OPEN', async () => {
    const w = await world();
    const r = await openCount(w.owner, w);
    const other = await openCount(w.owner, w, { branchId: w.a.branchIds[1] });
    const lines = await linesOf(r.id);
    const foreign = (await linesOf(other.id))[0]!;
    const rec = (ls: unknown[]) => act(w.owner, countActions.record, { ...place(w.a), countId: r.id, lines: ls });
    expect(codeOf(await rec([{ lineId: lines[0]!.id, countedQty: -1 }]))).toBe('INVALID');
    expect(codeOf(await rec([{ lineId: lines[0]!.id, countedQty: 1.5 }]))).toBe('INVALID');
    expect(codeOf(await rec([]))).toBe('INVALID');
    expect(codeOf(await rec([{ lineId: foreign.id, countedQty: 1 }]))).toBe('INVALID');
    expect(codeOf(await rec([{ lineId: lines[0]!.id, countedQty: 1 }, { lineId: lines[0]!.id, countedQty: 2 }]))).toBe('INVALID');
    expect((await linesOf(r.id)).every((l) => l.countedQty === null)).toBe(true);
    const ok = dataOf(await rec([{ lineId: lines[0]!.id, countedQty: 0 }, { lineId: lines[1]!.id, countedQty: 7 }]));
    expect(ok).toMatchObject({ recorded: 2 });
    expect((await linesOf(r.id)).map((l) => l.countedQty)).toEqual([0, 7, null]);
    expect(await prisma().auditLog.count({ where: { action: 'ph.count.record', entityId: r.id } })).toBe(1);
    dataOf(await act(w.owner, countActions.cancel, { ...place(w.a), countId: r.id }));
    const late = await rec([{ lineId: lines[0]!.id, countedQty: 3 }]);
    expect(codeOf(late)).toBe('CONFLICT');
    expect(phCodeOf(late)).toBe('NOT_OPEN');
  });

  it('submit needs every line counted, or skipUncounted', async () => {
    const w = await world();
    const r = await openCount(w.owner, w);
    const lines = await linesOf(r.id);
    dataOf(await act(w.owner, countActions.record, { ...place(w.a), countId: r.id, lines: [{ lineId: lines[0]!.id, countedQty: 1 }] }));
    const refused = await act(w.owner, countActions.submit, { ...place(w.a), countId: r.id });
    expect(codeOf(refused)).toBe('INVALID');
    expect(phCodeOf(refused)).toBe('UNCOUNTED_LINES');
    expect((await prisma().phStockCount.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('OPEN');
    const done = dataOf(await act(w.owner, countActions.submit, { ...place(w.a), countId: r.id, skipUncounted: true }));
    expect(done).toMatchObject({ status: 'SUBMITTED', uncounted: 2 });
    expect(codeOf(await act(w.owner, countActions.submit, { ...place(w.a), countId: r.id }))).toBe('CONFLICT');
    expect(await prisma().auditLog.count({ where: { action: 'ph.count.submit', entityId: r.id } })).toBe(1);
  });

  it('cancel works from OPEN and SUBMITTED, not after approval; a cancelled count changes no stock', async () => {
    const w = await world();
    const a1 = await openCount(w.owner, w);
    dataOf(await act(w.owner, countActions.cancel, { ...place(w.a), countId: a1.id }));
    expect((await prisma().phStockCount.findUniqueOrThrow({ where: { id: a1.id } })).status).toBe('CANCELLED');
    const a2 = await openCount(w.owner, w);
    dataOf(await countAll(w.owner, w, a2.id, { [w.b1.id]: 1 }));
    dataOf(await act(w.owner, countActions.submit, { ...place(w.a), countId: a2.id }));
    dataOf(await act(w.owner, countActions.cancel, { ...place(w.a), countId: a2.id }));
    expect(await avail(w.b1.id, w.a.branchId)).toBe(10);
    expect(codeOf(await act(w.owner, countActions.approve, approveInput(w, a2.id)))).toBe('CONFLICT');
    expect(codeOf(await act(w.owner, countActions.cancel, { ...place(w.a), countId: a2.id }))).toBe('CONFLICT');
    const a3 = await openCount(w.owner, w);
    dataOf(await countAll(w.owner, w, a3.id, {}));
    dataOf(await act(w.owner, countActions.submit, { ...place(w.a), countId: a3.id }));
    dataOf(await act(w.owner, countActions.approve, approveInput(w, a3.id)));
    expect(codeOf(await act(w.owner, countActions.cancel, { ...place(w.a), countId: a3.id }))).toBe('CONFLICT');
    expect(await prisma().auditLog.count({ where: { action: 'ph.count.cancel' } })).toBe(2);
  });
});

describe('blind counts and reads', () => {
  it('hide expected quantities while OPEN (key absent) and show them after submit', async () => {
    const w = await world();
    const r = await openCount(w.owner, w, { blind: true });
    const open = dataOf(await ask(w.owner, countQueries.get, { ...place(w.a), countId: r.id }));
    expect(open.blind).toBe(true);
    expect(open.lines).toHaveLength(3);
    for (const l of open.lines) {
      expect(Object.prototype.hasOwnProperty.call(l, 'expectedQty')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(l, 'difference')).toBe(false);
    }
    expect(JSON.stringify(open)).not.toContain('"expectedQty"');
    dataOf(await countAll(w.owner, w, r.id, { [w.b1.id]: 9 }));
    dataOf(await act(w.owner, countActions.submit, { ...place(w.a), countId: r.id }));
    const sub = dataOf(await ask(w.owner, countQueries.get, { ...place(w.a), countId: r.id }));
    const line = sub.lines.find((l) => l.batchId === w.b1.id)!;
    expect(line).toMatchObject({ expectedQty: 10, countedQty: 9, difference: -1 });
  });

  it('a non-blind OPEN count shows expected; list carries no quantities', async () => {
    const w = await world();
    const r = await openCount(w.owner, w);
    const open = dataOf(await ask(w.owner, countQueries.get, { ...place(w.a), countId: r.id }));
    expect(open.lines.find((l) => l.batchId === w.b2.id)).toMatchObject({ expectedQty: 20, countedQty: null });
    const list = dataOf(await ask(w.owner, countQueries.list, { ...place(w.a), status: 'OPEN' }));
    expect(list.items[0]).toMatchObject({ id: r.id, status: 'OPEN', lineCount: 3 });
    expect(JSON.stringify(list)).not.toContain('expected');
  });

  it('shows cost per cost unit (never a computed value) to a role with cost.view', async () => {
    const w = await world();
    const unit = await prisma().phProductUnit.create({ data: { restaurantId: w.a.id, productId: w.p1.id, level: 1, label: 'strip', baseQty: 10, sellable: true } });
    await prisma().phBatch.update({ where: { id: w.b1.id }, data: { unitCostMinor: 2500n, costCurrency: 'IQD', costUnitId: unit.id } });
    const stock = await person('stock', { staff: [w.a.id, 'STOCK', [w.a.branchId]] });
    const r = await openCount(stock, w);
    const got = dataOf(await ask(stock, countQueries.get, { ...place(w.a), countId: r.id }));
    const line = got.lines.find((l) => l.batchId === w.b1.id)!;
    expect(line.cost).toEqual({ unitCostMinor: '2500', currency: 'IQD', perUnitLabel: 'strip', perUnitBaseQty: 10 });
    expect(JSON.stringify(got)).not.toMatch(/valueMinor|varianceValue/);
  });
});

describe('approving', () => {
  async function submitted(w: W, counted: Record<string, number>, by: Person = w.owner) {
    const r = await openCount(by, w);
    dataOf(await countAll(by, w, r.id, counted));
    dataOf(await act(by, countActions.submit, { ...place(w.a), countId: r.id }));
    return r;
  }

  it('a difference needs a reason of 3..300 characters; no difference needs none', async () => {
    const w = await world();
    const r = await submitted(w, { [w.b1.id]: 8 });
    expect(codeOf(await act(w.owner, countActions.approve, { ...place(w.a), countId: r.id }))).toBe('INVALID');
    expect(codeOf(await act(w.owner, countActions.approve, approveInput(w, r.id, { reason: 'ab' })))).toBe('INVALID');
    expect(codeOf(await act(w.owner, countActions.approve, approveInput(w, r.id, { reason: 'x'.repeat(301) })))).toBe('INVALID');
    expect(await avail(w.b1.id, w.a.branchId)).toBe(10);
    const clean = await submitted(w, {});
    const ok = dataOf(await act(w.owner, countActions.approve, { ...place(w.a), countId: clean.id }));
    expect(ok).toMatchObject({ status: 'APPROVED', movements: 0 });
  });

  it('applies the differences as COUNT movements with the count id, and audits without cost', async () => {
    const w = await world();
    const r = await submitted(w, { [w.b1.id]: 8, [w.b2.id]: 23 });
    const done = dataOf(await act(w.owner, countActions.approve, approveInput(w, r.id)));
    expect(done).toMatchObject({ status: 'APPROVED', movements: 2, selfApproved: true });
    expect(await avail(w.b1.id, w.a.branchId)).toBe(8);
    expect(await avail(w.b2.id, w.a.branchId)).toBe(23);
    expect(await avail(w.b3.id, w.a.branchId)).toBe(5);
    const moves = await prisma().phStockMovement.findMany({ where: { countId: r.id }, orderBy: { batchId: 'asc' } });
    expect(moves.map((m) => [m.type, m.availableDelta, m.reason, m.userId])).toEqual(
      [w.b1.id, w.b2.id].sort().map((id) => ['COUNT', id === w.b1.id ? -2 : 3, 'Recount found a difference', w.owner.userId]),
    );
    const head = await prisma().phStockCount.findUniqueOrThrow({ where: { id: r.id } });
    expect(head).toMatchObject({ status: 'APPROVED', approvedById: w.owner.userId, reason: 'Recount found a difference' });
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.count.approve', entityId: r.id } });
    expect(JSON.stringify(audit.changes)).toContain('selfApproved');
    expect(JSON.stringify(audit.changes)).not.toMatch(/cost|price/i);
  });

  it('adds the counted difference to current stock, so a sale made after the count opened is kept', async () => {
    const w = await world();
    const r = await openCount(w.owner, w);
    await move(w.a.id, w.a.branchId, w.b1.id, 'SALE', { available: -3 });
    dataOf(await countAll(w.owner, w, r.id, { [w.b1.id]: 8 }));
    dataOf(await act(w.owner, countActions.submit, { ...place(w.a), countId: r.id }));
    const shown = dataOf(await ask(w.owner, countQueries.get, { ...place(w.a), countId: r.id }));
    expect(shown.lines.find((l) => l.batchId === w.b1.id)).toMatchObject({ expectedQty: 10, countedQty: 8, difference: -2 });
    dataOf(await act(w.owner, countActions.approve, approveInput(w, r.id)));
    expect(await avail(w.b1.id, w.a.branchId)).toBe(5);
  });

  it('skipped (uncounted) lines change nothing', async () => {
    const w = await world();
    const r = await openCount(w.owner, w);
    const lines = await linesOf(r.id);
    const l1 = lines.find((l) => l.batchId === w.b1.id)!;
    dataOf(await act(w.owner, countActions.record, { ...place(w.a), countId: r.id, lines: [{ lineId: l1.id, countedQty: 4 }] }));
    dataOf(await act(w.owner, countActions.submit, { ...place(w.a), countId: r.id, skipUncounted: true }));
    dataOf(await act(w.owner, countActions.approve, approveInput(w, r.id)));
    expect(await avail(w.b1.id, w.a.branchId)).toBe(4);
    expect(await avail(w.b2.id, w.a.branchId)).toBe(20);
    expect(await prisma().phStockMovement.count({ where: { countId: r.id } })).toBe(1);
  });

  it('a result below zero refuses the whole approve, names the line, and rolls everything back', async () => {
    const w = await world();
    const r = await openCount(w.owner, w);
    dataOf(await countAll(w.owner, w, r.id, { [w.b1.id]: 14, [w.b2.id]: 0 }));
    dataOf(await act(w.owner, countActions.submit, { ...place(w.a), countId: r.id }));
    await move(w.a.id, w.a.branchId, w.b2.id, 'SALE', { available: -15 });
    const res = await act(w.owner, countActions.approve, approveInput(w, r.id));
    expect(codeOf(res)).toBe('CONFLICT');
    expect(phCodeOf(res)).toBe('INSUFFICIENT_STOCK');
    const line = (await linesOf(r.id)).find((l) => l.batchId === w.b2.id)!;
    expect(res.ok ? '' : res.error.fields?.lineId).toBe(line.id);
    expect(res.ok ? '' : res.error.message).toContain('Brufen');
    expect(await avail(w.b1.id, w.a.branchId)).toBe(10);
    expect(await avail(w.b2.id, w.a.branchId)).toBe(5);
    expect(await prisma().phStockMovement.count({ where: { countId: r.id } })).toBe(0);
    expect(await prisma().phStockCount.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: 'SUBMITTED', approvedById: null });
  });

  it('two approvals at once: exactly one wins and the stock changes once', async () => {
    const w = await world();
    const pic = await person('pic', { staff: [w.a.id, 'PHARMACIST_IN_CHARGE', [w.a.branchId]] });
    const counter = await person('counter', { staff: [w.a.id, 'STOCK', [w.a.branchId]] });
    const r = await submitted(w, { [w.b1.id]: 6 }, counter);
    const results = await Promise.all([
      act(w.owner, countActions.approve, approveInput(w, r.id)),
      act(pic, countActions.approve, approveInput(w, r.id)),
      act(w.owner, countActions.approve, approveInput(w, r.id)),
    ]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(results.filter((x) => !x.ok).every((x) => codeOf(x) === 'CONFLICT')).toBe(true);
    expect(await avail(w.b1.id, w.a.branchId)).toBe(6);
    expect(await prisma().phStockMovement.count({ where: { countId: r.id } })).toBe(1);
  });

  it('the approver may not be the counter when another user can approve in the branch', async () => {
    const w = await world();
    const pic = await person('pic', { staff: [w.a.id, 'PHARMACIST_IN_CHARGE', [w.a.branchId]] });
    const r = await submitted(w, { [w.b1.id]: 9 }, pic);
    const self = await act(pic, countActions.approve, approveInput(w, r.id));
    expect(codeOf(self)).toBe('FORBIDDEN');
    expect(phCodeOf(self)).toBe('SELF_APPROVAL');
    expect(await avail(w.b1.id, w.a.branchId)).toBe(10);
    const ok = dataOf(await act(w.owner, countActions.approve, approveInput(w, r.id)));
    expect(ok.selfApproved).toBe(false);
    expect(await avail(w.b1.id, w.a.branchId)).toBe(9);
  });

  it('a holder of stock.adjust in another branch only does not make the counter “not alone”', async () => {
    const w = await world();
    const only = await person('only', { staff: [w.a.id, 'PHARMACIST_IN_CHARGE', [w.a.branchId]] });
    await prisma().membership.deleteMany({ where: { userId: w.owner.userId } });
    await person('elsewhere', { staff: [w.a.id, 'PHARMACIST_IN_CHARGE', [w.a.branchIds[1]!]] });
    const r = await submitted(w, { [w.b1.id]: 9 }, only);
    const ok = dataOf(await act(only, countActions.approve, approveInput(w, r.id)));
    expect(ok.selfApproved).toBe(true);
    expect(await avail(w.b1.id, w.a.branchId)).toBe(9);
  });

  it('a deactivated holder does not count as another approver', async () => {
    const w = await world();
    const pic = await person('pic', { staff: [w.a.id, 'PHARMACIST_IN_CHARGE', [w.a.branchId]] });
    await prisma().user.update({ where: { id: w.owner.userId }, data: { deactivatedAt: NOW } });
    const r = await submitted(w, { [w.b1.id]: 9 }, pic);
    expect(dataOf(await act(pic, countActions.approve, approveInput(w, r.id))).selfApproved).toBe(true);
  });

  it('approve with expectedVersion refuses a stale version', async () => {
    const w = await world();
    const r = await submitted(w, { [w.b1.id]: 9 });
    const head = await prisma().phStockCount.findUniqueOrThrow({ where: { id: r.id } });
    expect(codeOf(await act(w.owner, countActions.approve, approveInput(w, r.id, { expectedVersion: head.version + 5 })))).toBe('CONFLICT');
    expect(codeOf(await act(w.owner, countActions.approve, approveInput(w, r.id, { expectedVersion: head.version })))).toBe('OK');
  });

  it('cannot approve an OPEN count', async () => {
    const w = await world();
    const r = await openCount(w.owner, w);
    const res = await act(w.owner, countActions.approve, approveInput(w, r.id));
    expect(codeOf(res)).toBe('CONFLICT');
    expect(phCodeOf(res)).toBe('NOT_SUBMITTED');
  });
});

describe('counts block archiving', () => {
  it('a product on an open count cannot be archived; after cancel it can', async () => {
    const w = await world();
    const r = await openCount(w.owner, w, { scope: 'CATEGORY', categoryId: w.catB.id });
    // Stock-free product so only the count is the blocker.
    await prisma().phStockBalance.updateMany({ where: { batchId: w.b3.id }, data: { available: 0 } });
    const version = (await prisma().phProduct.findUniqueOrThrow({ where: { id: w.p3.id } })).version;
    const refused = await act(w.owner, productActions.archive, { restaurantId: w.a.id, productId: w.p3.id, expectedVersion: version });
    expect(codeOf(refused)).toBe('CONFLICT');
    expect(phCodeOf(refused)).toBe('PRODUCT_IN_USE');
    dataOf(await act(w.owner, countActions.cancel, { ...place(w.a), countId: r.id }));
    expect(codeOf(await act(w.owner, productActions.archive, { restaurantId: w.a.id, productId: w.p3.id, expectedVersion: version }))).toBe('OK');
  });
});
