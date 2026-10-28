import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as poActions from '@/server/pharmacy/actions/purchase-orders';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import * as poQueries from '@/server/pharmacy/queries/purchase-orders';
import * as receiptQueries from '@/server/pharmacy/queries/receipts';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask, codeOf, dataOf, makeProduct, phCodeOf } from './stock-helpers';

let keySeq = 0;
type World = Awaited<ReturnType<typeof world>>;
type P = { id: string; tablet: string; strip: string };

async function world() {
  const a = await pharmacy('A', { branches: 2 });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const mkSupplier = (name: string) =>
    prisma().phSupplier.create({
      data: { restaurantId: a.id, name, nameKey: name.toLowerCase(), defaultCurrency: 'IQD', clientKey: `sup-${(keySeq += 1)}-aaaa`, createdById: owner.userId },
      select: { id: true },
    });
  const supplier = await mkSupplier('Al-Noor');
  const supplierB = await mkSupplier('Beta Pharma');
  const p = await makeProduct(a.id, 'Panadol');
  const q = await makeProduct(a.id, 'Brufen');
  return { a, owner, supplierId: supplier.id, supplierB: supplierB.id, p, q };
}

const poLine = (p: P, over: Record<string, unknown> = {}) => ({ productId: p.id, unitId: p.strip, qtyOrdered: 100, bonusOrdered: 10, unitCostMinor: '2500', ...over });

/** An ORDERED order of branch 0 (or `branch`): Panadol 100 + 10 bonus at 2500, Brufen 20 at 1000. */
async function ordered(w: World, over: Record<string, unknown> = {}, branch = 0) {
  const made = dataOf(
    await act(w.owner, poActions.create, {
      restaurantId: w.a.id,
      branchId: w.a.branchIds[branch],
      clientKey: `po-key-${(keySeq += 1)}-aaaa`,
      supplierId: w.supplierId,
      currency: 'IQD',
      lines: [poLine(w.p), poLine(w.q, { qtyOrdered: 20, bonusOrdered: 0, unitCostMinor: '1000' })],
      ...over,
    }),
  );
  const placedOrder = dataOf(await act(w.owner, poActions.order, { restaurantId: w.a.id, branchId: w.a.branchIds[branch], purchaseOrderId: made.id, expectedVersion: 1 }));
  const lines = await prisma().phPurchaseOrderLine.findMany({ where: { purchaseOrderId: made.id }, orderBy: { lineNo: 'asc' } });
  return { id: made.id, version: placedOrder.version, branch, pLine: lines[0]!.id, qLine: lines[1]?.id ?? '' };
}
type Order = Awaited<ReturnType<typeof ordered>>;

const rLine = (p: P, orderLineId: string | undefined, over: Record<string, unknown> = {}) => ({
  productId: p.id,
  unitId: p.strip,
  qty: 60,
  lot: 'l-100',
  expiry: '2028-03-15',
  unitCostMinor: '2500',
  currency: 'IQD',
  ...(orderLineId ? { purchaseOrderLineId: orderLineId } : {}),
  ...over,
});

const receiptBody = (w: World, lines: unknown[], over: Record<string, unknown> = {}, branch = 0) => ({
  restaurantId: w.a.id,
  branchId: w.a.branchIds[branch],
  clientKey: `rcpt-key-${(keySeq += 1)}-aaaa`,
  supplierName: '',
  reference: 'INV-1',
  receivedOn: '2026-10-27',
  lines,
  ...over,
});

const place = (w: World, receiptId: string, branch = 0) => ({ restaurantId: w.a.id, branchId: w.a.branchIds[branch], receiptId });
const draftFor = async (w: World, o: Order, lines: unknown[], over: Record<string, unknown> = {}) =>
  dataOf(await act(w.owner, receiptActions.create, receiptBody(w, lines, { purchaseOrderId: o.id, ...over }, o.branch)));
const confirmIt = (w: World, o: Order, receiptId: string) => act(w.owner, receiptActions.confirm, place(w, receiptId, o.branch));
const counters = async (o: Order) => {
  const rows = await prisma().phPurchaseOrderLine.findMany({ where: { purchaseOrderId: o.id }, orderBy: { lineNo: 'asc' }, select: { receivedQty: true, receivedBonus: true } });
  return rows.map((r) => [r.receivedQty, r.receivedBonus]);
};
const orderRow = (o: Order) => prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: o.id } });

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

