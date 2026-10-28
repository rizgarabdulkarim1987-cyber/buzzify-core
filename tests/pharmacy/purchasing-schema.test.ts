import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PHARMACY_BRANCH_SCOPED_MODELS, RESTAURANT_SCOPED_MODELS } from '@/server/data/tenant-db';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

beforeAll(() => {
  useTestDatabase();
  delete globalForPrisma.__prisma;
});
afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(resetWorld);

const EXPIRY = new Date('2027-03-31T00:00:00.000Z');
const DAY = new Date('2026-10-29T00:00:00.000Z');

type Biz = Awaited<ReturnType<typeof pharmacy>>;
type World = Awaited<ReturnType<typeof world>>;
type Data = Record<string, unknown>;

let seq = 0;
const next = () => (seq += 1);

/** A business with a supplier, a product and its base unit, a batch, and a receipt with one received line (qty 10 + bonus 2). */
async function world(name = 'A', opts: { branches?: number } = {}) {
  const biz = await pharmacy(name, opts);
  const product = await prisma().phProduct.create({
    data: {
      restaurantId: biz.id,
      tradeName: 'Panadol',
      identityKey: `paracetamol|500mg|tablet|${name}`,
      searchText: searchTextOf({ tradeName: 'Panadol', genericName: '', activeIngredient: '', strength: '', form: '', manufacturer: '' }),
    },
    select: { id: true },
  });
  const unit = await prisma().phProductUnit.create({
    data: { restaurantId: biz.id, productId: product.id, level: 0, label: 'tablet', baseQty: 1 },
    select: { id: true },
  });
  const batch = await prisma().phBatch.create({
    data: { restaurantId: biz.id, productId: product.id, lot: 'L1', expiryDate: EXPIRY },
    select: { id: true },
  });
  const w0 = { biz, productId: product.id, unitId: unit.id, batchId: batch.id };
  const supplier = await supplierOf(w0, { name: `Supplier ${name}` });
  const receipt = await receiptOf(w0, {});
  const receiptLine = await receiptLineOf(w0, receipt.id, {});
  return { ...w0, supplierId: supplier.id, receiptId: receipt.id, receiptLineId: receiptLine.id };
}

const supplierOf = (w: { biz: Biz }, over: Data = {}) => {
  const name = (over.name as string | undefined) ?? `Supplier ${next()}`;
  return prisma().phSupplier.create({
    data: { restaurantId: w.biz.id, name, nameKey: name.trim().toLowerCase(), defaultCurrency: 'IQD', clientKey: `sup-${next()}`, createdById: 'u1', ...over } as never,
    select: { id: true },
  });
};

const receiptOf = (w: { biz: Biz }, over: Data) =>
  prisma().phReceipt.create({
    data: { restaurantId: w.biz.id, branchId: w.biz.branchId, clientKey: `rc-${next()}`, receivedOn: DAY, createdById: 'u1', ...over } as never,
    select: { id: true },
  });

const receiptLineOf = (w: { biz: Biz; productId: string; unitId: string }, receiptId: string, over: Data) =>
  prisma().phReceiptLine.create({
    data: {
      restaurantId: w.biz.id,
      receiptId,
      lineNo: next(),
      productId: w.productId,
      unitId: w.unitId,
      qty: 10,
      bonusQty: 2,
      baseQty: 12,
      lot: 'L1',
      expiryDate: EXPIRY,
      ...over,
    } as never,
    select: { id: true },
  });

const order = (w: World, over: Data = {}) =>
  prisma().phPurchaseOrder.create({
    data: { restaurantId: w.biz.id, branchId: w.biz.branchId, supplierId: w.supplierId, currency: 'IQD', clientKey: `po-${next()}`, createdById: 'u1', ...over } as never,
    select: { id: true },
  });

const orderLine = (w: World, purchaseOrderId: string, over: Data = {}) =>
  prisma().phPurchaseOrderLine.create({
    data: {
      restaurantId: w.biz.id,
      purchaseOrderId,
      lineNo: next(),
      productId: w.productId,
      unitId: w.unitId,
      qtyOrdered: 10,
      bonusOrdered: 2,
      unitCostMinor: 500n,
      ...over,
    } as never,
    select: { id: true },
  });

interface InvoiceLine {
  receiptLineId?: string;
  qtyInvoiced?: number;
  unitCostMinor?: bigint;
  lineTotalMinor?: bigint;
  restaurantId?: string;
}

/**
 * An invoice written the way the service writes it: the invoice and its lines in one transaction, so the total identity
 * (checked when the transaction commits) sees both. The default is one line, 2 x 500 = 1000, and the total to match.
 */
function invoice(w: World, over: Data = {}, lines: InvoiceLine[] = [{}]) {
  const sum = lines.reduce((acc, l) => acc + (l.lineTotalMinor ?? BigInt(l.qtyInvoiced ?? 2) * (l.unitCostMinor ?? 500n)), 0n);
  const adjustment = (over.adjustmentMinor as bigint | undefined) ?? 0n;
  const n = next();
  return prisma().$transaction(async (tx) => {
    const created = await tx.phSupplierInvoice.create({
      data: {
        restaurantId: w.biz.id,
        supplierId: w.supplierId,
        number: `inv-${n}`,
        numberRaw: `INV-${n}`,
        invoiceDate: DAY,
        dueDate: DAY,
        currency: 'IQD',
        totalMinor: sum + adjustment,
        fingerprint: `fp-${n}`,
        clientKey: `inv-key-${n}`,
        createdById: 'u1',
        ...over,
      } as never,
      select: { id: true },
    });
    let lineNo = 0;
    for (const l of lines) {
      const qty = l.qtyInvoiced ?? 2;
      const cost = l.unitCostMinor ?? 500n;
      await tx.phSupplierInvoiceLine.create({
        data: {
          restaurantId: l.restaurantId ?? w.biz.id,
          invoiceId: created.id,
          lineNo: (lineNo += 1),
          receiptLineId: l.receiptLineId ?? w.receiptLineId,
          qtyInvoiced: qty,
          unitCostMinor: cost,
          lineTotalMinor: l.lineTotalMinor ?? BigInt(qty) * cost,
        } as never,
      });
    }
    return created;
  });
}

