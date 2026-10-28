import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { scopedClient } from '@/server/data/tenant-db';
import * as poActions from '@/server/pharmacy/actions/purchase-orders';
import * as poQueries from '@/server/pharmacy/queries/purchase-orders';
import { getPurchaseOrder, listPurchaseOrders } from '@/server/pharmacy/purchase-orders';
import { grant, NOW, DAY, asPh, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask, codeOf, dataOf, makeBatch, makeProduct, phCodeOf } from './stock-helpers';

let keySeq = 0;
type World = Awaited<ReturnType<typeof world>>;

async function world() {
  const a = await pharmacy('A', { branches: 2 });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const supplier = await prisma().phSupplier.create({
    data: { restaurantId: a.id, name: 'Al-Noor', nameKey: 'al-noor', defaultCurrency: 'USD', clientKey: `sup-${(keySeq += 1)}-aaaa`, createdById: owner.userId },
    select: { id: true },
  });
  const product = await makeProduct(a.id, 'Panadol');
  const other = await makeProduct(a.id, 'Brufen');
  return { a, owner, supplierId: supplier.id, product, other };
}

const lineOf = (product: { id: string; tablet: string; strip: string }, over: Record<string, unknown> = {}) => ({
  productId: product.id,
  unitId: product.strip,
  qtyOrdered: 10,
  bonusOrdered: 2,
  unitCostMinor: '2500',
  ...over,
});

const body = (w: World, over: Record<string, unknown> = {}) => ({
  restaurantId: w.a.id,
  branchId: w.a.branchIds[0],
  clientKey: `po-key-${(keySeq += 1)}-aaaa`,
  supplierId: w.supplierId,
  currency: 'IQD',
  expectedOn: '2026-11-05',
  note: 'Call before delivery',
  lines: [lineOf(w.product), lineOf(w.other, { qtyOrdered: 4, bonusOrdered: 0, unitCostMinor: '1000' })],
  ...over,
});

const edit = (w: World, purchaseOrderId: string, expectedVersion: number, over: Record<string, unknown> = {}) => {
  const { clientKey, ...rest } = body(w);
  void clientKey;
  return { ...rest, purchaseOrderId, expectedVersion, ...over };
};

const ref = (w: World, purchaseOrderId: string, expectedVersion: number, branch = 0) => ({
  restaurantId: w.a.id,
  branchId: w.a.branchIds[branch],
  purchaseOrderId,
  expectedVersion,
});

async function draft(w: World, over: Record<string, unknown> = {}) {
  return dataOf(await act(w.owner, poActions.create, body(w, over)));
}

async function placed(w: World, over: Record<string, unknown> = {}) {
  const d = await draft(w, over);
  const o = dataOf(await act(w.owner, poActions.order, ref(w, d.id, 1, over.branchId === w.a.branchIds[1] ? 1 : 0)));
  return { ...o, id: d.id };
}

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