describe('receiving against an order', () => {
  it('receives 60 then 40 + 10: ORDERED -> PARTIAL -> RECEIVED with exact counters, versions and audit', async () => {
    const w = await world();
    const o = await ordered(w);
    const first = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 60 })]);
    expect(await counters(o)).toEqual([[0, 0], [0, 0]]); // a draft touches no counters
    expect(await orderRow(o)).toMatchObject({ status: 'ORDERED', version: 2 });

    dataOf(await confirmIt(w, o, first.id));
    expect(await counters(o)).toEqual([[60, 0], [0, 0]]);
    expect(await orderRow(o)).toMatchObject({ status: 'PARTIAL', version: 3 });

    const second = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 40, bonusQty: 10, lot: 'l-200' }), rLine(w.q, o.qLine, { qty: 20, lot: 'q-1' })]);
    dataOf(await confirmIt(w, o, second.id));
    expect(await counters(o)).toEqual([[100, 10], [20, 0]]);
    expect(await orderRow(o)).toMatchObject({ status: 'RECEIVED', version: 4 });

    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.receipt.confirm', entityId: second.id } });
    expect(audit.changes).toMatchObject({ purchaseOrderId: { after: o.id }, orderStatus: { before: 'PARTIAL', after: 'RECEIVED' } });
    const first_ = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.receipt.confirm', entityId: first.id } });
    expect(first_.changes).toMatchObject({ orderStatus: { before: 'ORDERED', after: 'PARTIAL' } });
  });

  it('allows a second partial receipt on a PARTIAL order (PARTIAL -> PARTIAL)', async () => {
    const w = await world();
    const o = await ordered(w);
    for (const lot of ['a-1', 'a-2']) {
      const r = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 30, lot })]);
      dataOf(await confirmIt(w, o, r.id));
      expect(await orderRow(o)).toMatchObject({ status: 'PARTIAL' });
    }
    expect(await counters(o)).toEqual([[60, 0], [0, 0]]);
    expect(await orderRow(o)).toMatchObject({ version: 4 });
  });

  it('makes the same batch, balance and movement as a plain receipt', async () => {
    const w = await world();
    const o = await ordered(w);
    const against = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 5, bonusQty: 1, lot: 'same-1' })]);
    dataOf(await confirmIt(w, o, against.id));
    const plain = dataOf(await act(w.owner, receiptActions.create, receiptBody(w, [rLine(w.q, undefined, { qty: 5, bonusQty: 1, lot: 'same-1' })])));
    dataOf(await act(w.owner, receiptActions.confirm, place(w, plain.id)));
    const shape = async (productId: string, strip: string, receiptId: string) => {
      const batch = await prisma().phBatch.findFirstOrThrow({ where: { productId } });
      const bal = await prisma().phStockBalance.findFirstOrThrow({ where: { batchId: batch.id } });
      const moves = await prisma().phStockMovement.findMany({ where: { receiptId } });
      return {
        batch: { lot: batch.lot, unitCostMinor: batch.unitCostMinor, costCurrency: batch.costCurrency, costUnitIsStrip: batch.costUnitId === strip },
        bal: { available: bal.available, quarantine: bal.quarantine },
        moves: moves.map((m) => [m.type, m.availableDelta]),
      };
    };
    expect(await prisma().phReceipt.findUniqueOrThrow({ where: { id: against.id } })).toMatchObject({ purchaseOrderId: o.id, status: 'CONFIRMED' });
    expect(await orderRow(o)).toMatchObject({ status: 'PARTIAL' });
    expect(await shape(w.p.id, w.p.strip, against.id)).toEqual(await shape(w.q.id, w.q.strip, plain.id));
    expect((await shape(w.p.id, w.p.strip, against.id)).moves).toEqual([['RECEIPT', 60]]);
  });

  it('fills the supplier from the order, stores both ids, and the plain phase 2 receipt stays supplier-less', async () => {
    const w = await world();
    const o = await ordered(w);
    const made = await draftFor(w, o, [rLine(w.p, o.pLine)]);
    expect(await prisma().phReceipt.findUniqueOrThrow({ where: { id: made.id }, include: { lines: true } })).toMatchObject({
      supplierId: w.supplierId,
      purchaseOrderId: o.id,
      supplierName: 'Al-Noor',
      lines: [{ purchaseOrderLineId: o.pLine }],
    });
    const named = await draftFor(w, o, [rLine(w.p, o.pLine)], { supplierName: 'Typed name', supplierId: w.supplierId });
    expect(await prisma().phReceipt.findUniqueOrThrow({ where: { id: named.id } })).toMatchObject({ supplierName: 'Typed name', supplierId: w.supplierId });
    const plain = dataOf(await act(w.owner, receiptActions.create, receiptBody(w, [rLine(w.p, undefined)])));
    expect(await prisma().phReceipt.findUniqueOrThrow({ where: { id: plain.id } })).toMatchObject({ supplierId: null, purchaseOrderId: null });
  });

  it('takes a supplier without an order (active supplier only) and fills the name', async () => {
    const w = await world();
    const made = dataOf(await act(w.owner, receiptActions.create, receiptBody(w, [rLine(w.p, undefined)], { supplierId: w.supplierB })));
    expect(await prisma().phReceipt.findUniqueOrThrow({ where: { id: made.id } })).toMatchObject({ supplierId: w.supplierB, supplierName: 'Beta Pharma', purchaseOrderId: null });
    dataOf(await act(w.owner, receiptActions.confirm, place(w, made.id)));
    await prisma().phSupplier.update({ where: { id: w.supplierB }, data: { active: false } });
    const refused = await act(w.owner, receiptActions.create, receiptBody(w, [rLine(w.p, undefined, { lot: 'x' })], { supplierId: w.supplierB }));
    expect(codeOf(refused)).toBe('CONFLICT');
    expect(phCodeOf(refused)).toBe('SUPPLIER_ARCHIVED');
    expect(codeOf(await act(w.owner, receiptActions.create, receiptBody(w, [rLine(w.p, undefined)], { supplierId: 'no-such-supplier' })))).toBe('NOT_FOUND');
  });

  it('replays the same key and payload for an order receipt, and refuses a different order or line', async () => {
    const w = await world();
    const o = await ordered(w);
    const body = receiptBody(w, [rLine(w.p, o.pLine)], { purchaseOrderId: o.id });
    const first = dataOf(await act(w.owner, receiptActions.create, body));
    expect(dataOf(await act(w.owner, receiptActions.create, body))).toMatchObject({ id: first.id, replayed: true });
    expect(await prisma().phReceipt.count()).toBe(1);
    const other = await ordered(w);
    const mismatch = await act(w.owner, receiptActions.create, { ...body, purchaseOrderId: other.id, lines: [rLine(w.p, other.pLine)] });
    expect(phCodeOf(mismatch)).toBe('CLIENT_KEY_MISMATCH');
    const sameOrderOtherLine = await act(w.owner, receiptActions.create, { ...body, lines: [rLine(w.q, o.qLine)] });
    expect(phCodeOf(sameOrderOtherLine)).toBe('CLIENT_KEY_MISMATCH');
  });

  it('is strict about the supplier on a replay: omitting a stored supplier is a mismatch, naming it is the same request', async () => {
    const w = await world();
    const body = receiptBody(w, [rLine(w.p, undefined)], { supplierId: w.supplierB });
    const first = dataOf(await act(w.owner, receiptActions.create, body));
    expect(dataOf(await act(w.owner, receiptActions.create, body))).toMatchObject({ id: first.id, replayed: true });
    expect(phCodeOf(await act(w.owner, receiptActions.create, { ...body, supplierId: undefined }))).toBe('CLIENT_KEY_MISMATCH');
    // Renaming the supplier afterwards does not break a repeat that left the name empty.
    await prisma().phSupplier.update({ where: { id: w.supplierB }, data: { name: 'Renamed' } });
    expect(dataOf(await act(w.owner, receiptActions.create, body))).toMatchObject({ id: first.id, replayed: true });
    // An order receipt that omits supplierId replays (the order's supplier is the stored one).
    const o = await ordered(w);
    const ob = receiptBody(w, [rLine(w.p, o.pLine)], { purchaseOrderId: o.id });
    const ofirst = dataOf(await act(w.owner, receiptActions.create, ob));
    expect(dataOf(await act(w.owner, receiptActions.create, ob))).toMatchObject({ id: ofirst.id, replayed: true });
  });

  it('updates a draft: change the order lines, drop the order, and re-validate the order', async () => {
    const w = await world();
    const o = await ordered(w);
    const made = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 5 })]);
    const upd = { ...receiptBody(w, [rLine(w.p, o.pLine, { qty: 7 })], { purchaseOrderId: o.id }), receiptId: made.id, expectedVersion: 1 };
    const { clientKey, ...rest } = upd;
    void clientKey;
    dataOf(await act(w.owner, receiptActions.update, rest));
    expect(await prisma().phReceiptLine.findFirstOrThrow({ where: { receiptId: made.id } })).toMatchObject({ qty: 7, purchaseOrderLineId: o.pLine });
    // Dropping the order: the lines may then carry no order line.
    const dropped = { ...rest, expectedVersion: 2, purchaseOrderId: undefined, lines: [rLine(w.p, undefined, { qty: 7 })] };
    dataOf(await act(w.owner, receiptActions.update, dropped));
    expect(await prisma().phReceipt.findUniqueOrThrow({ where: { id: made.id } })).toMatchObject({ purchaseOrderId: null, supplierId: null });
    // Once the order is cancelled, a draft cannot be saved against it.
    dataOf(await act(w.owner, poActions.cancel, { restaurantId: w.a.id, branchId: w.a.branchIds[0], purchaseOrderId: o.id, expectedVersion: o.version }));
    const again = await act(w.owner, receiptActions.update, { ...rest, expectedVersion: 3 });
    expect(phCodeOf(again)).toBe('ORDER_NOT_OPEN');
  });

  it('audits a change of order or supplier when a draft is saved (ids before and after)', async () => {
    const w = await world();
    const x = await ordered(w);
    const y = await ordered(w);
    const made = await draftFor(w, x, [rLine(w.p, x.pLine)]);
    const { clientKey, ...rest } = receiptBody(w, [rLine(w.p, y.pLine)], { purchaseOrderId: y.id });
    void clientKey;
    dataOf(await act(w.owner, receiptActions.update, { ...rest, receiptId: made.id, expectedVersion: 1 }));
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.receipt.update', entityId: made.id } });
    expect(audit.changes).toMatchObject({ purchaseOrderId: { before: x.id, after: y.id } });
    // Nothing changed about the order or supplier: no such keys.
    dataOf(await act(w.owner, receiptActions.update, { ...rest, receiptId: made.id, expectedVersion: 2, note: 'again' }));
    const again = await prisma().auditLog.findMany({ where: { action: 'ph.receipt.update', entityId: made.id }, });
    const second = again.find((a) => JSON.stringify(a.changes).includes('"before":2'));
    expect(second).toBeTruthy();
    expect(JSON.stringify(second!.changes)).not.toContain('purchaseOrderId');
  });

  it('lets a draft receipt for an order be voided freely, and a confirmed one never', async () => {
    const w = await world();
    const o = await ordered(w);
    const d = await draftFor(w, o, [rLine(w.p, o.pLine)]);
    dataOf(await act(w.owner, receiptActions.voidReceipt, place(w, d.id)));
    const e = await draftFor(w, o, [rLine(w.p, o.pLine, { lot: 'v-2' })]);
    dataOf(await confirmIt(w, o, e.id));
    expect(phCodeOf(await act(w.owner, receiptActions.voidReceipt, place(w, e.id)))).toBe('NOT_DRAFT');
    expect(await counters(o)).toEqual([[60, 0], [0, 0]]);
  });
});