const payment = (w: World, over: Data = {}) =>
  prisma().phSupplierPayment.create({
    data: {
      restaurantId: w.biz.id,
      supplierId: w.supplierId,
      currency: 'IQD',
      method: 'CASH',
      amountMinor: 400n,
      paidOn: DAY,
      clientKey: `pay-${next()}`,
      createdById: 'u1',
      ...over,
    } as never,
    select: { id: true },
  });

const paymentAllocation = (w: World, paymentId: string, invoiceId: string, over: Data = {}) =>
  prisma().phSupplierPaymentAllocation.create({
    data: { restaurantId: w.biz.id, paymentId, invoiceId, supplierId: w.supplierId, currency: 'IQD', amountMinor: 400n, ...over } as never,
    select: { id: true },
  });

const supplierReturn = (w: World, over: Data = {}) =>
  prisma().phSupplierReturn.create({
    data: {
      restaurantId: w.biz.id,
      branchId: w.biz.branchId,
      supplierId: w.supplierId,
      reason: 'expired on the shelf',
      clientKey: `ret-${next()}`,
      createdById: 'u1',
      ...over,
    } as never,
    select: { id: true },
  });

const returnLine = (w: World, returnId: string, over: Data = {}) =>
  prisma().phSupplierReturnLine.create({
    data: { restaurantId: w.biz.id, returnId, lineNo: next(), batchId: w.batchId, bucket: 'AVAILABLE', qty: 3, ...over } as never,
    select: { id: true },
  });

const creditNote = (w: World, over: Data = {}) =>
  prisma().phCreditNote.create({
    data: {
      restaurantId: w.biz.id,
      supplierId: w.supplierId,
      number: `cn-${next()}`,
      currency: 'IQD',
      amountMinor: 300n,
      noteDate: DAY,
      clientKey: `cn-key-${next()}`,
      createdById: 'u1',
      ...over,
    } as never,
    select: { id: true },
  });

const creditAllocation = (w: World, creditNoteId: string, invoiceId: string, over: Data = {}) =>
  prisma().phCreditAllocation.create({
    data: { restaurantId: w.biz.id, creditNoteId, invoiceId, supplierId: w.supplierId, currency: 'IQD', amountMinor: 100n, ...over } as never,
    select: { id: true },
  });

describe('the supplier', () => {
  it('is one per name per business, whatever the case, and its own in another business', async () => {
    const w = await world('A');
    await expect(supplierOf(w, { name: 'Al Noor', nameKey: 'al noor' })).resolves.toHaveProperty('id');
    await expect(supplierOf(w, { name: 'AL NOOR', nameKey: 'al noor' })).rejects.toMatchObject({ code: 'P2002' });
    const b = await world('B');
    await expect(supplierOf(b, { name: 'Al Noor', nameKey: 'al noor' })).resolves.toHaveProperty('id');
  });

  it('is idempotent by clientKey per business', async () => {
    const w = await world('A');
    await supplierOf(w, { clientKey: 'k1' });
    await expect(supplierOf(w, { clientKey: 'k1' })).rejects.toMatchObject({ code: 'P2002' });
    const b = await world('B');
    await expect(supplierOf(b, { clientKey: 'k1' })).resolves.toHaveProperty('id');
  });

  it('keeps payment terms within 0..365 days and a name that says something', async () => {
    const w = await world('A');
    await expect(supplierOf(w, { termsDays: -1 })).rejects.toThrow(/PhSupplier_termsDays_range/);
    await expect(supplierOf(w, { termsDays: 366 })).rejects.toThrow(/PhSupplier_termsDays_range/);
    await expect(supplierOf(w, { termsDays: 0 })).resolves.toHaveProperty('id');
    await expect(supplierOf(w, { termsDays: 365 })).resolves.toHaveProperty('id');
    await expect(supplierOf(w, { name: '   ', nameKey: '' })).rejects.toThrow(/PhSupplier_name_present/);
  });
});