describe('creating a purchase order', () => {
  it('stores a DRAFT with numbered lines in the validated branch, and audits ids and counts only', async () => {
    const w = await world();
    const made = await draft(w);
    expect(made).toMatchObject({ version: 1, status: 'DRAFT', currency: 'IQD', lineCount: 2, replayed: false });
    const row = await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: made.id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    expect(row).toMatchObject({
      restaurantId: w.a.id,
      branchId: w.a.branchIds[0],
      supplierId: w.supplierId,
      status: 'DRAFT',
      currency: 'IQD',
      number: null,
      note: 'Call before delivery',
      createdById: w.owner.userId,
      version: 1,
    });
    expect(row.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.expectedOn?.toISOString().slice(0, 10)).toBe('2026-11-05');
    expect(row.lines.map((l) => [l.lineNo, l.productId, l.unitId, l.qtyOrdered, l.bonusOrdered, l.unitCostMinor, l.receivedQty, l.receivedBonus])).toEqual([
      [1, w.product.id, w.product.strip, 10, 2, 2500n, 0, 0],
      [2, w.other.id, w.other.strip, 4, 0, 1000n, 0, 0],
    ]);
    const audit = await prisma().auditLog.findMany({ where: { action: 'ph.po.create', entityId: made.id } });
    expect(audit).toHaveLength(1);
    const text = JSON.stringify(audit[0]!.changes);
    for (const secret of ['Call before', 'Al-Noor', 'Panadol']) expect(text).not.toContain(secret);
    expect(audit[0]!.changes).toMatchObject({ status: { after: 'DRAFT' }, currency: { after: 'IQD' }, lineCount: { after: 2 }, version: { after: 1 } });
  });

  it('may use a currency other than the supplier default, and USD', async () => {
    const w = await world();
    const made = await draft(w, { currency: 'USD' });
    expect((await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: made.id } })).currency).toBe('USD');
  });

  it('validates the fields', async () => {
    const w = await world();
    const bad: Record<string, unknown>[] = [
      { lines: [] },
      { lines: [lineOf(w.product, { qtyOrdered: 0 })] },
      { lines: [lineOf(w.product, { qtyOrdered: 1.5 })] },
      { lines: [lineOf(w.product, { bonusOrdered: -1 })] },
      { lines: [lineOf(w.product, { unitCostMinor: '-1' })] },
      { lines: [lineOf(w.product, { unitCostMinor: 'abc' })] },
      { currency: 'EUR' },
      { expectedOn: '2026-02-30' },
      { expectedOn: 'tomorrow' },
      { note: 'x'.repeat(501) },
      { clientKey: 'short' },
      { branchId: undefined },
    ];
    for (const over of bad) expect(codeOf(await act(w.owner, poActions.create, body(w, over))), JSON.stringify(over)).toBe('INVALID');
    expect(await prisma().phPurchaseOrder.count()).toBe(0);
  });

  it('allows zero cost, no expected date and no note', async () => {
    const w = await world();
    const made = dataOf(await act(w.owner, poActions.create, body(w, { lines: [lineOf(w.product, { unitCostMinor: '0', bonusOrdered: 0 })], expectedOn: null, note: '' })));
    expect(made.lineCount).toBe(1);
  });

  it('refuses the same product and unit twice, but allows two units of one product', async () => {
    const w = await world();
    const twice = await act(w.owner, poActions.create, body(w, { lines: [lineOf(w.product), lineOf(w.product, { qtyOrdered: 3 })] }));
    expect(codeOf(twice)).toBe('INVALID');
    expect(phCodeOf(twice)).toBe('DUPLICATE_LINE');
    expect(codeOf(await act(w.owner, poActions.create, body(w, { lines: [lineOf(w.product), lineOf(w.product, { unitId: w.product.tablet })] })))).toBe('OK');
    expect(await prisma().phPurchaseOrder.count()).toBe(1);
  });

  it('refuses a unit that is not the product’s, an inactive product, and another business’s product', async () => {
    const w = await world();
    const crossUnit = await act(w.owner, poActions.create, body(w, { lines: [lineOf(w.product, { unitId: w.other.strip })] }));
    expect(codeOf(crossUnit)).toBe('INVALID');
    expect(JSON.stringify(crossUnit)).toContain('lines.0.unitId');
    await prisma().phProduct.update({ where: { id: w.other.id }, data: { active: false } });
    expect(codeOf(await act(w.owner, poActions.create, body(w, { lines: [lineOf(w.other)] })))).toBe('INVALID');
    const b = await pharmacy('B');
    const theirs = await makeProduct(b.id, 'Theirs');
    expect(codeOf(await act(w.owner, poActions.create, body(w, { lines: [lineOf(theirs)] })))).toBe('INVALID');
    expect(await prisma().phPurchaseOrder.count()).toBe(0);
  });

  it('accepts 200 lines and refuses 201', async () => {
    const w = await world();
    const products = await Promise.all(Array.from({ length: 101 }, (_, i) => makeProduct(w.a.id, `Bulk ${i}`)));
    const lines = products.flatMap((p) => [lineOf(p), lineOf(p, { unitId: p.tablet })]);
    expect(lines).toHaveLength(202);
    expect(codeOf(await act(w.owner, poActions.create, body(w, { lines })))).toBe('INVALID');
    const made = dataOf(await act(w.owner, poActions.create, body(w, { lines: lines.slice(0, 200) })));
    expect(made.lineCount).toBe(200);
    expect(await prisma().phPurchaseOrderLine.count({ where: { purchaseOrderId: made.id } })).toBe(200);
  });

  it('refuses an archived supplier (SUPPLIER_ARCHIVED) and another business’s supplier (not found)', async () => {
    const w = await world();
    await prisma().phSupplier.update({ where: { id: w.supplierId }, data: { active: false } });
    const refused = await act(w.owner, poActions.create, body(w));
    expect(codeOf(refused)).toBe('CONFLICT');
    expect(phCodeOf(refused)).toBe('SUPPLIER_ARCHIVED');
    const b = await pharmacy('B');
    const ownerB = await person('ownerb', { membership: [b.id, 'OWNER'] });
    const theirs = await prisma().phSupplier.create({
      data: { restaurantId: b.id, name: 'Theirs', nameKey: 'theirs', defaultCurrency: 'IQD', clientKey: 'theirs-key-1', createdById: ownerB.userId },
      select: { id: true },
    });
    expect(codeOf(await act(w.owner, poActions.create, body(w, { supplierId: theirs.id })))).toBe('NOT_FOUND');
    expect(await prisma().phPurchaseOrder.count()).toBe(0);
  });

  it('replays the same key and payload as one row, replayed: true, with one audit row', async () => {
    const w = await world();
    const payload = body(w);
    const first = dataOf(await act(w.owner, poActions.create, payload));
    const again = dataOf(await act(w.owner, poActions.create, payload));
    expect(again).toMatchObject({ id: first.id, replayed: true, lineCount: 2, status: 'DRAFT' });
    expect(await prisma().phPurchaseOrder.count()).toBe(1);
    expect(await prisma().phPurchaseOrderLine.count()).toBe(2);
    expect(await prisma().auditLog.count({ where: { action: 'ph.po.create' } })).toBe(1);
  });

  it('refuses the same key with a different payload, another branch or another person', async () => {
    const w = await world();
    const manager = await person('mgr', { staff: [w.a.id, 'PHARMACIST_IN_CHARGE', w.a.branchIds] });
    const payload = body(w);
    dataOf(await act(w.owner, poActions.create, payload));
    for (const over of [{ note: 'changed' }, { currency: 'USD' }, { lines: [lineOf(w.product, { qtyOrdered: 11 })] }, { branchId: w.a.branchIds[1] }]) {
      const mismatch = await act(w.owner, poActions.create, { ...payload, ...over });
      expect(codeOf(mismatch), JSON.stringify(over)).toBe('CONFLICT');
      expect(phCodeOf(mismatch)).toBe('CLIENT_KEY_MISMATCH');
    }
    expect(phCodeOf(await act(manager, poActions.create, payload))).toBe('CLIENT_KEY_MISMATCH');
    expect(await prisma().phPurchaseOrder.count()).toBe(1);
  });

  it('keeps one row when two creates with one key run at once', async () => {
    const w = await world();
    const payload = body(w);
    const results = await Promise.all([act(w.owner, poActions.create, payload), act(w.owner, poActions.create, payload)]);
    expect(results.map(codeOf)).toEqual(['OK', 'OK']);
    expect(await prisma().phPurchaseOrder.count()).toBe(1);
    expect(results.filter((r) => r.ok && r.data.replayed)).toHaveLength(1);
  });
});