describe('over-receipt', () => {
  it('refuses quantity beyond what was ordered, and bonus beyond the bonus ordered, separately', async () => {
    const w = await world();
    const o = await ordered(w);
    const tooMany = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 101 })]);
    const r1 = await confirmIt(w, o, tooMany.id);
    expect(codeOf(r1)).toBe('CONFLICT');
    expect(phCodeOf(r1)).toBe('OVER_RECEIPT');
    const tooMuchBonus = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 1, bonusQty: 11, lot: 'b-1' })]);
    expect(phCodeOf(await confirmIt(w, o, tooMuchBonus.id))).toBe('OVER_RECEIPT');
    // Bonus with no bonus ordered at all.
    const bonusOnQ = await draftFor(w, o, [rLine(w.q, o.qLine, { qty: 1, bonusQty: 1, lot: 'b-2' })]);
    expect(phCodeOf(await confirmIt(w, o, bonusOnQ.id))).toBe('OVER_RECEIPT');
    // Nothing moved: receipts stay drafts, no stock, counters at zero, order untouched.
    expect(await counters(o)).toEqual([[0, 0], [0, 0]]);
    expect(await orderRow(o)).toMatchObject({ status: 'ORDERED', version: 2 });
    expect(await prisma().phReceipt.count({ where: { status: 'CONFIRMED' } })).toBe(0);
    expect(await prisma().phStockMovement.count()).toBe(0);
    // Exactly the ordered amounts are fine.
    const exact = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 100, bonusQty: 10, lot: 'ok-1' })]);
    dataOf(await confirmIt(w, o, exact.id));
  });

  it('counts across earlier confirmed receipts, and sums two lines of one order line in one receipt', async () => {
    const w = await world();
    const o = await ordered(w);
    const one = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 60 })]);
    dataOf(await confirmIt(w, o, one.id));
    const two = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 41, lot: 'l-2' })]);
    expect(phCodeOf(await confirmIt(w, o, two.id))).toBe('OVER_RECEIPT');
    expect(await counters(o)).toEqual([[60, 0], [0, 0]]);
    // 20 + 21 in two lots of one receipt: 101 in total.
    const split = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 20, lot: 's-1' }), rLine(w.p, o.pLine, { qty: 21, lot: 's-2' })]);
    expect(phCodeOf(await confirmIt(w, o, split.id))).toBe('OVER_RECEIPT');
    const fits = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 20, lot: 's-1' }), rLine(w.p, o.pLine, { qty: 20, lot: 's-2' })]);
    dataOf(await confirmIt(w, o, fits.id));
    expect(await counters(o)).toEqual([[100, 0], [0, 0]]);
    expect(await orderRow(o)).toMatchObject({ status: 'PARTIAL' }); // bonus (10) and Brufen still to come
  });
});

