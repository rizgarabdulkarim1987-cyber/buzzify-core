/// <reference types="vite/client" />
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as countActions from '@/server/pharmacy/actions/counts';
import * as poActions from '@/server/pharmacy/actions/purchase-orders';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import * as invoiceActions from '@/server/pharmacy/actions/supplier-invoices';
import * as paymentActions from '@/server/pharmacy/actions/supplier-payments';
import * as returnActions from '@/server/pharmacy/actions/supplier-returns';
import * as supplierActions from '@/server/pharmacy/actions/suppliers';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { dataOf, makeBatch, makeProduct, META } from './stock-helpers';
import { NOW, grant, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';

/**
 * Isolation of the stock definitions (phase 2): a person of business A with a valid session who sends a hand-made input
 * naming business B's ids gets a refusal and B's data does not change; a person limited to branch 1 of A can neither read
 * nor write branch 2. The table is checked against the definitions the pharmacy folders really export: a new `ph.*`
 * definition with no entry here, and none in `COVERED_ELSEWHERE`, fails the first test.
 */

type Definition = ActionDef<unknown, unknown> | QueryDef<unknown, unknown>;

function pharmacyDefinitions(): Map<string, Definition> {
  const modules = import.meta.glob<Record<string, unknown>>(['/src/server/pharmacy/actions/*.ts', '/src/server/pharmacy/queries/*.ts'], { eager: true });
  const found = new Map<string, Definition>();
  for (const exported of Object.values(modules)) {
    for (const value of Object.values(exported)) {
      const kind = (value as { kind?: unknown } | null)?.kind;
      if (kind !== 'action' && kind !== 'query') continue;
      const def = value as Definition;
      if (found.has(def.name)) throw new Error(`Two pharmacy definitions are called ${def.name}`);
      found.set(def.name, def);
    }
  }
  return found;
}
const DEFINITIONS = pharmacyDefinitions();

/** Phase 0 and 1 definitions: their business and branch isolation is proven in acceptance-phase-0-1 and the per-feature files. */
const COVERED_ELSEWHERE = [
  'ph.products.get', 'ph.products.search', 'ph.products.list', 'ph.products.categories', 'ph.products.create', 'ph.products.update', 'ph.products.archive',
  'ph.prices.history', 'ph.prices.currencies', 'ph.prices.set', 'ph.prices.previewBulk', 'ph.prices.applyBulk',
  'ph.imports.preview', 'ph.imports.apply', 'ph.exports.products',
];

// The world ------------------------------------------------------------------------------------------------------------

interface Ids {
  restaurantId: string;
  b1: string;
  b2: string;
  categoryId: string;
  productId: string;
  unitId: string;
  /** Stocked in branch 1 / in branch 2 only. */
  batch1: string;
  batch2: string;
  move1: string;
  move2: string;
  receipt1: string;
  receipt2: string;
  count1: string;
  count2: string;
  line1: string;
  line2: string;
  /** A completed sale in branch 1 / in branch 2 (phase 3). */
  sale1: string;
  sale2: string;
  /** The owner's open shift in branch 1 / in branch 2 (phase 3). */
  shift1: string;
  shift2: string;
  /** A return of the sale in branch 1 / in branch 2 (phase 3, made straight in the database). */
  return1: string;
  return2: string;
  lot1: string;
  lot2: string;
  tradeName: string;
  /** The business's supplier (phase 4), and its purchase order in branch 1 / in branch 2. */
  supplierId: string;
  supplierName: string;
  po1: string;
  po2: string;
  /** The business's supplier invoice (phase 4), of a confirmed receipt line of branch 1; business-wide. */
  invoiceId: string;
  invoiceNumber: string;
  invReceiptId: string;
  invLineId: string;
  /** The business's supplier payment (phase 4, task 7) of the seeded invoice, and its credit note (straight in the database); business-wide. */
  paymentId: string;
  creditNoteId: string;
  /** The business's supplier return from branch 1 / from branch 2 (phase 4, task 8); branch-scoped. */
  supplierReturn1: string;
  supplierReturn2: string;
}
interface World {
  a: Ids;
  b: Ids;
  ownerA: Person;
  managerA1: Person;
  ownerB: Person;
}
let world: World;

const receiptDraft = (ids: Ids, branchId: string, key: string) => ({
  restaurantId: ids.restaurantId,
  branchId,
  clientKey: `seed-${key}-${branchId}`,
  supplierName: 'Seed',
  reference: 'S-1',
  receivedOn: '2026-10-27',
  lines: [{ productId: ids.productId, unitId: ids.unitId, qty: 1, lot: 'seedlot', expiry: '2028-03-15', unitCostMinor: 100n, currency: 'IQD' }],
});


async function seedSide(label: 'ALPHA' | 'BRAVO'): Promise<{ ids: Omit<Ids, 'receipt1' | 'receipt2' | 'count1' | 'count2' | 'line1' | 'line2' | 'supplierId' | 'supplierName' | 'po1' | 'po2' | 'invoiceId' | 'invoiceNumber' | 'invReceiptId' | 'invLineId' | 'paymentId' | 'creditNoteId' | 'supplierReturn1' | 'supplierReturn2'>; owner: Person }> {
  const biz = await pharmacy(label, { branches: 2 });
  const [b1, b2] = biz.branchIds as [string, string];
  const owner = await person(`owner${label}`, { membership: [biz.id, 'OWNER'] });
  const category = await prisma().phCategory.create({ data: { restaurantId: biz.id, name: `${label} cat`, nameKey: `${label}-cat`.toLowerCase() }, select: { id: true } });
  const tradeName = `${label}DRUG`;
  const product = await makeProduct(biz.id, tradeName);
  const lot1 = `${label}-LOT1`;
  const lot2 = `${label}-LOT2`;
  const batch1 = await makeBatch(biz.id, b1, product.id, { lot: lot1, buckets: { available: 50 } });
  const batch2 = await makeBatch(biz.id, b2, product.id, { lot: lot2, buckets: { available: 40 } });
  const move1 = (await prisma().phStockMovement.findFirstOrThrow({ where: { batchId: batch1, branchId: b1 }, select: { id: true } })).id;
  const move2 = (await prisma().phStockMovement.findFirstOrThrow({ where: { batchId: batch2, branchId: b2 }, select: { id: true } })).id;
  // The owner works a shift in each branch, with a completed sale in it (made straight in the database).
  const saleIn = async (branchId: string, n: number) => {
    const shift = await prisma().phShift.create({ data: { restaurantId: biz.id, branchId, userId: owner.userId, currency: 'IQD' }, select: { id: true } });
    const made = await prisma().phSale.create({
      data: { restaurantId: biz.id, branchId, shiftId: shift.id, number: `20261027-00000${n}`, status: 'COMPLETED', currency: 'IQD', clientKey: `seed-sale-${label}-${n}`, soldById: owner.userId, completedAt: NOW },
      select: { id: true },
    });
    const returned = await prisma().phReturn.create({
      data: { restaurantId: biz.id, branchId, saleId: made.id, shiftId: shift.id, number: `R20261027-00000${n}`, reason: 'Seed', approvedById: owner.userId, refundMethod: 'CASH', refundMinor: 0n, currency: 'IQD', clientKey: `seed-return-${label}-${n}` },
      select: { id: true },
    });
    return { sale: made.id, shift: shift.id, ret: returned.id };
  };
  const [{ sale: sale1, shift: shift1, ret: return1 }, { sale: sale2, shift: shift2, ret: return2 }] = [await saleIn(b1, 1), await saleIn(b2, 2)];
  return {
    owner,
    ids: { restaurantId: biz.id, b1, b2, categoryId: category.id, productId: product.id, unitId: product.strip, batch1, batch2, move1, move2, sale1, sale2, shift1, shift2, return1, return2, lot1, lot2, tradeName },
  };
}

/** A receipt draft and an open count in each branch, made through the real actions. */
async function seedDocuments(base: Awaited<ReturnType<typeof seedSide>>['ids'], owner: Person): Promise<Ids> {
  const actor = (await loadActor(prisma(), owner.userId)) as Actor;
  const withDocs = { ...base } as Ids;
  const receipt = async (branchId: string) => dataOf(await runAction(prisma(), actor, receiptActions.create, receiptDraft(withDocs, branchId, base.lot1), META)).id;
  const count = async (branchId: string) => {
    const made = dataOf(await runAction(prisma(), actor, countActions.open, { restaurantId: base.restaurantId, branchId, scope: 'BRANCH', blind: false, note: '' }, META));
    const line = await prisma().phStockCountLine.findFirstOrThrow({ where: { countId: made.id }, select: { id: true } });
    return { id: made.id, line: line.id };
  };
  withDocs.supplierName = `${base.tradeName} Supplies`;
  withDocs.supplierId = dataOf(
    await runAction(prisma(), actor, supplierActions.create, { restaurantId: base.restaurantId, clientKey: `seed-supplier-${base.restaurantId}`, name: withDocs.supplierName, defaultCurrency: 'IQD' }, META),
  ).id;
  const order = async (branchId: string) =>
    dataOf(
      await runAction(
        prisma(),
        actor,
        poActions.create,
        { restaurantId: base.restaurantId, branchId, clientKey: `seed-po-${branchId}`, supplierId: withDocs.supplierId, currency: 'IQD', lines: [{ productId: base.productId, unitId: base.unitId, qtyOrdered: 1, unitCostMinor: 100n }] },
        META,
      ),
    ).id;
  // A confirmed receipt of the supplier in branch 1, and the business's one invoice of a unit of it (phase 4, task 6).
  const invReceipt = dataOf(
    await runAction(
      prisma(),
      actor,
      receiptActions.create,
      {
        restaurantId: base.restaurantId,
        branchId: base.b1,
        clientKey: `seed-invrcpt-${base.restaurantId}`,
        supplierId: withDocs.supplierId,
        supplierName: '',
        reference: 'INV-R',
        receivedOn: '2026-10-27',
        lines: [{ productId: base.productId, unitId: base.unitId, qty: 1000, lot: 'invlot', expiry: '2028-03-15', unitCostMinor: 100n, currency: 'IQD' }],
      },
      META,
    ),
  );
  dataOf(await runAction(prisma(), actor, receiptActions.confirm, { restaurantId: base.restaurantId, branchId: base.b1, receiptId: invReceipt.id }, META));
  withDocs.invReceiptId = invReceipt.id;
  withDocs.invLineId = (await prisma().phReceiptLine.findFirstOrThrow({ where: { receiptId: invReceipt.id }, select: { id: true } })).id;
  withDocs.invoiceNumber = `${base.tradeName}-SEED-1`;
  withDocs.invoiceId = dataOf(
    await runAction(
      prisma(),
      actor,
      invoiceActions.create,
      {
        restaurantId: base.restaurantId,
        clientKey: `seed-invoice-${base.restaurantId}`,
        supplierId: withDocs.supplierId,
        number: withDocs.invoiceNumber,
        invoiceDate: '2026-10-20',
        currency: 'IQD',
        lines: [{ receiptLineId: withDocs.invLineId, qtyInvoiced: 1, unitCostMinor: 100n }],
      },
      META,
    ),
  ).id;
  // One payment of 10 on that invoice, and a credit note of the supplier (a credit note is made by task 8's service; here straight in the database).
  withDocs.paymentId = dataOf(
    await runAction(
      prisma(),
      actor,
      paymentActions.create,
      { restaurantId: base.restaurantId, clientKey: `seed-payment-${base.restaurantId}`, supplierId: withDocs.supplierId, currency: 'IQD', method: 'CASH', amountMinor: 10n, paidOn: '2026-10-27', allocations: [{ invoiceId: withDocs.invoiceId, amountMinor: 10n }] },
      META,
    ),
  ).id;
  withDocs.creditNoteId = (
    await prisma().phCreditNote.create({
      data: { restaurantId: base.restaurantId, supplierId: withDocs.supplierId, number: `${base.tradeName}-CN-1`, currency: 'IQD', amountMinor: 50n, noteDate: new Date('2026-10-26T00:00:00Z'), clientKey: `seed-credit-${base.restaurantId}`, createdById: owner.userId },
      select: { id: true },
    })
  ).id;
  // One return of a unit of the seeded batch from each branch (made through the real action).
  const sendBack = async (branchId: string, batchId: string) =>
    dataOf(
      await runAction(
        prisma(),
        actor,
        returnActions.create,
        { restaurantId: base.restaurantId, branchId, clientKey: `seed-sreturn-${branchId}`, supplierId: withDocs.supplierId, reason: 'Seed return', lines: [{ batchId, bucket: 'AVAILABLE', qty: 1 }] },
        META,
      ),
    ).id;
  withDocs.supplierReturn1 = await sendBack(base.b1, base.batch1);
  withDocs.supplierReturn2 = await sendBack(base.b2, base.batch2);
  withDocs.po1 = await order(base.b1);
  withDocs.po2 = await order(base.b2);
  withDocs.receipt1 = await receipt(base.b1);
  withDocs.receipt2 = await receipt(base.b2);
  const [c1, c2] = [await count(base.b1), await count(base.b2)];
  Object.assign(withDocs, { count1: c1.id, count2: c2.id, line1: c1.line, line2: c2.line });
  return withDocs;
}

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  const [a, b] = [await seedSide('ALPHA'), await seedSide('BRAVO')];
  const managerA1 = await person('managerA1', { staff: [a.ids.restaurantId, 'BRANCH_MANAGER', [a.ids.b1]] });
  await prisma().phShift.create({ data: { restaurantId: a.ids.restaurantId, branchId: a.ids.b1, userId: managerA1.userId, currency: 'IQD' } });
  world = { a: await seedDocuments(a.ids, a.owner), b: await seedDocuments(b.ids, b.owner), ownerA: a.owner, ownerB: b.owner, managerA1 };
}, 120_000);
afterEach(() => {
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

// The cases -------------------------------------------------------------------------------------------------------------

/**
 * What a definition does with ids that are not the caller's: `refused` is a failure (NOT_FOUND, FORBIDDEN, or INVALID when
 * the input names a foreign row as a field), `scoped` answers without a trace of them, `harmless` may do either but
 * touches nothing of theirs (a batch is the business's, so another branch's batch can be used from branch 1).
 */
type Outcome = 'refused' | 'scoped' | 'harmless';
interface Case {
  /** The input for the ids of one side and the branch (1 or 2) whose documents it names. */
  body(ids: Ids, branch: 1 | 2): Record<string, unknown>;
  /** Naming the other business's ids from one's own place. */
  foreignIds: Outcome;
  /** Naming branch 2's ids from branch 1 or from no branch (a branch-1-only person). */
  otherBranchIds: Outcome;
}

const pick = (ids: Ids, branch: 1 | 2) =>
  branch === 1
    ? { batchId: ids.batch1, movementId: ids.move1, receiptId: ids.receipt1, countId: ids.count1, lineId: ids.line1, saleId: ids.sale1, shiftId: ids.shift1, returnId: ids.return1, purchaseOrderId: ids.po1, supplierReturnId: ids.supplierReturn1 }
    : { batchId: ids.batch2, movementId: ids.move2, receiptId: ids.receipt2, countId: ids.count2, lineId: ids.line2, saleId: ids.sale2, shiftId: ids.shift2, returnId: ids.return2, purchaseOrderId: ids.po2, supplierReturnId: ids.supplierReturn2 };
let keySeq = 0;
const key = () => `isolation-key-${(keySeq += 1)}`;
const line = (ids: Ids) => ({ productId: ids.productId, unitId: ids.unitId, qty: 1, lot: 'planted', expiry: '2028-03-15', unitCostMinor: 100n, currency: 'IQD' });
const draftBody = (ids: Ids) => ({ supplierName: 'Planted', reference: 'P-1', receivedOn: '2026-10-27', lines: [line(ids)] });
const saleBody = (ids: Ids) => ({
  currency: 'IQD',
  clientKey: key(),
  lines: [{ productId: ids.productId, unitId: ids.unitId, qty: 1 }],
  payments: [{ method: 'CASH', amountMinor: 100n, clientKey: key() }],
});

const poBody = (ids: Ids) => ({ clientKey: key(), supplierId: ids.supplierId, currency: 'IQD', lines: [{ productId: ids.productId, unitId: ids.unitId, qtyOrdered: 1, unitCostMinor: 100n }] });

const invoiceBody = (ids: Ids) => ({
  clientKey: key(),
  supplierId: ids.supplierId,
  number: `PLANTED-${key()}`,
  invoiceDate: '2026-10-27',
  currency: 'IQD',
  lines: [{ receiptLineId: ids.invLineId, qtyInvoiced: 1, unitCostMinor: 100n }],
});

const paymentBody = (ids: Ids) => ({
  clientKey: key(),
  supplierId: ids.supplierId,
  currency: 'IQD',
  method: 'CASH',
  amountMinor: 1n,
  paidOn: '2026-10-27',
  allocations: [{ invoiceId: ids.invoiceId, amountMinor: 1n }],
});

const supplierReturnBody = (ids: Ids, n: 1 | 2) => ({ clientKey: key(), supplierId: ids.supplierId, reason: 'Planted', lines: [{ batchId: pick(ids, n).batchId, bucket: 'AVAILABLE', qty: 1 }] });
const creditNoteBody = (ids: Ids, n: 1 | 2) => ({ clientKey: key(), supplierId: ids.supplierId, number: `PLANTED-${key()}`, currency: 'IQD', amountMinor: 1n, noteDate: '2026-10-27', supplierReturnId: pick(ids, n).supplierReturnId });

const returnBody = (saleId: string) => ({ saleId, lines: [{ saleLineId: 'planted', baseQty: 1 }], reason: 'Planted', clientKey: key() });

const CASES: Record<string, Case> = {
  // Changing stock (R2-3, R2-5, R2-6). A batch belongs to the business, so another branch's batch is the same business's own.
  'ph.stock.adjust': {
    body: (ids, n) => ({ batchId: pick(ids, n).batchId, direction: 'in', bucketTo: 'available', baseQty: 5, reason: 'Planted', clientKey: key() }),
    foreignIds: 'refused',
    otherBranchIds: 'harmless',
  },
  'ph.stock.damage': {
    body: (ids, n) => ({ batchId: pick(ids, n).batchId, fromBucket: 'available', baseQty: 1, reason: 'Planted', clientKey: key() }),
    foreignIds: 'refused',
    otherBranchIds: 'harmless',
  },
  'ph.stock.quarantineRelease': {
    body: (ids, n) => ({ batchId: pick(ids, n).batchId, decision: 'RESTOCK', baseQty: 1, reason: 'Planted', clientKey: key() }),
    foreignIds: 'refused',
    otherBranchIds: 'harmless',
  },
  'ph.stock.reverse': { body: (ids, n) => ({ movementId: pick(ids, n).movementId, reason: 'Planted' }), foreignIds: 'refused', otherBranchIds: 'refused' },
  // Receiving
  'ph.stock.receipt.create': { body: (ids) => ({ clientKey: key(), ...draftBody(ids) }), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.stock.receipt.update': { body: (ids, n) => ({ receiptId: pick(ids, n).receiptId, expectedVersion: 1, ...draftBody(ids) }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.stock.receipt.confirm': { body: (ids, n) => ({ receiptId: pick(ids, n).receiptId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.stock.receipt.void': { body: (ids, n) => ({ receiptId: pick(ids, n).receiptId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.stock.receipt.get': { body: (ids, n) => ({ receiptId: pick(ids, n).receiptId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.stock.receipt.list': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  // Counting
  'ph.stock.count.open': { body: (ids) => ({ scope: 'CATEGORY', categoryId: ids.categoryId, blind: false, note: '' }), foreignIds: 'harmless', otherBranchIds: 'harmless' },
  'ph.stock.count.record': {
    body: (ids, n) => ({ countId: pick(ids, n).countId, lines: [{ lineId: pick(ids, n).lineId, countedQty: 1 }] }),
    foreignIds: 'refused',
    otherBranchIds: 'refused',
  },
  'ph.stock.count.submit': { body: (ids, n) => ({ countId: pick(ids, n).countId, skipUncounted: true }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.stock.count.cancel': { body: (ids, n) => ({ countId: pick(ids, n).countId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.stock.count.approve': { body: (ids, n) => ({ countId: pick(ids, n).countId, reason: 'Planted' }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.stock.count.get': { body: (ids, n) => ({ countId: pick(ids, n).countId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.stock.count.list': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  // Expiry
  'ph.stock.expiry.setStatus': { body: (ids, n) => ({ batchId: pick(ids, n).batchId, status: 'IN_PROGRESS', note: 'Planted' }), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.stock.expiry': { body: () => ({ days: 180, includeExpired: true }), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  // Selling (phase 3). The seller must be in a branch of their own with an open shift; a product of the other business is refused.
  'ph.sales.create': { body: (ids) => saleBody(ids), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.sales.get': { body: (ids, n) => ({ saleId: pick(ids, n).saleId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.sales.list': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  // Holds and the sale screen's search (phase 3, task 3b). They need a branch (the place), so with none they answer INVALID: harmless.
  'ph.sales.hold': { body: (ids) => ({ currency: 'IQD', clientKey: key(), lines: [{ productId: ids.productId, unitId: ids.unitId, qty: 1 }] }), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.sales.resume': { body: (ids, n) => ({ saleId: pick(ids, n).saleId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.sales.discardHold': { body: (ids, n) => ({ saleId: pick(ids, n).saleId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.sales.holds': { body: () => ({}), foreignIds: 'harmless', otherBranchIds: 'harmless' },
  'ph.sell.search': { body: (ids) => ({ q: ids.tradeName }), foreignIds: 'harmless', otherBranchIds: 'harmless' },
  // Shifts and cash (phase 3). Open and the cash movements act on the caller's own shift: they name no foreign id.
  'ph.shifts.open': { body: () => ({ currency: 'IQD', openingFloatMinor: 10n, clientKey: key() }), foreignIds: 'harmless', otherBranchIds: 'harmless' },
  'ph.cash.paidIn': { body: () => ({ amountMinor: 5n, reason: 'Planted', clientKey: key() }), foreignIds: 'harmless', otherBranchIds: 'harmless' },
  'ph.cash.paidOut': { body: () => ({ amountMinor: 5n, reason: 'Planted', clientKey: key() }), foreignIds: 'harmless', otherBranchIds: 'harmless' },
  'ph.shifts.close': { body: (ids, n) => ({ shiftId: pick(ids, n).shiftId, countedMinor: 0n, reason: 'Planted' }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.shifts.current': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.shifts.report': { body: (ids, n) => ({ shiftId: pick(ids, n).shiftId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.shifts.list': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  // Returns and cancels (phase 3). The approver must have an open shift in a branch of their own; the sale must be in that branch.
  'ph.returns.create': { body: (ids, n) => returnBody(pick(ids, n).saleId), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.sales.cancel': { body: (ids, n) => ({ saleId: pick(ids, n).saleId, reason: 'Planted', clientKey: key() }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.returns.get': { body: (ids, n) => ({ returnId: pick(ids, n).returnId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.returns.returnable': { body: (ids, n) => ({ saleId: pick(ids, n).saleId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.returns.list': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  // Names of people: only this business's own are given, whatever ids are named (people-names.test.ts names real foreign users).
  'ph.people.names': { body: () => ({ ids: ['planted'] }), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.returns.preview': { body: (ids, n) => ({ saleId: pick(ids, n).saleId, lines: [{ saleLineId: 'nope', baseQty: 1 }] }), foreignIds: 'refused', otherBranchIds: 'refused' },
  // Printing (phase 3, task 6): a sale or return of another branch or business is NOT_FOUND; a reprint logs nothing then.
  'ph.receipts.get': { body: (ids, n) => ({ saleId: pick(ids, n).saleId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.receipts.returnReceipt': { body: (ids, n) => ({ returnId: pick(ids, n).returnId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.receipts.reprint': { body: (ids, n) => ({ saleId: pick(ids, n).saleId, clientKey: key() }), foreignIds: 'refused', otherBranchIds: 'refused' },
  // Suppliers (phase 4): business-wide. A foreign supplier id is refused; inside the business any branch reaches them.
  'ph.suppliers.create': { body: () => ({ clientKey: key(), name: `Planted ${key()}`, defaultCurrency: 'IQD' }), foreignIds: 'harmless', otherBranchIds: 'harmless' },
  'ph.suppliers.update': { body: (ids) => ({ supplierId: ids.supplierId, expectedVersion: 1, name: `Planted ${key()}`, defaultCurrency: 'IQD' }), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.suppliers.archive': { body: (ids) => ({ supplierId: ids.supplierId, archived: true }), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.suppliers.list': { body: () => ({ active: 'all' }), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.suppliers.get': { body: (ids) => ({ supplierId: ids.supplierId }), foreignIds: 'refused', otherBranchIds: 'scoped' },
  // Purchase orders (phase 4): branch-scoped. The supplier and the product must be the business's own.
  'ph.po.create': { body: (ids) => poBody(ids), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.po.update': { body: (ids, n) => ({ ...poBody(ids), purchaseOrderId: pick(ids, n).purchaseOrderId, expectedVersion: 1 }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.po.order': { body: (ids, n) => ({ purchaseOrderId: pick(ids, n).purchaseOrderId, expectedVersion: 1 }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.po.cancel': { body: (ids, n) => ({ purchaseOrderId: pick(ids, n).purchaseOrderId, expectedVersion: 1 }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.po.close': { body: (ids, n) => ({ purchaseOrderId: pick(ids, n).purchaseOrderId, expectedVersion: 1, reason: 'Planted' }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.po.list': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.po.get': { body: (ids, n) => ({ purchaseOrderId: pick(ids, n).purchaseOrderId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.po.suggest': { body: (ids) => ({ supplierId: ids.supplierId }), foreignIds: 'harmless', otherBranchIds: 'harmless' },
  'ph.po.receipts': { body: (ids, n) => ({ purchaseOrderId: pick(ids, n).purchaseOrderId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  // Supplier invoices (phase 4): business-wide records of confirmed receipt lines of the supplier. A foreign supplier, invoice or
  // receipt line is refused; inside the business any branch reaches them. Void is tried with a stale version so a success never
  // voids the seeded invoice the other cases read.
  'ph.invoices.create': { body: (ids) => invoiceBody(ids), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.invoices.void': { body: (ids) => ({ invoiceId: ids.invoiceId, expectedVersion: 99, reason: 'Planted' }), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.invoices.list': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.invoices.get': { body: (ids) => ({ invoiceId: ids.invoiceId }), foreignIds: 'refused', otherBranchIds: 'scoped' },
  'ph.invoices.variance': { body: (ids) => ({ invoiceId: ids.invoiceId }), foreignIds: 'refused', otherBranchIds: 'scoped' },
  'ph.invoices.invoiceable': { body: (ids) => ({ supplierId: ids.supplierId }), foreignIds: 'refused', otherBranchIds: 'scoped' },
  // Supplier payments and credit (phase 4, task 7): business-wide records of the supplier's invoices. A foreign supplier, invoice, payment or
  // credit note is refused; inside the business any branch reaches them (a success moves only the business's own seeded rows).
  'ph.supplierPayments.create': { body: (ids) => paymentBody(ids), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.supplierPayments.reverse': { body: (ids) => ({ paymentId: ids.paymentId, reason: 'Planted', clientKey: key() }), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.credits.apply': { body: (ids) => ({ creditNoteId: ids.creditNoteId, clientKey: key(), allocations: [{ invoiceId: ids.invoiceId, amountMinor: 1n }] }), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.supplierPayments.list': { body: () => ({ includeReversals: true }), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.supplierPayments.get': { body: (ids) => ({ paymentId: ids.paymentId }), foreignIds: 'refused', otherBranchIds: 'scoped' },
  // Supplier returns and credit notes (phase 4, task 8). A return is branch-scoped (its stock is the place's branch); a credit note is
  // business-wide, but the return it may point to is branch-scoped, so another branch's return reads as not found.
  'ph.supplierReturns.create': { body: (ids, n) => supplierReturnBody(ids, n), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.supplierReturns.list': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.supplierReturns.get': { body: (ids, n) => ({ returnId: pick(ids, n).supplierReturnId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.credits.record': { body: (ids, n) => creditNoteBody(ids, n), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.credits.list': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.credits.get': { body: (ids) => ({ creditNoteId: ids.creditNoteId }), foreignIds: 'refused', otherBranchIds: 'scoped' },
  // Supplier statement and payables (phase 4, task 9): business-wide reads. A foreign supplier is not found; lists and balances show only the business's own rows.
  'ph.suppliers.statement': { body: (ids) => ({ supplierId: ids.supplierId, currency: 'IQD', from: '2026-10-01', to: '2026-10-27' }), foreignIds: 'refused', otherBranchIds: 'scoped' },
  'ph.payables.list': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.suppliers.balances': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  // Reading stock: filters that name the other side's rows answer nothing of theirs
  'ph.stock.balances': { body: (ids) => ({ productId: ids.productId, onlyWithStock: true }), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.stock.movements': {
    body: (ids, n) => ({ productId: ids.productId, batchId: pick(ids, n).batchId, receiptId: pick(ids, n).receiptId }),
    foreignIds: 'scoped',
    otherBranchIds: 'scoped',
  },
};

// The sweep -------------------------------------------------------------------------------------------------------------

describe('the pharmacy isolation sweep', () => {
  it('has an entry for every pharmacy action and query, and none for one that does not exist', () => {
    expect(DEFINITIONS.size).toBeGreaterThan(30);
    const listed = [...Object.keys(CASES), ...COVERED_ELSEWHERE];
    expect([...DEFINITIONS.keys()].filter((name) => !listed.includes(name)), 'definitions without an entry').toEqual([]);
    expect(listed.filter((name) => !DEFINITIONS.has(name)), 'entries for no definition').toEqual([]);
    expect(listed.filter((name, index) => listed.indexOf(name) !== index), 'entries twice').toEqual([]);
  });

  it('covers every phase 2 definition: stock, receipts, counts, balances, movements and expiry', () => {
    const phase2 = [...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.stock.'));
    expect(phase2.length).toBeGreaterThanOrEqual(21);
    expect(phase2.filter((name) => CASES[name] === undefined)).toEqual([]);
  });

  it('covers every phase 3 sales definition', () => {
    const sales = [...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.sales.'));
    expect(sales.sort()).toEqual(['ph.sales.cancel', 'ph.sales.create', 'ph.sales.discardHold', 'ph.sales.get', 'ph.sales.hold', 'ph.sales.holds', 'ph.sales.list', 'ph.sales.resume']);
    expect(sales.filter((name) => CASES[name] === undefined)).toEqual([]);
  });

  it('covers every phase 4 supplier and purchase order definition', () => {
    const names = [...DEFINITIONS.keys()];
    expect(names.filter((name) => name.startsWith('ph.suppliers.')).sort()).toEqual(['ph.suppliers.archive', 'ph.suppliers.balances', 'ph.suppliers.create', 'ph.suppliers.get', 'ph.suppliers.list', 'ph.suppliers.statement', 'ph.suppliers.update']);
    expect(names.filter((name) => name.startsWith('ph.po.')).sort()).toEqual(['ph.po.cancel', 'ph.po.close', 'ph.po.create', 'ph.po.get', 'ph.po.list', 'ph.po.order', 'ph.po.receipts', 'ph.po.suggest', 'ph.po.update']);
    expect(names.filter((name) => (name.startsWith('ph.suppliers.') || name.startsWith('ph.po.')) && CASES[name] === undefined)).toEqual([]);
  });

  it('covers every phase 4 supplier invoice definition', () => {
    const names = [...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.invoices.'));
    expect(names.sort()).toEqual(['ph.invoices.create', 'ph.invoices.get', 'ph.invoices.invoiceable', 'ph.invoices.list', 'ph.invoices.variance', 'ph.invoices.void']);
    expect(names.filter((name) => CASES[name] === undefined)).toEqual([]);
  });

  it('covers every phase 4 supplier payment and credit definition', () => {
    const names = [...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.supplierPayments.') || name === 'ph.credits.apply');
    expect(names.sort()).toEqual(['ph.credits.apply', 'ph.supplierPayments.create', 'ph.supplierPayments.get', 'ph.supplierPayments.list', 'ph.supplierPayments.reverse']);
    expect(names.filter((name) => CASES[name] === undefined)).toEqual([]);
  });

  it('covers every phase 4 supplier return and credit note definition', () => {
    const names = [...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.supplierReturns.') || name.startsWith('ph.credits.'));
    expect(names.sort()).toEqual(['ph.credits.apply', 'ph.credits.get', 'ph.credits.list', 'ph.credits.record', 'ph.supplierReturns.create', 'ph.supplierReturns.get', 'ph.supplierReturns.list']);
    expect(names.filter((name) => name !== 'ph.credits.apply' && CASES[name] === undefined)).toEqual([]);
  });

  it('covers all 34 phase 4 definitions by name, each with a sweep case of its own and none left to another file', () => {
    const PHASE_4 = [
      'ph.credits.apply', 'ph.credits.get', 'ph.credits.list', 'ph.credits.record',
      'ph.invoices.create', 'ph.invoices.get', 'ph.invoices.invoiceable', 'ph.invoices.list', 'ph.invoices.variance', 'ph.invoices.void',
      'ph.payables.list',
      'ph.po.cancel', 'ph.po.close', 'ph.po.create', 'ph.po.get', 'ph.po.list', 'ph.po.order', 'ph.po.receipts', 'ph.po.suggest', 'ph.po.update',
      'ph.supplierPayments.create', 'ph.supplierPayments.get', 'ph.supplierPayments.list', 'ph.supplierPayments.reverse',
      'ph.supplierReturns.create', 'ph.supplierReturns.get', 'ph.supplierReturns.list',
      'ph.suppliers.archive', 'ph.suppliers.balances', 'ph.suppliers.create', 'ph.suppliers.get', 'ph.suppliers.list', 'ph.suppliers.statement', 'ph.suppliers.update',
    ];
    expect(PHASE_4).toHaveLength(34);
    const families = /^ph\.(credits|invoices|payables|po|supplierPayments|supplierReturns|suppliers)\./;
    // Every definition of those families is on the list (a new one must be added here), and every listed name exists.
    expect([...DEFINITIONS.keys()].filter((name) => families.test(name)).sort()).toEqual([...PHASE_4].sort());
    expect(PHASE_4.filter((name) => CASES[name] === undefined)).toEqual([]);
    expect(PHASE_4.filter((name) => COVERED_ELSEWHERE.includes(name))).toEqual([]);
  });

  it('covers the sale screen search', () => {
    const sell = [...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.sell.'));
    expect(sell).toEqual(['ph.sell.search']);
    expect(sell.filter((name) => CASES[name] === undefined)).toEqual([]);
  });

  it('covers every phase 3 return definition', () => {
    const returns = [...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.returns.'));
    expect(returns.sort()).toEqual(['ph.returns.create', 'ph.returns.get', 'ph.returns.list', 'ph.returns.preview', 'ph.returns.returnable']);
    expect(returns.filter((name) => CASES[name] === undefined)).toEqual([]);
  });

  it('covers every phase 3 printing definition', () => {
    const prints = [...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.receipts.'));
    expect(prints.sort()).toEqual(['ph.receipts.get', 'ph.receipts.reprint', 'ph.receipts.returnReceipt']);
    expect(prints.filter((name) => CASES[name] === undefined)).toEqual([]);
  });

  it('covers every phase 3 shift and cash definition', () => {
    const shifts = [...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.shifts.') || name.startsWith('ph.cash.'));
    expect(shifts.sort()).toEqual(['ph.cash.paidIn', 'ph.cash.paidOut', 'ph.shifts.close', 'ph.shifts.current', 'ph.shifts.list', 'ph.shifts.open', 'ph.shifts.report']);
    expect(shifts.filter((name) => CASES[name] === undefined)).toEqual([]);
  });
});

// Running -----------------------------------------------------------------------------------------------------------------

const json = (value: unknown) => JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
const actorOf = async (who: Person): Promise<Actor> => (await loadActor(prisma(), who.userId)) as Actor;

async function run(def: Definition, who: Person, input: Record<string, unknown>): Promise<ActionResult<unknown>> {
  const actor = await actorOf(who);
  return def.kind === 'action' ? runAction(prisma(), actor, def, input, META) : runQuery(prisma(), actor, def, input);
}
const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);

/**
 * Everything the stock definitions can change, for one business or for one of its branches, as one string. Rows of the
 * audit log about the business are in it too, so a refused call may not leave a trace there either.
 */
async function snapshot(ids: Ids, branchId?: string): Promise<string> {
  const where = { restaurantId: ids.restaurantId, ...(branchId ? { branchId } : {}) };
  const orderBy = { id: 'asc' as const };
  const receipts = await prisma().phReceipt.findMany({ where, orderBy });
  const counts = await prisma().phStockCount.findMany({ where, orderBy });
  const sales = await prisma().phSale.findMany({ where, orderBy });
  const shifts = await prisma().phShift.findMany({ where, orderBy });
  const returns = await prisma().phReturn.findMany({ where, orderBy });
  const orders = await prisma().phPurchaseOrder.findMany({ where, orderBy });
  const supplierReturns = await prisma().phSupplierReturn.findMany({ where, orderBy });
  const invoices = branchId ? [] : await prisma().phSupplierInvoice.findMany({ where: { restaurantId: ids.restaurantId }, orderBy });
  const businessWide = branchId ? undefined : { where: { restaurantId: ids.restaurantId }, orderBy };
  return json({
    // Supplier payments, their allocations, credit notes and credit allocations belong to the business, so they are compared for a whole business only.
    supplierPayments: businessWide ? await prisma().phSupplierPayment.findMany(businessWide) : undefined,
    supplierPaymentAllocations: businessWide ? await prisma().phSupplierPaymentAllocation.findMany(businessWide) : undefined,
    creditNotes: businessWide ? await prisma().phCreditNote.findMany(businessWide) : undefined,
    creditAllocations: businessWide ? await prisma().phCreditAllocation.findMany(businessWide) : undefined,
    invoices,
    invoiceLines: await prisma().phSupplierInvoiceLine.findMany({ where: { invoiceId: { in: invoices.map((i) => i.id) } }, orderBy }),
    orders,
    supplierReturns,
    supplierReturnLines: await prisma().phSupplierReturnLine.findMany({ where: { returnId: { in: supplierReturns.map((r) => r.id) } }, orderBy }),
    orderLines: await prisma().phPurchaseOrderLine.findMany({ where: { purchaseOrderId: { in: orders.map((o) => o.id) } }, orderBy }),
    // Suppliers belong to the business, so they are compared for a whole business only.
    suppliers: branchId ? undefined : await prisma().phSupplier.findMany({ where: { restaurantId: ids.restaurantId }, orderBy }),
    sales,
    returns,
    reprints: await prisma().phReceiptReprint.findMany({ where: { restaurantId: ids.restaurantId }, orderBy }),
    returnLines: await prisma().phReturnLine.findMany({ where: { returnId: { in: returns.map((x) => x.id) } }, orderBy }),
    allocations: await prisma().phSaleLineAllocation.findMany({ where: { saleLineId: { in: (await prisma().phSaleLine.findMany({ where: { saleId: { in: sales.map((x) => x.id) } }, select: { id: true } })).map((l) => l.id) } }, orderBy }),
    saleLines: await prisma().phSaleLine.findMany({ where: { saleId: { in: sales.map((x) => x.id) } }, orderBy }),
    payments: await prisma().phPayment.findMany({ where: { saleId: { in: sales.map((x) => x.id) } }, orderBy }),
    cash: await prisma().phCashMovement.findMany({ where: { shiftId: { in: shifts.map((x) => x.id) } }, orderBy }),
    batches: branchId ? undefined : await prisma().phBatch.findMany({ where: { restaurantId: ids.restaurantId }, orderBy }),
    balances: await prisma().phStockBalance.findMany({ where, orderBy }),
    movements: await prisma().phStockMovement.findMany({ where, orderBy }),
    expiry: await prisma().phExpiryAction.findMany({ where, orderBy }),
    receipts,
    receiptLines: await prisma().phReceiptLine.findMany({ where: { receiptId: { in: receipts.map((r) => r.id) } }, orderBy }),
    counts,
    countLines: await prisma().phStockCountLine.findMany({ where: { countId: { in: counts.map((c) => c.id) } }, orderBy }),
    // Support reads are logged by design (a granted Super Admin leaves a `support.read` row even when refused): checked on their own.
    audit: branchId ? undefined : await prisma().auditLog.findMany({ where: { restaurantId: ids.restaurantId, action: { not: 'support.read' } }, orderBy }),
  });
}

/**
 * The ids and names that identify a side's rows, to look for in an answer. For one branch: its id and its documents
 * (movement, receipt, count and count line). Not its batch: a batch belongs to the business, and once stock is put into it
 * in branch 1 it rightly shows there.
 */
function tracesOf(ids: Ids, branch?: 1 | 2): string[] {
  const docs = (n: 1 | 2) => {
    const { movementId, receiptId, countId, lineId, saleId, shiftId, returnId, purchaseOrderId, supplierReturnId } = pick(ids, n);
    return [n === 1 ? ids.b1 : ids.b2, movementId, receiptId, countId, lineId, saleId, shiftId, returnId, purchaseOrderId, supplierReturnId];
  };
  if (branch) return docs(branch);
  return [ids.restaurantId, ids.categoryId, ids.tradeName, ids.batch1, ids.batch2, ids.lot1, ids.lot2, ids.supplierId, ids.supplierName, ids.invoiceId, ids.invoiceNumber, ids.invReceiptId, ids.invLineId, ids.paymentId, ids.creditNoteId, ...docs(1), ...docs(2)];
}

interface Attack {
  who: Person;
  place: { restaurantId: string; branchId?: string };
  /** Whose ids the input names, and the branch whose documents. */
  names: Ids;
  branch: 1 | 2;
  outcome: Outcome;
  /** Codes that count as a refusal here. */
  refusals: string[];
  /** The rows that must stay as they are, and what must not appear in the answer. */
  guarded: { ids: Ids; branchId?: string; traces: string[] };
}
const STRICT = ['NOT_FOUND', 'FORBIDDEN'];
const WITH_INVALID = ['NOT_FOUND', 'FORBIDDEN', 'INVALID'];

async function attack(name: string, a: Attack): Promise<void> {
  const def = DEFINITIONS.get(name)!;
  const testCase = CASES[name]!;
  const label = `${name} as ${a.who.email} at ${JSON.stringify(a.place)} naming branch ${a.branch} of ${a.names.tradeName}`;
  const before = await snapshot(a.guarded.ids, a.guarded.branchId);
  const result = await run(def, a.who, { ...testCase.body(a.names, a.branch), ...a.place });
  const code = codeOf(result);
  if (a.outcome === 'refused') expect(a.refusals, `${label} answered ${code}`).toContain(code);
  if (a.outcome === 'scoped') expect(code, label).toBe('OK');
  const shown = json(result);
  for (const trace of a.guarded.traces) expect(shown.includes(trace), `${label} shows ${trace}`).toBe(false);
  expect(await snapshot(a.guarded.ids, a.guarded.branchId), `${label} changed something`).toBe(before);
}

describe.each(Object.keys(CASES))('%s', (name) => {
  const c = CASES[name]!;

  it("refuses a person of A who names B's pharmacy or one of B's branches, and leaves B as it was", async () => {
    const { a, b, ownerA } = world;
    const guarded = { ids: b, traces: tracesOf(b) };
    // B's pharmacy and branch named outright.
    await attack(name, { who: ownerA, place: { restaurantId: b.restaurantId, branchId: b.b1 }, names: b, branch: 1, outcome: 'refused', refusals: STRICT, guarded });
    await attack(name, { who: ownerA, place: { restaurantId: b.restaurantId }, names: b, branch: 1, outcome: 'refused', refusals: STRICT, guarded });
    // A's pharmacy with one of B's branches.
    await attack(name, { who: ownerA, place: { restaurantId: a.restaurantId, branchId: b.b1 }, names: b, branch: 1, outcome: 'refused', refusals: STRICT, guarded });
    await attack(name, { who: ownerA, place: { restaurantId: a.restaurantId, branchId: b.b2 }, names: b, branch: 2, outcome: 'refused', refusals: STRICT, guarded });
  });

  it("answers a person of A who names B's rows from A's own place with nothing of B's, and leaves B as it was", async () => {
    const { a, b, ownerA, managerA1 } = world;
    const guarded = { ids: b, traces: tracesOf(b) };
    for (const branch of [1, 2] as const) {
      for (const who of [ownerA, managerA1]) {
        for (const place of [{ restaurantId: a.restaurantId, branchId: a.b1 }, { restaurantId: a.restaurantId }]) {
          await attack(name, { who, place, names: b, branch, outcome: c.foreignIds, refusals: WITH_INVALID, guarded });
        }
      }
    }
  });

  it("does not let B's own people into A", async () => {
    const { a, ownerB } = world;
    const guarded = { ids: a, traces: tracesOf(a) };
    await attack(name, { who: ownerB, place: { restaurantId: a.restaurantId, branchId: a.b1 }, names: a, branch: 1, outcome: 'refused', refusals: STRICT, guarded });
    await attack(name, { who: ownerB, place: { restaurantId: a.restaurantId }, names: a, branch: 2, outcome: 'refused', refusals: STRICT, guarded });
  });

  it('keeps a branch-1-only person out of branch 2, to read and to write', async () => {
    const { a, b, managerA1 } = world;
    const guarded = { ids: a, branchId: a.b2, traces: tracesOf(a, 2) };
    // The other branch named as the place: the framework refuses it.
    await attack(name, { who: managerA1, place: { restaurantId: a.restaurantId, branchId: a.b2 }, names: a, branch: 2, outcome: 'refused', refusals: STRICT, guarded });
    // Branch 2's documents named from branch 1, and from no branch (all of the person's branches, which is branch 1).
    await attack(name, { who: managerA1, place: { restaurantId: a.restaurantId, branchId: a.b1 }, names: a, branch: 2, outcome: c.otherBranchIds, refusals: WITH_INVALID, guarded });
    await attack(name, { who: managerA1, place: { restaurantId: a.restaurantId }, names: a, branch: 2, outcome: c.otherBranchIds, refusals: WITH_INVALID, guarded });
    // And never into B's branch.
    await attack(name, { who: managerA1, place: { restaurantId: b.restaurantId, branchId: b.b1 }, names: b, branch: 1, outcome: 'refused', refusals: STRICT, guarded: { ids: b, traces: tracesOf(b) } });
  });
});

describe('the sweep is not passing because everyone is refused', () => {
  it('lets the branch-1 manager and the owner work in their own place', async () => {
    const { a, ownerA, managerA1 } = world;
    const place = { restaurantId: a.restaurantId, branchId: a.b1 };
    for (const who of [ownerA, managerA1]) {
      const balances = await run(DEFINITIONS.get('ph.stock.balances')!, who, { ...place, productId: a.productId });
      expect(codeOf(balances)).toBe('OK');
      expect(json(balances)).toContain(a.lot1);
      expect(json(balances)).not.toContain(a.b2);
      const adjusted = await run(DEFINITIONS.get('ph.stock.adjust')!, who, { ...place, ...CASES['ph.stock.adjust']!.body(a, 1) });
      expect(codeOf(adjusted)).toBe('OK');
    }
    // The owner sees branch 2 too, by choosing it.
    const second = await run(DEFINITIONS.get('ph.stock.balances')!, ownerA, { restaurantId: a.restaurantId, branchId: a.b2, productId: a.productId });
    expect(json(second)).toContain(a.b2);
    // The manager sees branch 1 only, with no branch chosen.
    const all = await run(DEFINITIONS.get('ph.stock.movements')!, managerA1, { restaurantId: a.restaurantId });
    expect(codeOf(all)).toBe('OK');
    expect(json(all)).toContain(a.move1);
    expect(json(all)).not.toContain(a.move2);
  });
});

// Roles and support (phase 3) ------------------------------------------------------------------------------------------

/**
 * Who may call each phase 3 definition, in the caller's own place and naming the pharmacy's own branch-1 documents. A
 * stock-only role and a Super Admin (with or without a support grant) are refused on every one of them: they cannot sell,
 * count cash, return or print. An accountant reads (sales, shifts, returns, receipts) but sells and counts no cash; a
 * cashier works only on their own shift and sales and never returns or cancels. `OK` means the call went through the
 * permission and scope checks (a cashier's `CONFLICT` is a sale-state refusal, not a permission one).
 */
const REFUSED_ALWAYS = ['stock', 'support', 'supportNoGrant'] as const;
const ROLE_MATRIX: Record<string, { accountant: string; cashier: string }> = {
  'ph.sales.create': { accountant: 'FORBIDDEN', cashier: 'CONFLICT' },
  'ph.sales.get': { accountant: 'OK', cashier: 'NOT_FOUND' },
  'ph.sales.list': { accountant: 'OK', cashier: 'OK' },
  'ph.sales.hold': { accountant: 'FORBIDDEN', cashier: 'CONFLICT' },
  'ph.sales.resume': { accountant: 'FORBIDDEN', cashier: 'CONFLICT' },
  'ph.sales.discardHold': { accountant: 'FORBIDDEN', cashier: 'CONFLICT' },
  'ph.sales.holds': { accountant: 'FORBIDDEN', cashier: 'OK' },
  'ph.sell.search': { accountant: 'OK', cashier: 'OK' },
  'ph.shifts.open': { accountant: 'FORBIDDEN', cashier: 'OK' },
  'ph.cash.paidIn': { accountant: 'FORBIDDEN', cashier: 'OK' },
  'ph.cash.paidOut': { accountant: 'FORBIDDEN', cashier: 'OK' },
  'ph.shifts.close': { accountant: 'OK', cashier: 'FORBIDDEN' },
  'ph.shifts.current': { accountant: 'FORBIDDEN', cashier: 'OK' },
  'ph.shifts.report': { accountant: 'OK', cashier: 'NOT_FOUND' },
  'ph.shifts.list': { accountant: 'OK', cashier: 'OK' },
  'ph.returns.create': { accountant: 'FORBIDDEN', cashier: 'FORBIDDEN' },
  'ph.sales.cancel': { accountant: 'FORBIDDEN', cashier: 'FORBIDDEN' },
  'ph.returns.get': { accountant: 'OK', cashier: 'FORBIDDEN' },
  'ph.returns.returnable': { accountant: 'OK', cashier: 'FORBIDDEN' },
  'ph.returns.list': { accountant: 'OK', cashier: 'FORBIDDEN' },
  'ph.people.names': { accountant: 'OK', cashier: 'OK' },
  'ph.returns.preview': { accountant: 'INVALID', cashier: 'FORBIDDEN' },
  'ph.receipts.get': { accountant: 'OK', cashier: 'OK' },
  'ph.receipts.returnReceipt': { accountant: 'OK', cashier: 'OK' },
  'ph.receipts.reprint': { accountant: 'OK', cashier: 'OK' },
};
const PHASE3 = /^ph\.(sales|sell|shifts|cash|returns|receipts)\./;

describe('who may call the phase 3 definitions', () => {
  let people: Record<'stock' | 'accountant' | 'cashier' | 'support' | 'supportNoGrant', Person>;
  beforeAll(async () => {
    const { a } = world;
    people = {
      stock: await person('stockA1', { staff: [a.restaurantId, 'STOCK', [a.b1]] }),
      accountant: await person('accA1', { staff: [a.restaurantId, 'ACCOUNTANT', [a.b1]] }),
      cashier: await person('cashA1', { staff: [a.restaurantId, 'CASHIER', [a.b1]] }),
      support: await person('supA', { superAdmin: true }),
      supportNoGrant: await person('supB', { superAdmin: true }),
    };
    await grant(people.support, a.restaurantId, { scopes: ['catalog.read', 'sales.read', 'stock.read'] });
  });

  it('has a row for every phase 3 definition, and none for one that does not exist', () => {
    const phase3 = [...DEFINITIONS.keys()].filter((name) => PHASE3.test(name));
    expect(phase3.filter((name) => ROLE_MATRIX[name] === undefined), 'definitions without a row').toEqual([]);
    expect(Object.keys(ROLE_MATRIX).filter((name) => !DEFINITIONS.has(name)), 'rows for no definition').toEqual([]);
  });

  it('refuses a stock-only role, a support grant and a Super Admin with none on every phase 3 definition, and changes nothing', async () => {
    const { a } = world;
    const place = { restaurantId: a.restaurantId, branchId: a.b1 };
    const before = await snapshot(a);
    for (const name of Object.keys(ROLE_MATRIX)) {
      for (const who of REFUSED_ALWAYS) {
        const result = await run(DEFINITIONS.get(name)!, people[who], { ...CASES[name]!.body(a, 1), ...place });
        expect(codeOf(result), `${name} as ${who}`).toBe('FORBIDDEN');
        expect(json(result), `${name} as ${who} shows ${a.tradeName}`).not.toContain(a.tradeName);
      }
    }
    expect(await snapshot(a)).toBe(before);
    // The granted Super Admin left a trail of what they tried to read.
    expect(await prisma().auditLog.count({ where: { restaurantId: a.restaurantId, actorId: people.support.userId, action: 'support.read' } })).toBeGreaterThan(0);
  });

  it('keeps the cashier to their own sales and shifts, and away from returns, cancels and other people’s drawers', async () => {
    const { a } = world;
    const place = { restaurantId: a.restaurantId, branchId: a.b1 };
    for (const [name, expected] of Object.entries(ROLE_MATRIX)) {
      if (name === 'ph.shifts.close') continue;
      const result = await run(DEFINITIONS.get(name)!, people.cashier, { ...CASES[name]!.body(a, 1), ...place });
      expect(codeOf(result), `${name} as the cashier`).toBe(expected.cashier);
    }
    expect(codeOf(await run(DEFINITIONS.get('ph.shifts.close')!, people.cashier, { ...CASES['ph.shifts.close']!.body(a, 1), ...place }))).toBe('FORBIDDEN');
    // The cashier's lists show none of the owner's sales or shifts (the cashier has sold nothing).
    expect(json(await run(DEFINITIONS.get('ph.sales.list')!, people.cashier, place))).not.toContain(a.sale1);
    expect(json(await run(DEFINITIONS.get('ph.shifts.list')!, people.cashier, place))).not.toContain(a.shift1);
    // What the cashier did by the way (opening a shift) is the cashier's own and in branch 1.
    expect(await prisma().phShift.count({ where: { userId: people.cashier.userId, branchId: a.b2 } })).toBe(0);
    expect(await prisma().phShift.count({ where: { userId: people.cashier.userId, branchId: a.b1 } })).toBe(1);
  });

  it('lets the accountant read, refuses what sells, counts cash or returns, and keeps the accountant to branch 1', async () => {
    const { a } = world;
    const place = { restaurantId: a.restaurantId, branchId: a.b1 };
    for (const [name, expected] of Object.entries(ROLE_MATRIX)) {
      if (name === 'ph.shifts.close') continue;
      const result = await run(DEFINITIONS.get(name)!, people.accountant, { ...CASES[name]!.body(a, 1), ...place });
      expect(codeOf(result), `${name} as the accountant`).toBe(expected.accountant);
    }
    const second = await run(DEFINITIONS.get('ph.sales.get')!, people.accountant, { ...place, saleId: a.sale2 });
    expect(codeOf(second)).toBe('NOT_FOUND');
  });

  it('lets a report.view holder close another person’s drawer (the accountant), as the last case: it really closes it', async () => {
    const { a } = world;
    const place = { restaurantId: a.restaurantId, branchId: a.b1 };
    const result = await run(DEFINITIONS.get('ph.shifts.close')!, people.accountant, { ...CASES['ph.shifts.close']!.body(a, 1), ...place });
    expect(codeOf(result)).toBe(ROLE_MATRIX['ph.shifts.close']!.accountant);
    expect((await prisma().phShift.findUniqueOrThrow({ where: { id: a.shift1 } })).status).toBe('CLOSED');
  });
});