describe('updating a draft', () => {
  it('replaces the header and lines, bumps the version, and audits ids only', async () => {
    const w = await world();
    const made = await draft(w);
    const saved = dataOf(await act(w.owner, poActions.update, edit(w, made.id, 1, { currency: 'USD', note: 'second', lines: [lineOf(w.product, { qtyOrdered: 7, unitCostMinor: '3' })] })));
    expect(saved).toMatchObject({ id: made.id, version: 2, status: 'DRAFT' });
    const row = await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: made.id }, include: { lines: true } });
    expect(row).toMatchObject({ currency: 'USD', note: 'second', version: 2 });
    expect(row.lines).toHaveLength(1);
    expect(row.lines[0]).toMatchObject({ lineNo: 1, qtyOrdered: 7, unitCostMinor: 3n });
    const audit = await prisma().auditLog.findMany({ where: { action: 'ph.po.update', entityId: made.id } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]!.changes)).not.toContain('second');
    expect(audit[0]!.changes).toMatchObject({ version: { before: 1, after: 2 }, lineCount: { after: 1 } });
  });

  it('refuses a stale expectedVersion with CONFLICT and changes nothing', async () => {
    const w = await world();
    const made = await draft(w);
    dataOf(await act(w.owner, poActions.update, edit(w, made.id, 1, { note: 'first' })));
    const stale = await act(w.owner, poActions.update, edit(w, made.id, 1, { note: 'second' }));
    expect(codeOf(stale)).toBe('CONFLICT');
    const row = await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: made.id } });
    expect(row).toMatchObject({ note: 'first', version: 2 });
  });

  it('refuses an update once the order is ORDERED (NOT_DRAFT) and leaves it untouched', async () => {
    const w = await world();
    const o = await placed(w);
    const refused = await act(w.owner, poActions.update, edit(w, o.id, o.version, { note: 'late' }));
    expect(codeOf(refused)).toBe('CONFLICT');
    expect(phCodeOf(refused)).toBe('NOT_DRAFT');
    const row = await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: o.id }, include: { lines: true } });
    expect(row).toMatchObject({ note: 'Call before delivery', version: 2, status: 'ORDERED' });
    expect(row.lines).toHaveLength(2);
  });

  it('keeps the old lines when the new ones are refused', async () => {
    const w = await world();
    const made = await draft(w);
    const dup = await act(w.owner, poActions.update, edit(w, made.id, 1, { lines: [lineOf(w.product), lineOf(w.product)] }));
    expect(phCodeOf(dup)).toBe('DUPLICATE_LINE');
    expect(await prisma().phPurchaseOrderLine.count({ where: { purchaseOrderId: made.id } })).toBe(2);
    expect((await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: made.id } })).version).toBe(1);
  });

  it('refuses an archived supplier', async () => {
    const w = await world();
    const made = await draft(w);
    await prisma().phSupplier.update({ where: { id: w.supplierId }, data: { active: false } });
    expect(phCodeOf(await act(w.owner, poActions.update, edit(w, made.id, 1)))).toBe('SUPPLIER_ARCHIVED');
  });
});