describe('what may be received against an order', () => {
  it('refuses a line that is not on the order: another order, another branch, another product or unit, or no order line (NOT_ON_ORDER)', async () => {
    const w = await world();
    const o = await ordered(w);
    const other = await ordered(w);
    const elsewhere = await ordered(w, {}, 1);
    const cases: [string, unknown][] = [
      ['another order of the branch', rLine(w.p, other.pLine)],
      ['an order of another branch', rLine(w.p, elsewhere.pLine)],
      ['a different product', rLine(w.q, o.pLine)],
      ['a different unit', rLine(w.p, o.pLine, { unitId: w.p.tablet })],
      ['no order line', rLine(w.p, undefined)],
      ['an order line that does not exist', rLine(w.p, 'no-such-line')],
    ];
    for (const [label, line] of cases) {
      const refused = await act(w.owner, receiptActions.create, receiptBody(w, [line], { purchaseOrderId: o.id }));
      expect([label, codeOf(refused), phCodeOf(refused)]).toEqual([label, 'INVALID', 'NOT_ON_ORDER']);
    }
    // No order at all: a line may not name an order line either.
    const stray = await act(w.owner, receiptActions.create, receiptBody(w, [rLine(w.p, o.pLine)]));
    expect(phCodeOf(stray)).toBe('NOT_ON_ORDER');
    expect(await prisma().phReceipt.count()).toBe(0);
  });

  it('does not find the order of another branch or another business', async () => {
    const w = await world();
    const elsewhere = await ordered(w, {}, 1);
    const wrongBranch = await act(w.owner, receiptActions.create, receiptBody(w, [rLine(w.p, elsewhere.pLine)], { purchaseOrderId: elsewhere.id }));
    expect(codeOf(wrongBranch)).toBe('NOT_FOUND');
    const b = await pharmacy('B');
    const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
    const o = await ordered(w);
    const foreign = await act(ownerB, receiptActions.create, { ...receiptBody(w, [rLine(w.p, o.pLine)], { purchaseOrderId: o.id }), restaurantId: b.id, branchId: b.branchId });
    expect(codeOf(foreign)).toBe('NOT_FOUND');
  });

  it('refuses a supplier that is not the order’s (SUPPLIER_MISMATCH) and accepts the order’s own', async () => {
    const w = await world();
    const o = await ordered(w);
    const refused = await act(w.owner, receiptActions.create, receiptBody(w, [rLine(w.p, o.pLine)], { purchaseOrderId: o.id, supplierId: w.supplierB }));
    expect(codeOf(refused)).toBe('INVALID');
    expect(phCodeOf(refused)).toBe('SUPPLIER_MISMATCH');
    dataOf(await act(w.owner, receiptActions.create, receiptBody(w, [rLine(w.p, o.pLine)], { purchaseOrderId: o.id, supplierId: w.supplierId })));
  });

  it('refuses an order that is not open at create (ORDER_NOT_OPEN): DRAFT, RECEIVED, CLOSED, CANCELLED', async () => {
    const w = await world();
    const o = await ordered(w);
    const lineOfDraft = (id: string) => prisma().phPurchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: id, lineNo: 1 } });
    const draftOrder = dataOf(
      await act(w.owner, poActions.create, {
        restaurantId: w.a.id,
        branchId: w.a.branchIds[0],
        clientKey: `po-key-${(keySeq += 1)}-aaaa`,
        supplierId: w.supplierId,
        currency: 'IQD',
        lines: [poLine(w.p)],
      }),
    );
    const cancelled = await ordered(w);
    dataOf(await act(w.owner, poActions.cancel, { restaurantId: w.a.id, branchId: w.a.branchIds[0], purchaseOrderId: cancelled.id, expectedVersion: cancelled.version }));
    const closed = await ordered(w);
    dataOf(await act(w.owner, poActions.close, { restaurantId: w.a.id, branchId: w.a.branchIds[0], purchaseOrderId: closed.id, expectedVersion: closed.version, reason: 'supplier stopped' }));
    const done = await ordered(w);
    await prisma().phPurchaseOrder.update({ where: { id: done.id }, data: { status: 'RECEIVED' } });
    const targets: [string, string, string][] = [
      ['DRAFT', draftOrder.id, (await lineOfDraft(draftOrder.id)).id],
      ['CANCELLED', cancelled.id, cancelled.pLine],
      ['CLOSED', closed.id, closed.pLine],
      ['RECEIVED', done.id, done.pLine],
    ];
    for (const [label, id, lineId] of targets) {
      const refused = await act(w.owner, receiptActions.create, receiptBody(w, [rLine(w.p, lineId)], { purchaseOrderId: id }));
      expect([label, codeOf(refused), phCodeOf(refused)]).toEqual([label, 'CONFLICT', 'ORDER_NOT_OPEN']);
    }
    expect(o.id).toBeTruthy();
  });

  it('refuses at confirm an order cancelled or closed after the draft was made, leaving no stock or counters', async () => {
    const w = await world();
    const a = await ordered(w);
    const b = await ordered(w);
    const da = await draftFor(w, a, [rLine(w.p, a.pLine)]);
    const db = await draftFor(w, b, [rLine(w.p, b.pLine, { lot: 'other' })]);
    dataOf(await act(w.owner, poActions.cancel, { restaurantId: w.a.id, branchId: w.a.branchIds[0], purchaseOrderId: a.id, expectedVersion: a.version }));
    dataOf(await act(w.owner, poActions.close, { restaurantId: w.a.id, branchId: w.a.branchIds[0], purchaseOrderId: b.id, expectedVersion: b.version, reason: 'supplier stopped' }));
    for (const [o, d] of [[a, da], [b, db]] as const) {
      const refused = await confirmIt(w, o, d.id);
      expect([codeOf(refused), phCodeOf(refused)]).toEqual(['CONFLICT', 'ORDER_NOT_OPEN']);
      expect(await counters(o)).toEqual([[0, 0], [0, 0]]);
    }
    expect(await prisma().phStockMovement.count()).toBe(0);
    expect(await prisma().phReceipt.count({ where: { status: 'DRAFT' } })).toBe(2);
  });
});