describe('the purchase order', () => {
  it('is numbered once per branch; unnumbered drafts do not collide; another branch has its own numbers', async () => {
    const w = await world('A', { branches: 2 });
    await order(w, { number: 'PO-20261029-000001', status: 'ORDERED' });
    await expect(order(w, { number: 'PO-20261029-000001', status: 'ORDERED' })).rejects.toMatchObject({ code: 'P2002' });
    await order(w);
    await expect(order(w)).resolves.toHaveProperty('id');
    await expect(order(w, { branchId: w.biz.branchIds[1], number: 'PO-20261029-000001' })).resolves.toHaveProperty('id');
  });

  it('is idempotent by clientKey per business', async () => {
    const w = await world('A');
    await order(w, { clientKey: 'k1' });
    await expect(order(w, { clientKey: 'k1' })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses a supplier or a branch of another business (composite foreign keys)', async () => {
    const a = await world('A');
    const b = await world('B');
    await expect(order(a, { supplierId: b.supplierId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(order(a, { branchId: b.biz.branchId })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('refuses a status that is not one of the six', async () => {
    const w = await world('A');
    await expect(order(w, { status: 'LOST' })).rejects.toThrow();
    await expect(order(w, { status: 'CANCELLED' })).resolves.toHaveProperty('id');
  });
});

describe('the purchase order line', () => {
  it('orders at least one; bonus and cost are never negative', async () => {
    const w = await world('A');
    const po = await order(w);
    await expect(orderLine(w, po.id, { qtyOrdered: 0 })).rejects.toThrow(/PhPurchaseOrderLine_qtyOrdered_positive/);
    await expect(orderLine(w, po.id, { bonusOrdered: -1 })).rejects.toThrow(/PhPurchaseOrderLine_bonusOrdered_nonnegative/);
    await expect(orderLine(w, po.id, { unitCostMinor: -1n })).rejects.toThrow(/PhPurchaseOrderLine_unitCostMinor_nonnegative/);
    await expect(orderLine(w, po.id, { qtyOrdered: 1, bonusOrdered: 0, unitCostMinor: 0n })).resolves.toHaveProperty('id');
  });

  it('never receives more than was ordered, units and bonus apart', async () => {
    const w = await world('A');
    const po = await order(w);
    await expect(orderLine(w, po.id, { receivedQty: 11 })).rejects.toThrow(/PhPurchaseOrderLine_receivedQty_within_ordered/);
    await expect(orderLine(w, po.id, { receivedBonus: 3 })).rejects.toThrow(/PhPurchaseOrderLine_receivedBonus_within_ordered/);
    await expect(orderLine(w, po.id, { receivedQty: -1 })).rejects.toThrow(/PhPurchaseOrderLine_received_nonnegative/);
    const edge = await orderLine(w, po.id, { receivedQty: 10, receivedBonus: 2 });
    // The counters move as the service moves them: a guarded increment past the ordered quantity is refused.
    await expect(prisma().phPurchaseOrderLine.update({ where: { id: edge.id }, data: { receivedQty: { increment: 1 } } })).rejects.toThrow(
      /PhPurchaseOrderLine_receivedQty_within_ordered/,
    );
    await expect(prisma().phPurchaseOrderLine.update({ where: { id: edge.id }, data: { receivedBonus: { increment: 1 } } })).rejects.toThrow(
      /PhPurchaseOrderLine_receivedBonus_within_ordered/,
    );
  });

  it('numbers its lines once per order and refuses the order, product or unit of another business', async () => {
    const w = await world('A');
    const b = await world('B');
    const po = await order(w);
    await orderLine(w, po.id, { lineNo: 1 });
    await expect(orderLine(w, po.id, { lineNo: 1 })).rejects.toMatchObject({ code: 'P2002' });
    await expect(orderLine(w, (await order(b)).id)).rejects.toMatchObject({ code: 'P2003' });
    await expect(orderLine(w, po.id, { productId: b.productId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(orderLine(w, po.id, { unitId: b.unitId })).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the receipt, with a supplier and an order', () => {
  it('has neither by default, so a phase 2 receipt reads as before', async () => {
    const w = await world('A');
    const row = await prisma().phReceipt.findUniqueOrThrow({ where: { id: w.receiptId } });
    expect(row).toMatchObject({ supplierId: null, purchaseOrderId: null });
    const line = await prisma().phReceiptLine.findUniqueOrThrow({ where: { id: w.receiptLineId } });
    expect(line).toMatchObject({ purchaseOrderLineId: null, invoicedQty: 0 });
  });

  it('needs a supplier to answer an order, and the order must be of the receipt branch', async () => {
    const w = await world('A', { branches: 2 });
    const po = await order(w);
    await expect(receiptOf(w, { purchaseOrderId: po.id })).rejects.toThrow(/PhReceipt_order_needs_supplier/);
    await expect(receiptOf(w, { purchaseOrderId: po.id, supplierId: w.supplierId })).resolves.toHaveProperty('id');
    await expect(receiptOf(w, { supplierId: w.supplierId })).resolves.toHaveProperty('id');
    // another branch's order
    await expect(receiptOf(w, { branchId: w.biz.branchIds[1], purchaseOrderId: po.id, supplierId: w.supplierId })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('refuses a supplier or an order of another business', async () => {
    const a = await world('A');
    const b = await world('B');
    await expect(receiptOf(a, { supplierId: b.supplierId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(receiptOf(a, { supplierId: a.supplierId, purchaseOrderId: (await order(b)).id })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('points a line at an order line of its own business only', async () => {
    const a = await world('A');
    const b = await world('B');
    const mine = await orderLine(a, (await order(a)).id);
    const theirs = await orderLine(b, (await order(b)).id);
    await expect(receiptLineOf(a, a.receiptId, { purchaseOrderLineId: mine.id })).resolves.toHaveProperty('id');
    await expect(receiptLineOf(a, a.receiptId, { purchaseOrderLineId: theirs.id })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('never has more invoiced than received (units plus bonus)', async () => {
    const w = await world('A');
    // received = 10 + 2 = 12
    await expect(receiptLineOf(w, w.receiptId, { invoicedQty: 13 })).rejects.toThrow(/PhReceiptLine_invoicedQty_within_received/);
    await expect(receiptLineOf(w, w.receiptId, { invoicedQty: -1 })).rejects.toThrow(/PhReceiptLine_invoicedQty_within_received/);
    await expect(receiptLineOf(w, w.receiptId, { invoicedQty: 12 })).resolves.toHaveProperty('id');
    await expect(prisma().phReceiptLine.update({ where: { id: w.receiptLineId }, data: { invoicedQty: { increment: 12 } } })).resolves.toHaveProperty('invoicedQty', 12);
    await expect(prisma().phReceiptLine.update({ where: { id: w.receiptLineId }, data: { invoicedQty: { increment: 1 } } })).rejects.toThrow(
      /PhReceiptLine_invoicedQty_within_received/,
    );
  });
});

describe('the receipt answering an order (supplier and branch link)', () => {
  it('is for the order supplier and branch only', async () => {
    const w = await world('A', { branches: 2 });
    const other = await supplierOf(w, { name: 'Second supplier' });
    const po = await order(w);
    await expect(receiptOf(w, { purchaseOrderId: po.id, supplierId: w.supplierId })).resolves.toHaveProperty('id');
    await expect(receiptOf(w, { purchaseOrderId: po.id, supplierId: other.id })).rejects.toMatchObject({ code: 'P2003' });
    await expect(receiptOf(w, { branchId: w.biz.branchIds[1], purchaseOrderId: po.id, supplierId: w.supplierId })).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the invoice dates', () => {
  it('are due on or after the invoice date', async () => {
    const w = await world('A');
    const later = new Date('2026-11-05T00:00:00.000Z');
    await expect(invoice(w, { invoiceDate: later, dueDate: DAY })).rejects.toThrow(/PhSupplierInvoice_due_not_before_invoice/);
    await expect(invoice(w, { invoiceDate: DAY, dueDate: DAY })).resolves.toHaveProperty('id');
    await expect(invoice(w, { invoiceDate: DAY, dueDate: later })).resolves.toHaveProperty('id');
  });
});

describe('the supplier invoice', () => {
  it('refuses negative money and settlements above the total; accepts the boundary', async () => {
    const w = await world('A');
    // a negative total also breaks paid + credited <= total, and Postgres reports the first rule by name
    await expect(invoice(w, { adjustmentMinor: -2000n, adjustmentReason: 'x' })).rejects.toThrow(/PhSupplierInvoice_(settled_within_total|totalMinor_nonnegative)/);
    await expect(invoice(w, { paidMinor: -1n })).rejects.toThrow(/PhSupplierInvoice_paidMinor_nonnegative/);
    await expect(invoice(w, { creditedMinor: -1n })).rejects.toThrow(/PhSupplierInvoice_creditedMinor_nonnegative/);
    // total = 1000
    await expect(invoice(w, { paidMinor: 1001n })).rejects.toThrow(/PhSupplierInvoice_settled_within_total/);
    await expect(invoice(w, { paidMinor: 600n, creditedMinor: 401n })).rejects.toThrow(/PhSupplierInvoice_settled_within_total/);
    await expect(invoice(w, { paidMinor: 600n, creditedMinor: 400n, status: 'PAID' })).resolves.toHaveProperty('id');
    const open = await invoice(w, { paidMinor: 600n, status: 'PARTIAL' });
    // the counters move as the service moves them: a guarded increment past the total is refused
    await expect(prisma().phSupplierInvoice.update({ where: { id: open.id }, data: { paidMinor: { increment: 401 } } })).rejects.toThrow(
      /PhSupplierInvoice_settled_within_total/,
    );
    await expect(prisma().phSupplierInvoice.update({ where: { id: open.id }, data: { paidMinor: { increment: 400 } } })).resolves.toHaveProperty('paidMinor', 1000n);
  });

  it('can be void only with nothing paid or credited', async () => {
    const w = await world('A');
    await expect(invoice(w, { status: 'VOID', paidMinor: 1n })).rejects.toThrow(/PhSupplierInvoice_void_unsettled/);
    await expect(invoice(w, { status: 'VOID', creditedMinor: 1n })).rejects.toThrow(/PhSupplierInvoice_void_unsettled/);
    await expect(invoice(w, { status: 'VOID', voidedAt: DAY, voidReason: 'entered twice' })).resolves.toHaveProperty('id');
    const paid = await invoice(w, { status: 'PARTIAL', paidMinor: 100n });
    await expect(prisma().phSupplierInvoice.update({ where: { id: paid.id }, data: { status: 'VOID' } })).rejects.toThrow(/PhSupplierInvoice_void_unsettled/);
  });

  it('gives a reason for an adjustment (freight, discount) of any size, positive or negative', async () => {
    const w = await world('A');
    await expect(invoice(w, { adjustmentMinor: 50n })).rejects.toThrow(/PhSupplierInvoice_adjustment_reason/);
    await expect(invoice(w, { adjustmentMinor: -50n, adjustmentReason: '  ' })).rejects.toThrow(/PhSupplierInvoice_adjustment_reason/);
    await expect(invoice(w, { adjustmentMinor: 50n, adjustmentReason: 'freight' })).resolves.toHaveProperty('id');
    await expect(invoice(w, { adjustmentMinor: -50n, adjustmentReason: 'early payment discount' })).resolves.toHaveProperty('id');
  });

  it('has a total that is its lines plus its adjustment, checked when the transaction commits', async () => {
    const w = await world('A');
    // 2 x 500 + 3 x 100 = 1300
    const lines = [{}, { qtyInvoiced: 3, unitCostMinor: 100n }];
    await expect(invoice(w, { totalMinor: 1299n }, lines)).rejects.toThrow(/PhSupplierInvoice_total_identity/);
    await expect(invoice(w, { totalMinor: 1301n }, lines)).rejects.toThrow(/PhSupplierInvoice_total_identity/);
    await expect(invoice(w, {}, lines)).resolves.toHaveProperty('id');
    // with an adjustment
    await expect(invoice(w, { adjustmentMinor: 70n, adjustmentReason: 'freight', totalMinor: 1300n }, lines)).rejects.toThrow(/PhSupplierInvoice_total_identity/);
    await expect(invoice(w, { adjustmentMinor: 70n, adjustmentReason: 'freight', totalMinor: 1370n }, lines)).resolves.toHaveProperty('id');
    // an invoice of an adjustment alone has no lines
    await expect(invoice(w, { adjustmentMinor: 70n, adjustmentReason: 'freight' }, [])).resolves.toHaveProperty('id');
    await expect(invoice(w, { totalMinor: 70n }, [])).rejects.toThrow(/PhSupplierInvoice_total_identity/);
  });

  it('keeps the total identity after the fact: a changed total, adjustment, line or a removed line is refused', async () => {
    const w = await world('A');
    const made = await invoice(w, {}, [{}, { qtyInvoiced: 3, unitCostMinor: 100n }]);
    await expect(prisma().phSupplierInvoice.update({ where: { id: made.id }, data: { totalMinor: 1000n } })).rejects.toThrow(/PhSupplierInvoice_total_identity/);
    await expect(prisma().phSupplierInvoice.update({ where: { id: made.id }, data: { adjustmentMinor: 5n, adjustmentReason: 'x' } })).rejects.toThrow(
      /PhSupplierInvoice_total_identity/,
    );
    const first = await prisma().phSupplierInvoiceLine.findFirstOrThrow({ where: { invoiceId: made.id }, orderBy: { lineNo: 'asc' } });
    await expect(prisma().phSupplierInvoiceLine.delete({ where: { id: first.id } })).rejects.toThrow(/PhSupplierInvoice_total_identity/);
    await expect(
      prisma().phSupplierInvoiceLine.update({ where: { id: first.id }, data: { qtyInvoiced: 3, lineTotalMinor: 1500n } }),
    ).rejects.toThrow(/PhSupplierInvoice_total_identity/);
    // a change that keeps the identity, made together, goes through
    await expect(
      prisma().$transaction([
        prisma().phSupplierInvoice.update({ where: { id: made.id }, data: { totalMinor: 1800n } }),
        prisma().phSupplierInvoiceLine.update({ where: { id: first.id }, data: { qtyInvoiced: 3, lineTotalMinor: 1500n } }),
      ]),
    ).resolves.toHaveLength(2);
    // counters are not part of the identity
    await expect(prisma().phSupplierInvoice.update({ where: { id: made.id }, data: { paidMinor: 10n, status: 'PARTIAL' } })).resolves.toHaveProperty('paidMinor', 10n);
  });

  it('is unique by number per supplier, fingerprint and clientKey per business', async () => {
    const w = await world('A');
    const other = await supplierOf(w, { name: 'Second supplier' });
    await invoice(w, { number: 'a-1', fingerprint: 'fp-x', clientKey: 'k-x' });
    await expect(invoice(w, { number: 'a-1' })).rejects.toMatchObject({ code: 'P2002' });
    await expect(invoice(w, { fingerprint: 'fp-x' })).rejects.toMatchObject({ code: 'P2002' });
    await expect(invoice(w, { clientKey: 'k-x' })).rejects.toMatchObject({ code: 'P2002' });
    // the same number from another supplier is a different invoice
    await expect(invoice(w, { number: 'a-1', supplierId: other.id })).resolves.toHaveProperty('id');
    // another business has its own keys
    const b = await world('B');
    await expect(invoice(b, { number: 'a-1', fingerprint: 'fp-x', clientKey: 'k-x' })).resolves.toHaveProperty('id');
  });

  it('refuses a supplier of another business', async () => {
    const a = await world('A');
    const b = await world('B');
    await expect(invoice(a, { supplierId: b.supplierId })).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the supplier invoice line', () => {
  it('bills at least one unit at a cost that is not negative, and the line total is quantity times cost', async () => {
    const w = await world('A');
    await expect(invoice(w, {}, [{ qtyInvoiced: 0, lineTotalMinor: 0n }])).rejects.toThrow(/PhSupplierInvoiceLine_qtyInvoiced_positive/);
    // a negative cost cannot be billed: the identity makes the line total negative too, so either rule names it
    await expect(invoice(w, { totalMinor: 0n }, [{ qtyInvoiced: 1, unitCostMinor: -1n, lineTotalMinor: -1n }])).rejects.toThrow(
      /PhSupplierInvoiceLine_(unitCostMinor|lineTotalMinor)_nonnegative/,
    );
    await expect(invoice(w, { totalMinor: 999n }, [{ lineTotalMinor: 999n }])).rejects.toThrow(/PhSupplierInvoiceLine_total_identity/);
    await expect(invoice(w, { totalMinor: 1001n }, [{ lineTotalMinor: 1001n }])).rejects.toThrow(/PhSupplierInvoiceLine_total_identity/);
    // a bonus unit billed at no cost
    await expect(invoice(w, { totalMinor: 0n }, [{ qtyInvoiced: 2, unitCostMinor: 0n }])).resolves.toHaveProperty('id');
  });

  it('is numbered once per invoice', async () => {
    const w = await world('A');
    const made = await invoice(w);
    await expect(
      prisma().phSupplierInvoiceLine.create({
        data: { restaurantId: w.biz.id, invoiceId: made.id, lineNo: 1, receiptLineId: w.receiptLineId, qtyInvoiced: 0 + 1, unitCostMinor: 0n, lineTotalMinor: 0n },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses a receipt line of another business', async () => {
    const a = await world('A');
    const b = await world('B');
    await expect(invoice(a, {}, [{ receiptLineId: b.receiptLineId }])).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the supplier payment', () => {
  it('is an amount above zero', async () => {
    const w = await world('A');
    await expect(payment(w, { amountMinor: 0n })).rejects.toThrow(/PhSupplierPayment_amountMinor_positive/);
    await expect(payment(w, { amountMinor: -5n })).rejects.toThrow(/PhSupplierPayment_amountMinor_positive/);
    await expect(payment(w, { amountMinor: 1n, method: 'CHEQUE_MANUAL', reference: 'chq 5521' })).resolves.toHaveProperty('id');
  });

  it('is idempotent by clientKey per business and refuses a supplier of another business', async () => {
    const a = await world('A');
    const b = await world('B');
    await payment(a, { clientKey: 'k1' });
    await expect(payment(a, { clientKey: 'k1' })).rejects.toMatchObject({ code: 'P2002' });
    await expect(payment(a, { supplierId: b.supplierId })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('is reversed once, by a row of the same supplier and currency that says so', async () => {
    const w = await world('A');
    const original = await payment(w);
    await expect(payment(w, { reversesId: original.id })).rejects.toThrow(/PhSupplierPayment_reversal_flag/);
    await expect(payment(w, { isReversal: true })).rejects.toThrow(/PhSupplierPayment_reversal_flag/);
    const reversal = await payment(w, { reversesId: original.id, isReversal: true });
    expect(reversal.id).toBeTruthy();
    await expect(payment(w, { reversesId: original.id, isReversal: true })).rejects.toMatchObject({ code: 'P2002' });
    // another supplier's, another currency's, another business's payment cannot be reversed here
    const other = await supplierOf(w, { name: 'Second supplier' });
    const theirs = await payment(w, { supplierId: other.id });
    await expect(payment(w, { reversesId: theirs.id, isReversal: true })).rejects.toMatchObject({ code: 'P2003' });
    const usd = await payment(w, { currency: 'USD' });
    await expect(payment(w, { reversesId: usd.id, isReversal: true })).rejects.toMatchObject({ code: 'P2003' });
    const b = await world('B');
    const foreign = await payment(b);
    await expect(payment(w, { reversesId: foreign.id, isReversal: true })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('is append-only: no UPDATE, no DELETE', async () => {
    const w = await world('A');
    const made = await payment(w);
    await expect(prisma().phSupplierPayment.update({ where: { id: made.id }, data: { amountMinor: 1n } })).rejects.toThrow(/PhSupplierPayment is append-only: UPDATE refused/);
    await expect(prisma().phSupplierPayment.update({ where: { id: made.id }, data: { reference: 'edited' } })).rejects.toThrow(/append-only/);
    await expect(prisma().phSupplierPayment.delete({ where: { id: made.id } })).rejects.toThrow(/PhSupplierPayment is append-only: DELETE refused/);
    await expect(prisma().phSupplierPayment.deleteMany({})).rejects.toThrow(/append-only/);
    expect(await prisma().phSupplierPayment.count()).toBe(1);
  });
});

describe('the payment allocation', () => {
  it('is an amount above zero, once per payment and invoice', async () => {
    const w = await world('A');
    const inv = await invoice(w);
    const pay = await payment(w);
    await expect(paymentAllocation(w, pay.id, inv.id, { amountMinor: 0n })).rejects.toThrow(/PhSupplierPaymentAllocation_amountMinor_positive/);
    await expect(paymentAllocation(w, pay.id, inv.id)).resolves.toHaveProperty('id');
    await expect(paymentAllocation(w, pay.id, inv.id)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('cannot join a payment to the invoice of another supplier, another currency or another business', async () => {
    const w = await world('A');
    const other = await supplierOf(w, { name: 'Second supplier' });
    const pay = await payment(w);
    // another supplier's invoice
    const theirInvoice = await invoice(w, { supplierId: other.id });
    await expect(paymentAllocation(w, pay.id, theirInvoice.id)).rejects.toMatchObject({ code: 'P2003' });
    await expect(paymentAllocation(w, pay.id, theirInvoice.id, { supplierId: other.id })).rejects.toMatchObject({ code: 'P2003' });
    // an invoice in another currency
    const usdInvoice = await invoice(w, { currency: 'USD' });
    await expect(paymentAllocation(w, pay.id, usdInvoice.id)).rejects.toMatchObject({ code: 'P2003' });
    await expect(paymentAllocation(w, pay.id, usdInvoice.id, { currency: 'USD' })).rejects.toMatchObject({ code: 'P2003' });
    // a USD payment may go to the USD invoice
    const usdPay = await payment(w, { currency: 'USD' });
    await expect(paymentAllocation(w, usdPay.id, usdInvoice.id, { currency: 'USD' })).resolves.toHaveProperty('id');
    // another business
    const b = await world('B');
    const foreignInvoice = await invoice(b);
    await expect(paymentAllocation(w, pay.id, foreignInvoice.id)).rejects.toMatchObject({ code: 'P2003' });
  });

  it('is append-only: no UPDATE, no DELETE', async () => {
    const w = await world('A');
    const made = await paymentAllocation(w, (await payment(w)).id, (await invoice(w)).id);
    await expect(prisma().phSupplierPaymentAllocation.update({ where: { id: made.id }, data: { amountMinor: 1n } })).rejects.toThrow(
      /PhSupplierPaymentAllocation is append-only: UPDATE refused/,
    );
    await expect(prisma().phSupplierPaymentAllocation.delete({ where: { id: made.id } })).rejects.toThrow(/PhSupplierPaymentAllocation is append-only: DELETE refused/);
    expect(await prisma().phSupplierPaymentAllocation.count()).toBe(1);
  });
});

describe('the supplier return', () => {
  it('says why', async () => {
    const w = await world('A');
    await expect(supplierReturn(w, { reason: '' })).rejects.toThrow(/PhSupplierReturn_reason_present/);
    await expect(supplierReturn(w, { reason: '   ' })).rejects.toThrow(/PhSupplierReturn_reason_present/);
    await expect(supplierReturn(w, { reason: 'x' })).resolves.toHaveProperty('id');
  });

  it('is numbered once per branch, idempotent by clientKey, and of one business', async () => {
    const w = await world('A', { branches: 2 });
    await supplierReturn(w, { number: 'SR-1', clientKey: 'k1' });
    await expect(supplierReturn(w, { number: 'SR-1' })).rejects.toMatchObject({ code: 'P2002' });
    await expect(supplierReturn(w, { clientKey: 'k1' })).rejects.toMatchObject({ code: 'P2002' });
    await expect(supplierReturn(w, { number: 'SR-1', branchId: w.biz.branchIds[1] })).resolves.toHaveProperty('id');
    const b = await world('B');
    await expect(supplierReturn(w, { supplierId: b.supplierId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(supplierReturn(w, { branchId: b.biz.branchId })).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the supplier return line', () => {
  it('takes at least one unit, from the available or quarantine bucket only', async () => {
    const w = await world('A');
    const r = await supplierReturn(w);
    await expect(returnLine(w, r.id, { qty: 0 })).rejects.toThrow(/PhSupplierReturnLine_qty_positive/);
    await expect(returnLine(w, r.id, { bucket: 'DAMAGED' })).rejects.toThrow(/PhSupplierReturnLine_bucket_returnable/);
    await expect(returnLine(w, r.id, { bucket: 'RESERVED' })).rejects.toThrow(/PhSupplierReturnLine_bucket_returnable/);
    await expect(returnLine(w, r.id, { bucket: 'AVAILABLE', qty: 1 })).resolves.toHaveProperty('id');
    await expect(returnLine(w, r.id, { bucket: 'QUARANTINE', qty: 1 })).resolves.toHaveProperty('id');
  });

  it('copies the cost with its currency, both or neither, never negative', async () => {
    const w = await world('A');
    const r = await supplierReturn(w);
    await expect(returnLine(w, r.id, { unitCostMinor: 5n })).rejects.toThrow(/PhSupplierReturnLine_cost_together/);
    await expect(returnLine(w, r.id, { costCurrency: 'IQD' })).rejects.toThrow(/PhSupplierReturnLine_cost_together/);
    await expect(returnLine(w, r.id, { unitCostMinor: -1n, costCurrency: 'IQD' })).rejects.toThrow(/PhSupplierReturnLine_unitCostMinor_nonnegative/);
    await expect(returnLine(w, r.id, { unitCostMinor: 0n, costCurrency: 'IQD' })).resolves.toHaveProperty('id');
  });

  it('is numbered once per return and refuses the batch or return of another business', async () => {
    const a = await world('A');
    const b = await world('B');
    const r = await supplierReturn(a);
    await returnLine(a, r.id, { lineNo: 1 });
    await expect(returnLine(a, r.id, { lineNo: 1 })).rejects.toMatchObject({ code: 'P2002' });
    await expect(returnLine(a, r.id, { batchId: b.batchId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(returnLine(a, (await supplierReturn(b)).id)).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the credit note', () => {
  it('is an amount above zero and applies between nothing and all of it', async () => {
    const w = await world('A');
    await expect(creditNote(w, { amountMinor: 0n })).rejects.toThrow(/PhCreditNote_amountMinor_positive/);
    await expect(creditNote(w, { appliedMinor: -1n })).rejects.toThrow(/PhCreditNote_applied_within_amount/);
    await expect(creditNote(w, { appliedMinor: 301n })).rejects.toThrow(/PhCreditNote_applied_within_amount/);
    const edge = await creditNote(w, { appliedMinor: 300n });
    await expect(prisma().phCreditNote.update({ where: { id: edge.id }, data: { appliedMinor: { increment: 1 } } })).rejects.toThrow(/PhCreditNote_applied_within_amount/);
    await expect(creditNote(w, { appliedMinor: 0n })).resolves.toHaveProperty('id');
  });

  it('has the number the supplier gave it, once per supplier; another supplier may reuse it', async () => {
    const w = await world('A');
    const other = await supplierOf(w, { name: 'Second supplier' });
    await creditNote(w, { number: 'cn-7' });
    await expect(creditNote(w, { number: 'cn-7' })).rejects.toMatchObject({ code: 'P2002' });
    await expect(creditNote(w, { number: 'cn-7', supplierId: other.id })).resolves.toHaveProperty('id');
    await expect(creditNote(w, { number: '' })).rejects.toThrow(/PhCreditNote_number_present/);
  });

  it('is idempotent by clientKey per business', async () => {
    const w = await world('A');
    await creditNote(w, { clientKey: 'k1' });
    await expect(creditNote(w, { clientKey: 'k1' })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('may name the return it answers, of its own business only', async () => {
    const a = await world('A');
    const b = await world('B');
    await expect(creditNote(a, { supplierReturnId: (await supplierReturn(a)).id })).resolves.toHaveProperty('id');
    await expect(creditNote(a, { supplierReturnId: (await supplierReturn(b)).id })).rejects.toMatchObject({ code: 'P2003' });
    await expect(creditNote(a, { supplierId: b.supplierId })).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the credit allocation', () => {
  it('is an amount above zero, once per credit note and invoice', async () => {
    const w = await world('A');
    const inv = await invoice(w);
    const cn = await creditNote(w);
    await expect(creditAllocation(w, cn.id, inv.id, { amountMinor: 0n })).rejects.toThrow(/PhCreditAllocation_amountMinor_positive/);
    await expect(creditAllocation(w, cn.id, inv.id)).resolves.toHaveProperty('id');
    await expect(creditAllocation(w, cn.id, inv.id)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('cannot join a credit note to the invoice of another supplier, another currency or another business', async () => {
    const w = await world('A');
    const other = await supplierOf(w, { name: 'Second supplier' });
    const cn = await creditNote(w);
    await expect(creditAllocation(w, cn.id, (await invoice(w, { supplierId: other.id })).id)).rejects.toMatchObject({ code: 'P2003' });
    await expect(creditAllocation(w, cn.id, (await invoice(w, { currency: 'USD' })).id)).rejects.toMatchObject({ code: 'P2003' });
    const b = await world('B');
    await expect(creditAllocation(w, cn.id, (await invoice(b)).id)).rejects.toMatchObject({ code: 'P2003' });
  });

  it('is append-only: no UPDATE, no DELETE', async () => {
    const w = await world('A');
    const made = await creditAllocation(w, (await creditNote(w)).id, (await invoice(w)).id);
    await expect(prisma().phCreditAllocation.update({ where: { id: made.id }, data: { amountMinor: 1n } })).rejects.toThrow(/PhCreditAllocation is append-only: UPDATE refused/);
    await expect(prisma().phCreditAllocation.delete({ where: { id: made.id } })).rejects.toThrow(/PhCreditAllocation is append-only: DELETE refused/);
    expect(await prisma().phCreditAllocation.count()).toBe(1);
  });
});

describe('removing a whole business', () => {
  it('removes its purchasing rows too, append-only tables included, and nothing of another business', async () => {
    const a = await world('A');
    const b = await world('B');
    for (const w of [a, b]) {
      const inv = await invoice(w);
      await paymentAllocation(w, (await payment(w)).id, inv.id);
      await creditAllocation(w, (await creditNote(w)).id, inv.id);
      const po = await order(w);
      await orderLine(w, po.id);
      await returnLine(w, (await supplierReturn(w)).id);
    }
    await prisma().subscription.deleteMany({ where: { restaurantId: a.biz.id } });
    await prisma().restaurant.delete({ where: { id: a.biz.id } });
    expect(await prisma().phSupplierPayment.count({ where: { restaurantId: a.biz.id } })).toBe(0);
    expect(await prisma().phSupplierInvoice.count({ where: { restaurantId: a.biz.id } })).toBe(0);
    expect(await prisma().phSupplier.count({ where: { restaurantId: a.biz.id } })).toBe(0);
    expect(await prisma().phSupplierPayment.count({ where: { restaurantId: b.biz.id } })).toBe(1);
    expect(await prisma().phSupplierInvoice.count({ where: { restaurantId: b.biz.id } })).toBe(1);
  });
});

describe('the tenant registries', () => {
  const RESTAURANT_MODELS = [
    'PhSupplier',
    'PhPurchaseOrder',
    'PhPurchaseOrderLine',
    'PhSupplierInvoice',
    'PhSupplierInvoiceLine',
    'PhSupplierPayment',
    'PhSupplierPaymentAllocation',
    'PhSupplierReturn',
    'PhSupplierReturnLine',
    'PhCreditNote',
    'PhCreditAllocation',
  ];

  it('scopes every purchasing model by restaurant', () => {
    for (const model of RESTAURANT_MODELS) expect(RESTAURANT_SCOPED_MODELS as readonly string[], model).toContain(model);
  });

  it('confines the orders and the supplier returns to the branches of the caller, and nothing else of this phase', () => {
    expect(PHARMACY_BRANCH_SCOPED_MODELS).toContain('PhPurchaseOrder');
    expect(PHARMACY_BRANCH_SCOPED_MODELS).toContain('PhSupplierReturn');
    // business-wide records, and child rows reached through their parent
    for (const model of RESTAURANT_MODELS.filter((m) => m !== 'PhPurchaseOrder' && m !== 'PhSupplierReturn')) {
      expect(PHARMACY_BRANCH_SCOPED_MODELS, model).not.toContain(model);
    }
  });
});