describe('placing an order', () => {
  it('moves DRAFT to ORDERED, assigns PO-YYYYMMDD-000001, and records who and when', async () => {
    const w = await world();
    const made = await draft(w);
    const o = dataOf(await act(w.owner, poActions.order, ref(w, made.id, 1)));
    expect(o).toMatchObject({ id: made.id, version: 2, status: 'ORDERED', number: 'PO-20261027-000001' });
    const row = await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: made.id } });
    expect(row).toMatchObject({ status: 'ORDERED', number: 'PO-20261027-000001', orderedById: w.owner.userId, version: 2 });
    expect(row.orderedAt?.toISOString()).toBe(NOW.toISOString());
    const audit = await prisma().auditLog.findMany({ where: { action: 'ph.po.order', entityId: made.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.changes).toMatchObject({ status: { before: 'DRAFT', after: 'ORDERED' }, version: { before: 1, after: 2 } });
  });

  it('numbers per branch per UTC day: a sequence, independent per branch, restarting the next day', async () => {
    const w = await world();
    const numbers: string[] = [];
    for (let i = 0; i < 3; i += 1) numbers.push((await placed(w)).number!);
    expect(numbers).toEqual(['PO-20261027-000001', 'PO-20261027-000002', 'PO-20261027-000003']);
    const second = await placed(w, { branchId: w.a.branchIds[1] });
    expect(second.number).toBe('PO-20261027-000001');
    vi.setSystemTime(new Date(NOW.getTime() + DAY));
    expect((await placed(w)).number).toBe('PO-20261028-000001');
    expect((await placed(w)).number).toBe('PO-20261028-000002');
  });

  it('keeps a draft’s number empty until it is ordered, and never reuses a cancelled order’s number', async () => {
    const w = await world();
    const first = await placed(w);
    dataOf(await act(w.owner, poActions.cancel, ref(w, first.id, first.version)));
    expect((await placed(w)).number).toBe('PO-20261027-000002');
    expect((await draft(w)).id).toBeTruthy();
    expect(await prisma().phPurchaseOrder.count({ where: { number: null } })).toBe(1);
  });

  it('numbers once when two order calls run at once on one order', async () => {
    const w = await world();
    const made = await draft(w);
    const results = await Promise.all([act(w.owner, poActions.order, ref(w, made.id, 1)), act(w.owner, poActions.order, ref(w, made.id, 1))]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    const row = await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: made.id } });
    expect(row).toMatchObject({ status: 'ORDERED', number: 'PO-20261027-000001', version: 2 });
    expect(await prisma().auditLog.count({ where: { action: 'ph.po.order' } })).toBe(1);
  });

  it('numbers two different orders of one branch placed at once without a gap or a repeat', async () => {
    const w = await world();
    const one = await draft(w);
    const two = await draft(w);
    const results = await Promise.all([act(w.owner, poActions.order, ref(w, one.id, 1)), act(w.owner, poActions.order, ref(w, two.id, 1))]);
    expect(results.map(codeOf)).toEqual(['OK', 'OK']);
    const numbers = (await prisma().phPurchaseOrder.findMany({ select: { number: true } })).map((r) => r.number).sort();
    expect(numbers).toEqual(['PO-20261027-000001', 'PO-20261027-000002']);
  });

  it('refuses a stale version, and an order that is not a draft', async () => {
    const w = await world();
    const made = await draft(w);
    dataOf(await act(w.owner, poActions.update, edit(w, made.id, 1)));
    expect(codeOf(await act(w.owner, poActions.order, ref(w, made.id, 1)))).toBe('CONFLICT');
    expect(await prisma().phPurchaseOrder.count({ where: { status: 'ORDERED' } })).toBe(0);
    const o = dataOf(await act(w.owner, poActions.order, ref(w, made.id, 2)));
    const again = await act(w.owner, poActions.order, ref(w, made.id, o.version));
    expect(codeOf(again)).toBe('CONFLICT');
    expect(phCodeOf(again)).toBe('NOT_DRAFT');
  });

  it('refuses when the supplier was archived since the draft, and does not consume a number', async () => {
    const w = await world();
    const made = await draft(w);
    await prisma().phSupplier.update({ where: { id: w.supplierId }, data: { active: false } });
    expect(phCodeOf(await act(w.owner, poActions.order, ref(w, made.id, 1)))).toBe('SUPPLIER_ARCHIVED');
    expect(await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: made.id } })).toMatchObject({ status: 'DRAFT', number: null, version: 1 });
    await prisma().phSupplier.update({ where: { id: w.supplierId }, data: { active: true } });
    expect(dataOf(await act(w.owner, poActions.order, ref(w, made.id, 1))).number).toBe('PO-20261027-000001');
  });
});