describe('races', () => {
  it('lets exactly one of two receipts racing for the last ordered units confirm, with no deadlock', async () => {
    const w = await world();
    const o = await ordered(w, { lines: [poLine(w.p, { qtyOrdered: 10, bonusOrdered: 0 })] });
    const d1 = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 6, lot: 'r-1' })]);
    const d2 = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 6, lot: 'r-2' })]);
    const results = await Promise.all([confirmIt(w, o, d1.id), confirmIt(w, o, d2.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map(phCodeOf)).toEqual(['OVER_RECEIPT']);
    expect(await counters(o)).toEqual([[6, 0]]);
    expect(await prisma().phStockMovement.count()).toBe(1);
    // Many at once: 5 receipts of 4 against 10 -> two fit.
    const o2 = await ordered(w, { lines: [poLine(w.p, { qtyOrdered: 10, bonusOrdered: 0 })] });
    const drafts = await Promise.all([1, 2, 3, 4, 5].map((n) => draftFor(w, o2, [rLine(w.p, o2.pLine, { qty: 4, lot: `m-${n}` })])));
    const many = await Promise.all(drafts.map((d) => confirmIt(w, o2, d.id)));
    expect(many.filter((r) => r.ok)).toHaveLength(2);
    expect(many.filter((r) => !r.ok).map(phCodeOf)).toEqual(['OVER_RECEIPT', 'OVER_RECEIPT', 'OVER_RECEIPT']);
    expect(await counters(o2)).toEqual([[8, 0]]);
    expect(await prisma().phStockMovement.count({ where: { receiptId: { in: drafts.map((d) => d.id) } } })).toBe(2);
  });

  it('serialises a confirm with a cancel: never CANCELLED with received counters', async () => {
    const w = await world();
    const outcomes = new Set<string>();
    // The cancel always carries the order's current version, so only the row lock (and the received check) can stop it.
    for (let round = 0; round < 40 && outcomes.size < 2; round += 1) {
      const o = await ordered(w);
      const d = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 5, lot: `c-${round}` })]);
      const current = (await orderRow(o)).version;
      // The cancel starts after 0 to 120 ms, so over the rounds each side gets to the order row first.
      const delay = [0, 15, 40, 120][round % 4]!;
      const cancelNow = async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return act(w.owner, poActions.cancel, { restaurantId: w.a.id, branchId: w.a.branchIds[0], purchaseOrderId: o.id, expectedVersion: current });
      };
      const [confirmed, cancelled] = await Promise.all([confirmIt(w, o, d.id), cancelNow()]);
      const row = await orderRow(o);
      const got = await counters(o);
      if (confirmed.ok) {
        outcomes.add('confirm');
        expect(codeOf(cancelled)).toBe('CONFLICT'); // the stale version, or something was received
        expect(row.status).toBe('PARTIAL');
        expect(got[0]).toEqual([5, 0]);
      } else {
        outcomes.add('cancel');
        expect(cancelled.ok).toBe(true);
        expect(codeOf(confirmed)).toBe('CONFLICT');
        expect(phCodeOf(confirmed)).toBe('ORDER_NOT_OPEN');
        expect(row.status).toBe('CANCELLED');
        expect(got).toEqual([[0, 0], [0, 0]]);
      }
    }
    expect([...outcomes].sort()).toEqual(['cancel', 'confirm']);
  });

  it('serialises saving a draft (switching or dropping its order) with confirming it: counters equal what was confirmed, no raw errors', async () => {
    const w = await world();
    const x = await ordered(w);
    const y = await ordered(w);
    const saves = (d: { id: string }, to: 'Y' | 'none') => {
      const target = to === 'Y' ? y : null;
      const { clientKey, ...rest } = receiptBody(w, [rLine(w.p, target ? target.pLine : undefined, { qty: 5, lot: 'sw-1' })], target ? { purchaseOrderId: target.id } : {});
      void clientKey;
      return act(w.owner, receiptActions.update, { ...rest, receiptId: d.id, expectedVersion: 1 });
    };
    const seen = new Set<string>();
    for (let round = 0; round < 24; round += 1) {
      const kind = (['X>Y', 'X>none', 'none>Y'] as const)[round % 3]!;
      const from = kind === 'none>Y' ? 'none' : 'X';
      const lines = [rLine(w.p, from === 'X' ? x.pLine : undefined, { qty: 5, lot: `sw-${round}` })];
      const d = dataOf(await act(w.owner, receiptActions.create, receiptBody(w, lines, from === 'X' ? { purchaseOrderId: x.id } : {})));
      const save = () => saves(d, kind === 'X>none' ? 'none' : 'Y');
      const results = round % 2 === 0 ? await Promise.all([confirmIt(w, x, d.id), save()]) : (await Promise.all([save(), confirmIt(w, x, d.id)])).reverse();
      for (const r of results) {
        if (!r.ok) expect(codeOf(r), JSON.stringify(r)).toBe('CONFLICT'); // never a raw database error
        seen.add(r.ok ? 'ok' : 'refused');
      }
      // The invariant: every order line's counters are the sum of its CONFIRMED receipt lines.
      for (const o of [x, y]) {
        const rows = await prisma().phPurchaseOrderLine.findMany({ where: { purchaseOrderId: o.id }, select: { id: true, receivedQty: true, receivedBonus: true } });
        for (const row of rows) {
          const confirmed = await prisma().phReceiptLine.aggregate({
            where: { purchaseOrderLineId: row.id, receipt: { status: 'CONFIRMED' } },
            _sum: { qty: true, bonusQty: true },
          });
          expect([o.id, row.id, row.receivedQty, row.receivedBonus]).toEqual([o.id, row.id, confirmed._sum.qty ?? 0, confirmed._sum.bonusQty ?? 0]);
        }
      }
      // A confirmed receipt's order link and its lines agree.
      const final = await prisma().phReceipt.findUniqueOrThrow({ where: { id: d.id }, include: { lines: true } });
      if (final.status === 'CONFIRMED') expect(final.lines.every((l) => (l.purchaseOrderLineId === null) === (final.purchaseOrderId === null))).toBe(true);
    }
    expect(seen.has('ok')).toBe(true);
  });

  it('does not double count when a confirm is repeated or raced', async () => {
    const w = await world();
    const o = await ordered(w);
    const d = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 30 })]);
    const results = await Promise.all([1, 2, 3].map(() => confirmIt(w, o, d.id)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await counters(o)).toEqual([[30, 0], [0, 0]]);
    expect(phCodeOf(await confirmIt(w, o, d.id))).toBe('NOT_DRAFT');
    expect(await counters(o)).toEqual([[30, 0], [0, 0]]);
    expect(await orderRow(o)).toMatchObject({ status: 'PARTIAL', version: 3 });
  });
});