describe('cancelling and closing', () => {
  it('cancels a DRAFT and an ORDERED order with nothing received, and nothing else changes', async () => {
    const w = await world();
    const d = await draft(w);
    const c1 = dataOf(await act(w.owner, poActions.cancel, ref(w, d.id, 1)));
    expect(c1).toMatchObject({ status: 'CANCELLED', version: 2 });
    const o = await placed(w);
    const c2 = dataOf(await act(w.owner, poActions.cancel, ref(w, o.id, o.version)));
    expect(c2).toMatchObject({ status: 'CANCELLED', number: o.number });
    const row = await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(row.cancelledAt?.toISOString()).toBe(NOW.toISOString());
    expect(await prisma().auditLog.count({ where: { action: 'ph.po.cancel' } })).toBe(2);
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.po.cancel', entityId: o.id } });
    expect(audit.changes).toMatchObject({ status: { before: 'ORDERED', after: 'CANCELLED' } });
    // A cancelled order cannot be edited, ordered, cancelled or closed again.
    expect(codeOf(await act(w.owner, poActions.order, ref(w, o.id, c2.version)))).toBe('CONFLICT');
    expect(codeOf(await act(w.owner, poActions.cancel, ref(w, o.id, c2.version)))).toBe('CONFLICT');
    expect(phCodeOf(await act(w.owner, poActions.close, { ...ref(w, o.id, c2.version), reason: 'no longer needed' }))).toBe('INVALID_TRANSITION');
  });

  it('refuses a cancel when something was received (counters set straight in SQL, as task 5 will)', async () => {
    const w = await world();
    const o = await placed(w);
    const line = await prisma().phPurchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: o.id, lineNo: 1 } });
    await prisma().phPurchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: 3 } });
    const refused = await act(w.owner, poActions.cancel, ref(w, o.id, o.version));
    expect(codeOf(refused)).toBe('CONFLICT');
    expect(phCodeOf(refused)).toBe('HAS_RECEIVED');
    expect(await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: 'ORDERED', version: 2, cancelledAt: null });
    // Bonus alone counts as received too.
    await prisma().phPurchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: 0, receivedBonus: 1 } });
    expect(phCodeOf(await act(w.owner, poActions.cancel, ref(w, o.id, o.version)))).toBe('HAS_RECEIVED');
    // A PARTIAL order cannot be cancelled either.
    await prisma().phPurchaseOrder.update({ where: { id: o.id }, data: { status: 'PARTIAL' } });
    expect(phCodeOf(await act(w.owner, poActions.cancel, ref(w, o.id, o.version)))).toBe('HAS_RECEIVED');
  });

  it('closes ORDERED, PARTIAL and RECEIVED orders with a reason, and keeps the reason out of the audit', async () => {
    const w = await world();
    for (const status of ['ORDERED', 'PARTIAL', 'RECEIVED'] as const) {
      const o = await placed(w);
      if (status !== 'ORDERED') await prisma().phPurchaseOrder.update({ where: { id: o.id }, data: { status } });
      const closed = dataOf(await act(w.owner, poActions.close, { ...ref(w, o.id, o.version), reason: '  Supplier  stopped trading  ' }));
      expect(closed).toMatchObject({ status: 'CLOSED', version: o.version + 1 });
      const row = await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: o.id } });
      expect(row).toMatchObject({ status: 'CLOSED', closeReason: 'Supplier stopped trading', closedById: w.owner.userId });
      expect(row.closedAt?.toISOString()).toBe(NOW.toISOString());
      const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.po.close', entityId: o.id } });
      expect(JSON.stringify(audit.changes)).not.toContain('stopped');
      expect(audit.changes).toMatchObject({ status: { before: status, after: 'CLOSED' } });
    }
  });

  it('requires a reason of 3 to 300 characters, and refuses closing a draft or a closed order', async () => {
    const w = await world();
    const o = await placed(w);
    for (const reason of ['', '  ', 'ab', 'x'.repeat(301)]) {
      expect(codeOf(await act(w.owner, poActions.close, { ...ref(w, o.id, o.version), reason })), reason).toBe('INVALID');
    }
    expect(codeOf(await act(w.owner, poActions.close, { ...ref(w, o.id, o.version), reason: 'x'.repeat(300) }))).toBe('OK');
    const closedVersion = o.version + 1;
    expect(phCodeOf(await act(w.owner, poActions.close, { ...ref(w, o.id, closedVersion), reason: 'again' }))).toBe('INVALID_TRANSITION');
    const d = await draft(w);
    expect(phCodeOf(await act(w.owner, poActions.close, { ...ref(w, d.id, 1), reason: 'not yet ordered' }))).toBe('INVALID_TRANSITION');
  });

  it('refuses a stale version on cancel and close', async () => {
    const w = await world();
    const o = await placed(w);
    expect(codeOf(await act(w.owner, poActions.cancel, ref(w, o.id, 1)))).toBe('CONFLICT');
    expect(codeOf(await act(w.owner, poActions.close, { ...ref(w, o.id, 1), reason: 'stale try' }))).toBe('CONFLICT');
    expect(await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: 'ORDERED', version: 2 });
  });

  it('lets only one of a parallel cancel and close win', async () => {
    const w = await world();
    const o = await placed(w);
    const results = await Promise.all([act(w.owner, poActions.cancel, ref(w, o.id, o.version)), act(w.owner, poActions.close, { ...ref(w, o.id, o.version), reason: 'racing close' })]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    expect((await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: o.id } })).version).toBe(3);
  });
});

describe('reading purchase orders', () => {
  it('lists newest first, filters by status, supplier and number, and pages 50 at a time', async () => {
    const w = await world();
    const rows = Array.from({ length: 55 }, (_, i) => ({
      restaurantId: w.a.id,
      branchId: w.a.branchId,
      supplierId: w.supplierId,
      currency: 'IQD' as const,
      clientKey: `seed-po-${String(i).padStart(2, '0')}-aaaa`,
      createdById: w.owner.userId,
      createdAt: new Date(NOW.getTime() + i * 1000),
      ...(i === 3 ? { status: 'ORDERED' as const, number: 'PO-20261027-000077' } : {}),
    }));
    await prisma().phPurchaseOrder.createMany({ data: rows });
    const first = dataOf(await ask(w.owner, poQueries.list, { restaurantId: w.a.id }));
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = dataOf(await ask(w.owner, poQueries.list, { restaurantId: w.a.id, cursor: first.nextCursor }));
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(55);
    const byStatus = dataOf(await ask(w.owner, poQueries.list, { restaurantId: w.a.id, status: 'ORDERED' }));
    expect(byStatus.items.map((i) => i.number)).toEqual(['PO-20261027-000077']);
    expect(dataOf(await ask(w.owner, poQueries.list, { restaurantId: w.a.id, search: '000077' })).items).toHaveLength(1);
    expect(dataOf(await ask(w.owner, poQueries.list, { restaurantId: w.a.id, supplierId: 'nobody' })).items).toHaveLength(0);
    expect(byStatus.items[0]).toMatchObject({ supplierName: 'Al-Noor', currency: 'IQD', totalMinor: '0', lineCount: 0 });
  });

  it('gets one order with labels, ordered / received / invoiced / to receive per line, and totals', async () => {
    const w = await world();
    const o = await placed(w);
    const lines = await prisma().phPurchaseOrderLine.findMany({ where: { purchaseOrderId: o.id }, orderBy: { lineNo: 'asc' } });
    await prisma().phPurchaseOrderLine.update({ where: { id: lines[0]!.id }, data: { receivedQty: 6, receivedBonus: 1 } });
    // Two receipt lines answer line 1; supplier invoices cover 4 and 2 of them. Another receipt line answers nothing.
    const receipt = await prisma().phReceipt.create({
      data: { restaurantId: w.a.id, branchId: w.a.branchId, clientKey: 'receipt-for-po-1', receivedOn: NOW, createdById: w.owner.userId, supplierId: w.supplierId, purchaseOrderId: o.id },
      select: { id: true },
    });
    const receiptLine = (lineNo: number, orderLineId: string | null, invoicedQty: number) =>
      prisma().phReceiptLine.create({
        data: {
          restaurantId: w.a.id, receiptId: receipt.id, lineNo, productId: w.product.id, unitId: w.product.strip, qty: 4, baseQty: 40,
          lot: `L${lineNo}`, expiryDate: new Date('2028-01-01T00:00:00.000Z'), purchaseOrderLineId: orderLineId, invoicedQty,
        },
      });
    await receiptLine(1, lines[0]!.id, 4);
    await receiptLine(2, lines[0]!.id, 2);
    await receiptLine(3, null, 3);
    const got = dataOf(await ask(w.owner, poQueries.get, { restaurantId: w.a.id, branchId: w.a.branchId, purchaseOrderId: o.id }));
    expect(got).toMatchObject({ id: o.id, number: o.number, status: 'ORDERED', supplierName: 'Al-Noor', currency: 'IQD', lineCount: 2, version: 2, note: 'Call before delivery', expectedOn: '2026-11-05' });
    expect(got.lines[0]).toMatchObject({
      lineNo: 1, productName: 'Panadol', unitLabel: 'strip', qtyOrdered: 10, bonusOrdered: 2,
      receivedQty: 6, receivedBonus: 1, invoicedQty: 6, toReceive: 5, unitCostMinor: '2500', lineTotalMinor: '25000',
    });
    expect(got.lines[1]).toMatchObject({ lineNo: 2, productName: 'Brufen', qtyOrdered: 4, receivedQty: 0, invoicedQty: 0, toReceive: 4, unitCostMinor: '1000', lineTotalMinor: '4000' });
    expect(got.totals).toEqual([{ currency: 'IQD', totalMinor: '29000' }]);
    expect(got.totalMinor).toBe('29000');
    const listed = dataOf(await ask(w.owner, poQueries.list, { restaurantId: w.a.id }));
    expect(listed.items[0]).toMatchObject({ id: o.id, totalMinor: '29000', lineCount: 2 });
  });

  it('shows no money to a role without cost.view (list and get)', async () => {
    const w = await world();
    const o = await placed(w);
    const clerk = await person('pharmacist', { staff: [w.a.id, 'PHARMACIST', [w.a.branchId]] });
    const ph = (await asPh(clerk.userId, w.a.id, w.a.branchId))!;
    expect(ph.role).toBe('PHARMACIST');
    const scoped = scopedClient(prisma(), { restaurantId: w.a.id, branchIds: ph.branchIds });
    const got = await getPurchaseOrder(scoped, ph, o.id);
    expect(got.lines).toHaveLength(2);
    const text = JSON.stringify(got);
    for (const key of ['unitCostMinor', 'lineTotalMinor', 'totalMinor', 'totals']) expect(text, key).not.toContain(key);
    const listed = await listPurchaseOrders(scoped, ph, {});
    expect(listed.items).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain('totalMinor');
  });
});