describe('reading', () => {
  it('shows supplier, order and order line on get and list, and the order cost beside the received cost only with cost.view', async () => {
    const w = await world();
    const o = await ordered(w);
    const d = await draftFor(w, o, [rLine(w.p, o.pLine, { unitCostMinor: '3000' })]);
    const done = dataOf(await confirmIt(w, o, d.id)); // a different cost is never blocked
    expect(done.warnings).toEqual([]);
    const batch = await prisma().phBatch.findFirstOrThrow();
    expect(batch.unitCostMinor).toBe(3000n);
    const po = await prisma().phPurchaseOrder.findUniqueOrThrow({ where: { id: o.id } });

    const full = dataOf(await ask(w.owner, receiptQueries.get, { restaurantId: w.a.id, receiptId: d.id }));
    expect(full).toMatchObject({ supplierId: w.supplierId, supplierName: 'Al-Noor', purchaseOrderId: o.id, purchaseOrderNumber: po.number });
    expect(full.lines[0]).toMatchObject({ purchaseOrderLineId: o.pLine, unitCostMinor: '3000', orderUnitCostMinor: '2500', orderCurrency: 'IQD' });
    const list = dataOf(await ask(w.owner, receiptQueries.list, { restaurantId: w.a.id }));
    expect(list.items[0]).toMatchObject({ supplierId: w.supplierId, purchaseOrderId: o.id, purchaseOrderNumber: po.number });

    const pharmacist = await person('rph', { staff: [w.a.id, 'PHARMACIST', [w.a.branchIds[0]!]] });
    const seen = dataOf(await ask(pharmacist, receiptQueries.get, { restaurantId: w.a.id, receiptId: d.id }));
    expect(JSON.stringify(seen)).not.toMatch(/2500|3000|unitCost|orderUnitCost|orderCurrency|currency/);
    expect(seen.lines[0]).toMatchObject({ purchaseOrderLineId: o.pLine });
    const plain = dataOf(await act(w.owner, receiptActions.create, receiptBody(w, [rLine(w.q, undefined)])));
    const plainGot = dataOf(await ask(w.owner, receiptQueries.get, { restaurantId: w.a.id, receiptId: plain.id }));
    expect(plainGot).toMatchObject({ supplierId: null, purchaseOrderId: null, purchaseOrderNumber: null });
    expect(plainGot.lines[0]).toMatchObject({ purchaseOrderLineId: null });
  });

  it('lists the receipts of an order (ph.po.receipts): confirmed and draft, not void, with lines', async () => {
    const w = await world();
    const o = await ordered(w);
    const c = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 10, bonusQty: 2, lot: 'k-1' })]);
    dataOf(await confirmIt(w, o, c.id));
    const dr = await draftFor(w, o, [rLine(w.q, o.qLine, { qty: 3, lot: 'k-2', expiry: '2029-01-31' })]);
    const v = await draftFor(w, o, [rLine(w.p, o.pLine, { qty: 1, lot: 'k-3' })]);
    dataOf(await act(w.owner, receiptActions.voidReceipt, place(w, v.id)));
    const plain = dataOf(await act(w.owner, receiptActions.create, receiptBody(w, [rLine(w.q, undefined, { lot: 'k-4' })])));
    expect(plain.id).toBeTruthy();

    const got = dataOf(await ask(w.owner, poQueries.receipts, { restaurantId: w.a.id, branchId: w.a.branchIds[0], purchaseOrderId: o.id }));
    expect(got.map((r) => [r.id, r.status, r.number])).toEqual([[c.id, 'CONFIRMED', 'R-000001'], [dr.id, 'DRAFT', null]]);
    expect(got[0]).toMatchObject({ receivedOn: '2026-10-27' });
    expect(got[0]!.lines).toEqual([
      expect.objectContaining({ purchaseOrderLineId: o.pLine, productName: 'Panadol', qty: 10, bonusQty: 2, lot: 'K-1', expiryDate: '2028-03-15' }),
    ]);
    expect(got[1]!.lines[0]).toMatchObject({ purchaseOrderLineId: o.qLine, lot: 'K-2', expiryDate: '2029-01-31' });
    // The order's own get still reads the counters.
    const detail = dataOf(await ask(w.owner, poQueries.get, { restaurantId: w.a.id, purchaseOrderId: o.id }));
    expect(detail.lines[0]).toMatchObject({ receivedQty: 10, receivedBonus: 2 });
  });

  it('does not show another business’s or an unknown order’s receipts', async () => {
    const w = await world();
    const o = await ordered(w);
    const b = await pharmacy('B');
    const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
    const refused = await ask(ownerB, poQueries.receipts, { restaurantId: b.id, branchId: b.branchId, purchaseOrderId: o.id });
    expect(refused.ok).toBe(false);
    const missing = await ask(w.owner, poQueries.receipts, { restaurantId: w.a.id, branchId: w.a.branchIds[0], purchaseOrderId: 'nope' });
    expect(missing.ok ? 'OK' : missing.error.code).toBe('NOT_FOUND');
  });
});