describe('suggesting what to order', () => {
  async function setMin(w: World, productId: string, minQty: number, reorderQty = 0, branchId = w.a.branchId) {
    await prisma().phProductBranch.create({ data: { restaurantId: w.a.id, branchId, productId, minQty, reorderQty } });
  }

  it('lists exactly the products whose sellable stock is below their minimum, with the suggested quantity', async () => {
    const w = await world();
    const make = (name: string) => makeProduct(w.a.id, name);
    const [below, atMin, above, quarantined, noMin, reorder, expired, inactive, otherBranch] = await Promise.all(
      ['Below', 'AtMin', 'Above', 'Quarantined', 'NoMin', 'Reorder', 'Expired', 'Inactive', 'OtherBranch'].map(make),
    );
    // below: 3 of min 10 -> suggest 7. atMin: 10 of 10 -> no. above: 11 of 10 -> no.
    await setMin(w, below!.id, 10);
    await makeBatch(w.a.id, w.a.branchId, below!.id, { buckets: { available: 3 } });
    await setMin(w, atMin!.id, 10);
    await makeBatch(w.a.id, w.a.branchId, atMin!.id, { buckets: { available: 10 } });
    await setMin(w, above!.id, 10);
    await makeBatch(w.a.id, w.a.branchId, above!.id, { buckets: { available: 11 } });
    // quarantined: 50 in quarantine, reserved and damaged, 2 available -> only available counts.
    await setMin(w, quarantined!.id, 5);
    await makeBatch(w.a.id, w.a.branchId, quarantined!.id, { buckets: { available: 2, quarantine: 50, reserved: 20, damaged: 9 } });
    // no minimum row at all, and a row with minimum 0: never suggested.
    await setMin(w, noMin!.id, 0);
    // reorderQty wins over the gap: 4 of min 10 with reorder 24 -> 24 (nothing in stock, none in a batch).
    await setMin(w, reorder!.id, 10, 24);
    await makeBatch(w.a.id, w.a.branchId, reorder!.id, { buckets: { available: 4 } });
    // An expired batch and a blocked batch hold stock that is not sellable.
    await setMin(w, expired!.id, 6);
    await makeBatch(w.a.id, w.a.branchId, expired!.id, { expiry: '2026-01-01', buckets: { available: 100 } });
    await makeBatch(w.a.id, w.a.branchId, expired!.id, { lot: 'L2', status: 'BLOCKED', buckets: { available: 100 } });
    await makeBatch(w.a.id, w.a.branchId, expired!.id, { lot: 'L3', buckets: { available: 1 } });
    // An archived product is not suggested; a minimum at the other branch is not this branch's.
    await setMin(w, inactive!.id, 10);
    await prisma().phProduct.update({ where: { id: inactive!.id }, data: { active: false } });
    await setMin(w, otherBranch!.id, 10, 0, w.a.branchIds[1]);
    // Stock of `above` at the other branch does not help `below` here, and stock here does not hide the other branch's gap.
    await makeBatch(w.a.id, w.a.branchIds[1], below!.id, { lot: 'ELSEWHERE', buckets: { available: 500 } });

    const got = dataOf(await ask(w.owner, poQueries.suggest, { restaurantId: w.a.id, branchId: w.a.branchId }));
    expect(got.map((s) => [s.productName, s.available, s.minQty, s.reorderQty, s.suggestedQty, s.baseUnitLabel])).toEqual([
      ['Below', 3, 10, 0, 7, 'tablet'],
      ['Expired', 1, 6, 0, 5, 'tablet'],
      ['Quarantined', 2, 5, 0, 3, 'tablet'],
      ['Reorder', 4, 10, 24, 24, 'tablet'],
    ]);
    expect(got[0]!.baseUnitId).toBe(below!.tablet);
    const there = dataOf(await ask(w.owner, poQueries.suggest, { restaurantId: w.a.id, branchId: w.a.branchIds[1] }));
    expect(there.map((s) => [s.productName, s.available, s.suggestedQty])).toEqual([['OtherBranch', 0, 10]]);
  });

  it('writes nothing, and narrows to a supplier’s earlier deliveries when one is named', async () => {
    const w = await world();
    await prisma().phProductBranch.createMany({
      data: [w.product.id, w.other.id].map((productId) => ({ restaurantId: w.a.id, branchId: w.a.branchId, productId, minQty: 5 })),
    });
    const receipt = await prisma().phReceipt.create({
      data: { restaurantId: w.a.id, branchId: w.a.branchId, clientKey: 'receipt-hist-1', receivedOn: NOW, createdById: w.owner.userId, supplierId: w.supplierId, status: 'CONFIRMED', number: 'R-000001' },
      select: { id: true },
    });
    await prisma().phReceiptLine.create({
      data: { restaurantId: w.a.id, receiptId: receipt.id, lineNo: 1, productId: w.other.id, unitId: w.other.strip, qty: 1, baseQty: 10, lot: 'H1', expiryDate: new Date('2028-01-01T00:00:00.000Z') },
    });
    const before = await prisma().auditLog.count();
    const all = dataOf(await ask(w.owner, poQueries.suggest, { restaurantId: w.a.id, branchId: w.a.branchId }));
    expect(all.map((s) => s.productName)).toEqual(['Brufen', 'Panadol']);
    const mine = dataOf(await ask(w.owner, poQueries.suggest, { restaurantId: w.a.id, branchId: w.a.branchId, supplierId: w.supplierId }));
    expect(mine.map((s) => s.productName)).toEqual(['Brufen']);
    expect(codeOf(await ask(w.owner, poQueries.suggest, { restaurantId: w.a.id, branchId: w.a.branchId, supplierId: 'nobody' }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(w.owner, poQueries.suggest, { restaurantId: w.a.id }))).toBe('INVALID');
    expect(await prisma().auditLog.count()).toBe(before);
    expect(await prisma().phPurchaseOrder.count()).toBe(0);
  });
});

describe('who may use purchase orders', () => {
  it('allows the holders of purchase.manage (BRANCH_MANAGER, PHARMACIST_IN_CHARGE, STOCK, ACCOUNTANT); refuses PHARMACIST, CASHIER and a support grant', async () => {
    const w = await world();
    const made = await draft(w);
    for (const role of ['BRANCH_MANAGER', 'PHARMACIST_IN_CHARGE', 'STOCK', 'ACCOUNTANT'] as const) {
      const who = await person(role.toLowerCase(), { staff: [w.a.id, role, [w.a.branchId]] });
      expect(codeOf(await act(who, poActions.create, body(w))), role).toBe('OK');
      expect(codeOf(await ask(who, poQueries.list, { restaurantId: w.a.id })), role).toBe('OK');
      expect(codeOf(await ask(who, poQueries.get, { restaurantId: w.a.id, branchId: w.a.branchId, purchaseOrderId: made.id })), role).toBe('OK');
      expect(codeOf(await ask(who, poQueries.suggest, { restaurantId: w.a.id, branchId: w.a.branchId })), role).toBe('OK');
    }
    const before = await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: made.id } });
    for (const role of ['PHARMACIST', 'CASHIER'] as const) {
      const who = await person(role.toLowerCase(), { staff: [w.a.id, role, [w.a.branchId]] });
      const target = ref(w, made.id, 1);
      expect(codeOf(await act(who, poActions.create, body(w))), role).toBe('FORBIDDEN');
      expect(codeOf(await act(who, poActions.update, edit(w, made.id, 1))), role).toBe('FORBIDDEN');
      expect(codeOf(await act(who, poActions.order, target)), role).toBe('FORBIDDEN');
      expect(codeOf(await act(who, poActions.cancel, target)), role).toBe('FORBIDDEN');
      expect(codeOf(await act(who, poActions.close, { ...target, reason: 'not allowed' })), role).toBe('FORBIDDEN');
      expect(codeOf(await ask(who, poQueries.list, { restaurantId: w.a.id })), role).toBe('FORBIDDEN');
      expect(codeOf(await ask(who, poQueries.get, { restaurantId: w.a.id, branchId: w.a.branchId, purchaseOrderId: made.id })), role).toBe('FORBIDDEN');
      expect(codeOf(await ask(who, poQueries.suggest, { restaurantId: w.a.id, branchId: w.a.branchId })), role).toBe('FORBIDDEN');
    }
    const admin = await person('support', { superAdmin: true });
    await grant(admin, w.a.id, { scopes: ['catalog.read', 'stock.read'] });
    const target = ref(w, made.id, 1);
    expect(codeOf(await act(admin, poActions.create, body(w)))).not.toBe('OK');
    expect(codeOf(await act(admin, poActions.order, target))).not.toBe('OK');
    expect(codeOf(await ask(admin, poQueries.list, { restaurantId: w.a.id }))).not.toBe('OK');
    expect(codeOf(await ask(admin, poQueries.get, { restaurantId: w.a.id, branchId: w.a.branchId, purchaseOrderId: made.id }))).not.toBe('OK');
    expect(await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: made.id } })).toEqual(before);
    expect(await prisma().phPurchaseOrder.count()).toBe(5);
  });
});

describe('another business', () => {
  it('treats a foreign order id as not found on get, update, order, cancel and close, and leaves it unchanged', async () => {
    const w = await world();
    const b = await pharmacy('B');
    const ownerB = await person('ownerb', { membership: [b.id, 'OWNER'] });
    const supplierB = await prisma().phSupplier.create({
      data: { restaurantId: b.id, name: 'Theirs', nameKey: 'theirs', defaultCurrency: 'IQD', clientKey: 'theirs-key-2', createdById: ownerB.userId },
      select: { id: true },
    });
    const productB = await makeProduct(b.id, 'Theirs');
    const theirs = dataOf(
      await act(ownerB, poActions.create, {
        restaurantId: b.id, branchId: b.branchId, clientKey: 'theirs-po-key-1', supplierId: supplierB.id, currency: 'IQD', lines: [lineOf(productB)],
      }),
    );
    const before = await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: theirs.id }, include: { lines: true } });
    expect(codeOf(await ask(w.owner, poQueries.get, { restaurantId: w.a.id, branchId: w.a.branchId, purchaseOrderId: theirs.id }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.owner, poActions.update, edit(w, theirs.id, 1)))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.owner, poActions.order, ref(w, theirs.id, 1)))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.owner, poActions.cancel, ref(w, theirs.id, 1)))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.owner, poActions.close, { ...ref(w, theirs.id, 1), reason: 'not mine' }))).toBe('NOT_FOUND');
    expect(await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: theirs.id }, include: { lines: true } })).toEqual(before);
    expect(dataOf(await ask(w.owner, poQueries.list, { restaurantId: w.a.id })).items).toHaveLength(0);
    // Naming B's pharmacy outright is refused by the framework.
    expect(codeOf(await ask(w.owner, poQueries.list, { restaurantId: b.id }))).not.toBe('OK');
    expect(codeOf(await act(w.owner, poActions.create, { ...body(w), restaurantId: b.id, branchId: b.branchId }))).not.toBe('OK');
  });
});

describe('branch isolation', () => {
  it('hides an order of branch 1 from a user limited to branch 2 (list, get, and every write), while the owner sees both', async () => {
    const w = await world();
    const o = await placed(w);
    const other = await placed(w, { branchId: w.a.branchIds[1] });
    const clerk = await person('clerk2', { staff: [w.a.id, 'ACCOUNTANT', [w.a.branchIds[1]!]] });
    const mine = dataOf(await ask(clerk, poQueries.list, { restaurantId: w.a.id, branchId: w.a.branchIds[1] }));
    expect(mine.items.map((i) => i.id)).toEqual([other.id]);
    expect(dataOf(await ask(clerk, poQueries.list, { restaurantId: w.a.id })).items.map((i) => i.id)).toEqual([other.id]);
    expect(codeOf(await ask(clerk, poQueries.get, { restaurantId: w.a.id, branchId: w.a.branchIds[1], purchaseOrderId: o.id }))).toBe('NOT_FOUND');
    const target = { restaurantId: w.a.id, branchId: w.a.branchIds[1], purchaseOrderId: o.id, expectedVersion: o.version };
    expect(codeOf(await act(clerk, poActions.update, edit(w, o.id, o.version, { branchId: w.a.branchIds[1] })))).toBe('NOT_FOUND');
    expect(codeOf(await act(clerk, poActions.order, target))).toBe('NOT_FOUND');
    expect(codeOf(await act(clerk, poActions.cancel, target))).toBe('NOT_FOUND');
    expect(codeOf(await act(clerk, poActions.close, { ...target, reason: 'not my branch' }))).toBe('NOT_FOUND');
    // Naming branch 1 itself is refused.
    expect(codeOf(await act(clerk, poActions.create, body(w)))).not.toBe('OK');
    expect(codeOf(await ask(clerk, poQueries.suggest, { restaurantId: w.a.id, branchId: w.a.branchId }))).not.toBe('OK');
    expect(await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: 'ORDERED', version: 2 });
    const all = dataOf(await ask(w.owner, poQueries.list, { restaurantId: w.a.id }));
    expect(all.items.map((i) => i.id).sort()).toEqual([o.id, other.id].sort());
  });
});
