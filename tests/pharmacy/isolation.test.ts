/// <reference types="vite/client" />
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as countActions from '@/server/pharmacy/actions/counts';
import * as poActions from '@/server/pharmacy/actions/purchase-orders';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import * as invoiceActions from '@/server/pharmacy/actions/supplier-invoices';
import * as paymentActions from '@/server/pharmacy/actions/supplier-payments';
import * as returnActions from '@/server/pharmacy/actions/supplier-returns';
import * as supplierActions from '@/server/pharmacy/actions/suppliers';
import { setAiProviderForTests } from '@/server/ai/provider';
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
  /** The intake batch of branch 1 / of branch 2 (phase 5, task 3) and its one stored file; the batch is branch-scoped, the file is reached through it. */
  intakeBatch1: string;
  intakeBatch2: string;
  intakeFile1: string;
  intakeFile2: string;
  /** One extracted line in each of those files (phase 5, task 6). */
  intakeRow1: string;
  intakeRow2: string;
  /** A requested transfer from branch 1 to branch 2 and one from branch 2 to branch 1 (phase 6, task 2); each touches both branches. */
  transfer1: string;
  transfer2: string;
  /** A prescription with one stored file and one register row in branch 1 / in branch 2 (phase 7, task 2); branch-scoped. */
  rx1: string;
  rx2: string;
  rxFile1: string;
  rxFile2: string;
  /** The business's customer (phase 7, task 3; business-wide) with a charge of the seeded sale, and a card payment at branch 1 / at branch 2 (branch-scoped). */
  customerId: string;
  customerName: string;
  custPay1: string;
  custPay2: string;
  /** An assistant proposal of the business in branch 1 / in branch 2 (phase 7, task 4); branch-scoped. */
  proposal1: string;
  proposal2: string;
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


async function seedSide(label: 'ALPHA' | 'BRAVO'): Promise<{ ids: Omit<Ids, 'receipt1' | 'receipt2' | 'count1' | 'count2' | 'line1' | 'line2' | 'supplierId' | 'supplierName' | 'po1' | 'po2' | 'invoiceId' | 'invoiceNumber' | 'invReceiptId' | 'invLineId' | 'paymentId' | 'creditNoteId' | 'supplierReturn1' | 'supplierReturn2' | 'intakeBatch1' | 'intakeBatch2' | 'intakeFile1' | 'intakeFile2' | 'intakeRow1' | 'intakeRow2' | 'transfer1' | 'transfer2' | 'rx1' | 'rx2' | 'rxFile1' | 'rxFile2' | 'customerId' | 'customerName' | 'custPay1' | 'custPay2' | 'proposal1' | 'proposal2'>; owner: Person }> {
  const biz = await pharmacy(label, { branches: 2 });
  const [b1, b2] = biz.branchIds as [string, string];
  const owner = await person(`owner${label}`, { membership: [biz.id, 'OWNER'] });
  // The business's settings row (provisioning makes it; the controlled-drug settings definitions read and save it).
  await prisma().phSettings.create({ data: { restaurantId: biz.id } });
  const category = await prisma().phCategory.create({ data: { restaurantId: biz.id, name: `${label} cat`, nameKey: `${label}-cat`.toLowerCase() }, select: { id: true } });
  const tradeName = `${label}DRUG`;
  const product = await makeProduct(biz.id, tradeName);
  const lot1 = `${label}-LOT1`;
  const lot2 = `${label}-LOT2`;
  // Stock with something for every report to show: a cost, an expiry within reach, damaged and quarantined units (phase 6, task 4: a sweep
  // over reports that read nothing proves nothing).
  const cost = { unitCostMinor: 100n, costUnitId: product.strip };
  const batch1 = await makeBatch(biz.id, b1, product.id, { lot: lot1, expiry: '2026-12-15', buckets: { available: 50, damaged: 3, quarantine: 2 }, cost });
  const batch2 = await makeBatch(biz.id, b2, product.id, { lot: lot2, expiry: '2026-11-20', buckets: { available: 40, damaged: 1 }, cost });
  // Each branch wants more of the product than it has, so the low-stock report lists both.
  await prisma().phProductBranch.createMany({
    data: [b1, b2].map((branchId) => ({ restaurantId: biz.id, branchId, productId: product.id, minQty: 100_000, reorderQty: 100 })),
  });
  const move1 = (await prisma().phStockMovement.findFirstOrThrow({ where: { batchId: batch1, branchId: b1 }, select: { id: true } })).id;
  const move2 = (await prisma().phStockMovement.findFirstOrThrow({ where: { batchId: batch2, branchId: b2 }, select: { id: true } })).id;
  // The owner works a shift in each branch, with a completed sale in it (made straight in the database).
  const saleIn = async (branchId: string, n: number) => {
    const shift = await prisma().phShift.create({ data: { restaurantId: biz.id, branchId, userId: owner.userId, currency: 'IQD' }, select: { id: true } });
    const made = await prisma().phSale.create({
      data: { restaurantId: biz.id, branchId, shiftId: shift.id, number: `20261027-00000${n}`, status: 'COMPLETED', currency: 'IQD', subtotalMinor: 500n, totalMinor: 500n, paidMinor: 500n, clientKey: `seed-sale-${label}-${n}`, soldById: owner.userId, completedAt: NOW },
      select: { id: true },
    });
    // One line sold from the branch's batch at a cost, and one return of part of it: the report SQL has money to count.
    const line = await prisma().phSaleLine.create({
      data: { restaurantId: biz.id, saleId: made.id, lineNo: 1, productId: product.id, unitId: product.strip, qty: 1, baseQty: 10, unitPriceMinor: 500n, discountMinor: 0n, totalMinor: 500n },
      select: { id: true },
    });
    const allocation = await prisma().phSaleLineAllocation.create({
      data: { restaurantId: biz.id, saleLineId: line.id, batchId: n === 1 ? batch1 : batch2, baseQty: 10, costSnapshotMinor: 100n, costCurrency: 'IQD', expirySnapshot: new Date('2026-12-15T00:00:00.000Z') },
      select: { id: true },
    });
    // Created at the fixed day of the world (the column default is the database clock, which would walk the row out of the cases' window).
    const returned = await prisma().phReturn.create({
      data: { restaurantId: biz.id, branchId, saleId: made.id, shiftId: shift.id, number: `R20261027-00000${n}`, reason: 'Seed', approvedById: owner.userId, refundMethod: 'CASH', refundMinor: 100n, currency: 'IQD', clientKey: `seed-return-${label}-${n}`, createdAt: NOW },
      select: { id: true },
    });
    await prisma().phReturnLine.create({ data: { restaurantId: biz.id, returnId: returned.id, saleLineAllocationId: allocation.id, baseQty: 2, refundMinor: 100n } });
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
  // One intake batch with a stored file in each branch (straight in the database; the object is never read).
  const intakeIn = async (branchId: string, n: 1 | 2) => {
    const batch = await prisma().phIntakeBatch.create({ data: { restaurantId: base.restaurantId, branchId, clientKey: `seed-intake-${branchId}`, payloadHash: 'seed', createdById: owner.userId }, select: { id: true } });
    const file = await prisma().phIntakeFile.create({
      data: { restaurantId: base.restaurantId, batchId: batch.id, sha256: createHash('sha256').update(`seed-file-${branchId}`).digest('hex'), storageKey: `intake/${base.restaurantId}/seed-file-${n}`, mediaType: 'application/pdf', bytes: 100, pages: 1, expiresAt: new Date(NOW.getTime() + 30 * 86_400_000), uploadedById: owner.userId },
      select: { id: true },
    });
    const row = await prisma().phIntakeRow.create({
      data: { restaurantId: base.restaurantId, fileId: file.id, lineNo: 1, page: 1, extracted: { name: 'Planted', strength: null, form: null, pack: null, quantity: 1, bonus: null, unitCost: 100, lineTotal: 100, lot: 'L1', expiry: '2028-03', barcodeText: null, unclear: [], page: 1 }, flags: ['MISSING'] },
      select: { id: true },
    });
    return { batch: batch.id, file: file.id, row: row.id };
  };
  const [i1, i2] = [await intakeIn(base.b1, 1), await intakeIn(base.b2, 2)];
  Object.assign(withDocs, { intakeBatch1: i1.batch, intakeBatch2: i2.batch, intakeFile1: i1.file, intakeFile2: i2.file, intakeRow1: i1.row, intakeRow2: i2.row });
  // One requested transfer each way (straight in the database): both touch both branches, so they are read at business level.
  const transferIn = async (from: string, to: string, n: 1 | 2) => {
    const made = await prisma().phTransfer.create({
      data: { restaurantId: base.restaurantId, fromBranchId: from, toBranchId: to, number: `T-SEED-${n}`, clientKey: `seed-transfer-${n}-${base.restaurantId}`, payloadHash: 'seed', requestedById: owner.userId, requestedAt: NOW },
      select: { id: true },
    });
    await prisma().phTransferLine.create({ data: { restaurantId: base.restaurantId, transferId: made.id, fromBranchId: from, toBranchId: to, lineNo: 1, productId: base.productId, requestedQty: 1 } });
    return made.id;
  };
  withDocs.transfer1 = await transferIn(base.b1, base.b2, 1);
  withDocs.transfer2 = await transferIn(base.b2, base.b1, 2);
  // One prescription in each branch with a stored file (straight in the database; the object is never read) and a register row of the
  // seeded sale (phase 7, task 2).
  const rxIn = async (branchId: string, n: 1 | 2, saleId: string, batchId: string) => {
    const made = await prisma().phPrescription.create({
      data: { restaurantId: base.restaurantId, branchId, number: `SEED-RX-${n}`, prescriberName: `Seed prescriber ${n}`, patientName: `Seed patient ${n}`, issuedOn: new Date('2026-10-20T00:00:00.000Z'), clientKey: `seed-rx-${branchId}`, payloadHash: 'seed', createdById: owner.userId },
      select: { id: true },
    });
    const file = await prisma().phRxAttachment.create({
      data: { restaurantId: base.restaurantId, branchId, prescriptionId: made.id, storageKey: `intake/${base.restaurantId}/rx-seed-${n}`, mime: 'image/png', sizeBytes: 10, sha256: createHash('sha256').update(`seed-rx-file-${branchId}`).digest('hex'), uploadedById: owner.userId },
      select: { id: true },
    });
    const line = await prisma().phSaleLine.findFirstOrThrow({ where: { saleId }, select: { id: true } });
    await prisma().phControlledEntry.create({
      data: { restaurantId: base.restaurantId, branchId, saleId, saleLineId: line.id, productId: base.productId, batchId, prescriptionId: made.id, baseQty: 1, kind: 'SALE', dispensedById: owner.userId, createdAt: NOW },
    });
    return { rx: made.id, file: file.id };
  };
  const [x1, x2] = [await rxIn(base.b1, 1, base.sale1, base.batch1), await rxIn(base.b2, 2, base.sale2, base.batch2)];
  Object.assign(withDocs, { rx1: x1.rx, rx2: x2.rx, rxFile1: x1.file, rxFile2: x2.file });
  // One customer of the business with a credit charge of the seeded sale and one card payment at each branch (straight in the database).
  withDocs.customerName = `${base.tradeName} Debtor`;
  withDocs.customerId = (
    await prisma().phCustomer.create({ data: { restaurantId: base.restaurantId, name: withDocs.customerName, phone: '0770 000 1111', creditLimitMinor: 100_000n, currency: 'IQD', note: 'seed note' }, select: { id: true } })
  ).id;
  await prisma().phCustomerLedger.create({ data: { restaurantId: base.restaurantId, customerId: withDocs.customerId, kind: 'CHARGE', amountMinor: 5000n, currency: 'IQD', saleId: base.sale1 } });
  const customerPaymentIn = async (branchId: string, n: 1 | 2) => {
    const made = await prisma().phCustomerPayment.create({
      data: { restaurantId: base.restaurantId, branchId, customerId: withDocs.customerId, method: 'CARD', amountMinor: 100n, currency: 'IQD', clientKey: `seed-cpay-${n}-${base.restaurantId}`, payloadHash: 'seed', createdById: owner.userId },
      select: { id: true },
    });
    await prisma().phCustomerLedger.create({ data: { restaurantId: base.restaurantId, customerId: withDocs.customerId, kind: 'PAYMENT', amountMinor: -100n, currency: 'IQD', paymentId: made.id } });
    return made.id;
  };
  withDocs.custPay1 = await customerPaymentIn(base.b1, 1);
  withDocs.custPay2 = await customerPaymentIn(base.b2, 2);
  // One open assistant proposal in each branch (straight in the database).
  const proposalIn = async (branchId: string) =>
    (await prisma().phAiProposal.create({ data: { restaurantId: base.restaurantId, branchId, kind: 'REORDER', payload: { lines: [{ productId: base.productId, qty: 1 }] }, createdById: owner.userId }, select: { id: true } })).id;
  withDocs.proposal1 = await proposalIn(base.b1);
  withDocs.proposal2 = await proposalIn(base.b2);
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
  // No assistant call may reach a model from this file: with no provider the answer is the plain tables.
  setAiProviderForTests(null);
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
  setAiProviderForTests(undefined);
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
  /** A transfer names both of its branches, so a person of one end legitimately sees the other end's id in it. */
  bothEnds?: true;
}

const pick = (ids: Ids, branch: 1 | 2) =>
  branch === 1
    ? { batchId: ids.batch1, movementId: ids.move1, receiptId: ids.receipt1, countId: ids.count1, lineId: ids.line1, saleId: ids.sale1, shiftId: ids.shift1, returnId: ids.return1, purchaseOrderId: ids.po1, supplierReturnId: ids.supplierReturn1, intakeBatchId: ids.intakeBatch1, intakeFileId: ids.intakeFile1, intakeRowId: ids.intakeRow1, transferId: ids.transfer1, rxId: ids.rx1, rxFileId: ids.rxFile1, custPayId: ids.custPay1, proposalId: ids.proposal1 }
    : { batchId: ids.batch2, movementId: ids.move2, receiptId: ids.receipt2, countId: ids.count2, lineId: ids.line2, saleId: ids.sale2, shiftId: ids.shift2, returnId: ids.return2, purchaseOrderId: ids.po2, supplierReturnId: ids.supplierReturn2, intakeBatchId: ids.intakeBatch2, intakeFileId: ids.intakeFile2, intakeRowId: ids.intakeRow2, transferId: ids.transfer2, rxId: ids.rx2, rxFileId: ids.rxFile2, custPayId: ids.custPay2, proposalId: ids.proposal2 };
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
  // Transfers (phase 6, task 2): a transfer belongs to both of its branches, so a person of either end reads it (with only two branches every
  // transfer touches branch 1; the third-branch proof is in transfers.test.ts). Writes carry a stale version so a success changes nothing the other cases read.
  'ph.transfers.request': { body: (ids, n) => ({ clientKey: key(), fromBranchId: n === 1 ? ids.b1 : ids.b2, toBranchId: n === 1 ? ids.b2 : ids.b1, lines: [{ productId: ids.productId, qty: 1 }] }), foreignIds: 'refused', otherBranchIds: 'harmless', bothEnds: true },
  'ph.transfers.update': { body: (ids, n) => ({ transferId: pick(ids, n).transferId, version: 99, lines: [{ productId: ids.productId, qty: 1 }] }), foreignIds: 'refused', otherBranchIds: 'harmless', bothEnds: true },
  'ph.transfers.cancel': { body: (ids, n) => ({ transferId: pick(ids, n).transferId, version: 99 }), foreignIds: 'refused', otherBranchIds: 'harmless', bothEnds: true },
  'ph.transfers.send': { body: (ids, n) => ({ transferId: pick(ids, n).transferId, version: 99, clientKey: key() }), foreignIds: 'refused', otherBranchIds: 'harmless', bothEnds: true },
  'ph.transfers.receive': { body: (ids, n) => ({ transferId: pick(ids, n).transferId, version: 99, clientKey: key(), lines: [{ lineId: 'none', receivedQty: 1 }] }), foreignIds: 'refused', otherBranchIds: 'harmless', bothEnds: true },
  'ph.transfers.list': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped', bothEnds: true },
  'ph.transfers.get': { body: (ids, n) => ({ transferId: pick(ids, n).transferId }), foreignIds: 'refused', otherBranchIds: 'harmless', bothEnds: true },
  'ph.transfers.inTransit': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped', bothEnds: true },
  // Reports (phase 6, task 4): read-only aggregates of the actor's own branches; the input names no id, so another side's ids can only appear if the SQL leaks. The transfers report names both ends of a transfer.
  'ph.reports.sales': { body: () => ({ from: '2026-10-01', to: '2026-10-31', groupBy: 'branch' }), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.reports.returns': { body: () => ({ from: '2026-10-01', to: '2026-10-31' }), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.reports.discounts': { body: () => ({ from: '2026-10-01', to: '2026-10-31' }), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.reports.margin': { body: () => ({ from: '2026-10-01', to: '2026-10-31', groupBy: 'product' }), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.reports.stockValuation': { body: () => ({ groupBy: 'product' }), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.reports.expiry': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  // Stock movements take the database clock, so this window is built around the real day (a fixed one would stop reading the rows one day).
  'ph.reports.damaged': { body: () => ({ from: baghdadDayFromNow(-2), to: baghdadDayFromNow(2) }), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.reports.transfers': { body: () => ({ from: '2026-10-01', to: '2026-10-31' }), foreignIds: 'scoped', otherBranchIds: 'scoped', bothEnds: true },
  'ph.reports.lowStock': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  // Chain dashboard (phase 6, task 5): the cards and the total of the actor's own branches; it names no id; a one-branch person is refused with CHAIN_NEEDS_MANY_BRANCHES (so the outcome is harmless, not scoped), and the owner case below proves the rows.
  'ph.chain.dashboard': { body: () => ({ from: '2026-10-01', to: '2026-10-31' }), foreignIds: 'harmless', otherBranchIds: 'harmless' },
  // Report export (phase 6, task 5): the file holds the rows of the actor's own branches (the file is base64, so the dedicated test below decodes it and looks for the ids; here the sweep only proves nothing is written or refused wrongly).
  'ph.exports.report': { body: () => ({ report: 'sales', format: 'csv', from: '2026-10-01', to: '2026-10-31', groupBy: 'branch' }), foreignIds: 'harmless', otherBranchIds: 'harmless' },
  'ph.credits.record': { body: (ids, n) => creditNoteBody(ids, n), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.credits.list': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.credits.get': { body: (ids) => ({ creditNoteId: ids.creditNoteId }), foreignIds: 'refused', otherBranchIds: 'scoped' },
  // Supplier statement and payables (phase 4, task 9): business-wide reads. A foreign supplier is not found; lists and balances show only the business's own rows.
  'ph.suppliers.statement': { body: (ids) => ({ supplierId: ids.supplierId, currency: 'IQD', from: '2026-10-01', to: '2026-10-27' }), foreignIds: 'refused', otherBranchIds: 'scoped' },
  'ph.payables.list': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.suppliers.balances': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  // Invoice intake (phase 5, task 3): a batch is branch-scoped, a file is reached through its batch, so another branch's file id is not found. A supplier of another business is not found.
  'ph.intake.batch.create': { body: (ids) => ({ clientKey: key(), supplierId: ids.supplierId }), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.intake.file.add': { body: (ids, n) => ({ batchId: pick(ids, n).intakeBatchId, clientKey: key(), mediaType: 'application/pdf', base64: Buffer.from(`%PDF-1.4
1 0 obj << /Type /Page >> endobj
% ${key()}
%%EOF`).toString('base64') }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.intake.file.url': { body: (ids, n) => ({ fileId: pick(ids, n).intakeFileId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  // AI usage (phase 5, task 4): the month's figures of the actor's own business; the other business's usage is never in them.
  'ph.intake.usage': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  // Reading an invoice with AI (phase 5, task 5): the file is reached through its batch, so another branch's or business's file is not found. The seeded file has no stored object, so a success only marks it FAILED (FILE_MISSING).
  'ph.intake.extract': { body: (ids, n) => ({ fileId: pick(ids, n).intakeFileId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.intake.retry': { body: (ids, n) => ({ fileId: pick(ids, n).intakeFileId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  // Reviewing an invoice (phase 5, task 6): a line is reached through its file and batch, so another branch's or business's line, file or batch is not found; nothing of theirs changes.
  'ph.intake.row.update': { body: (ids, n) => ({ rowId: pick(ids, n).intakeRowId, version: 1, patch: { lot: 'Planted' }, clientKey: key() }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.intake.row.match': { body: (ids, n) => ({ rowId: pick(ids, n).intakeRowId, version: 1, productId: ids.productId, unitId: ids.unitId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.intake.row.clearMatch': { body: (ids, n) => ({ rowId: pick(ids, n).intakeRowId, version: 1 }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.intake.row.review': { body: (ids, n) => ({ rowId: pick(ids, n).intakeRowId, version: 1, shown: [], note: 'Planted' }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.intake.row.fillFromBarcode': { body: (ids, n) => ({ rowId: pick(ids, n).intakeRowId, version: 1 }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.intake.scan': { body: (ids, n) => ({ batchId: pick(ids, n).intakeBatchId, barcode: '6291000000013', clientKey: key() }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.intake.row.add': { body: (ids, n) => ({ fileId: pick(ids, n).intakeFileId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.intake.row.remove': { body: (ids, n) => ({ rowId: pick(ids, n).intakeRowId, version: 1 }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.intake.header.update': { body: (ids, n) => ({ batchId: pick(ids, n).intakeBatchId, version: 1, patch: { invoiceNumber: 'Planted' } }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.intake.header.acknowledge': { body: (ids, n) => ({ batchId: pick(ids, n).intakeBatchId, version: 1, shown: { difference: '0', currency: null }, reason: 'Planted' }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.intake.rematch': { body: (ids, n) => ({ batchId: pick(ids, n).intakeBatchId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  // Approval and cancel (phase 5, task 7): a batch is branch-scoped, so another branch's or business's batch id is not found.
  'ph.intake.approve': { body: (ids, n) => ({ batchId: pick(ids, n).intakeBatchId, clientKey: key(), expectedVersion: 1, verdictToken: 'f'.repeat(64) }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.intake.cancel': { body: (ids, n) => ({ batchId: pick(ids, n).intakeBatchId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.intake.batch.get': { body: (ids, n) => ({ batchId: pick(ids, n).intakeBatchId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.intake.batch.list': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  // Prescriptions and controlled medicines (phase 7, task 2): a prescription, its file and the register are branch-scoped, so another branch's or
  // business's id is not found. Creating and the settings save work only in the caller's own place (a stale version changes nothing).
  'ph.rx.create': { body: () => ({ clientKey: key(), number: `PLANTED ${key()}`, prescriberName: 'Planted', issuedOn: '2026-10-20' }), foreignIds: 'harmless', otherBranchIds: 'harmless' },
  'ph.rx.file.add': {
    body: (ids, n) => ({ prescriptionId: pick(ids, n).rxId, base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64') }),
    foreignIds: 'refused',
    otherBranchIds: 'refused',
  },
  'ph.rx.list': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.rx.get': { body: (ids, n) => ({ prescriptionId: pick(ids, n).rxId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.rx.register': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  // Seeded files have no stored object, so 'refused' here holds for any id; the real gate (a stored file, every refusal) is tests/pharmacy/rx-attachment-gate.test.ts.
  'ph.rx.attachment.read': { body: (ids, n) => ({ id: pick(ids, n).rxFileId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.settings.controlled.get': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.settings.controlled.set': { body: () => ({ controlledEnabled: false, controlledMaxQty: 30, rxRetentionDays: 3650, version: 1 }), foreignIds: 'harmless', otherBranchIds: 'harmless' },
  // Customers and credit (phase 7, task 3). A customer belongs to the business, so any branch reaches it and a foreign id is not found; a payment is
  // taken at one branch and is reached from that branch only. Writes that could succeed on the business's own row are made harmless (a stale version, an
  // archive to the state it is in, a payment of 1 that the seeded balance covers).
  'ph.customers.list': { body: () => ({ active: 'all' }), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.customers.get': { body: (ids) => ({ customerId: ids.customerId }), foreignIds: 'refused', otherBranchIds: 'scoped' },
  'ph.customers.create': { body: () => ({ name: `Planted ${key()}`, creditLimitMinor: 10n, currency: 'IQD' }), foreignIds: 'harmless', otherBranchIds: 'harmless' },
  'ph.customers.update': { body: (ids) => ({ customerId: ids.customerId, expectedVersion: 99, name: `Planted ${key()}`, creditLimitMinor: 10n }), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.customers.archive': { body: (ids) => ({ customerId: ids.customerId, archived: false }), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.credit.statement': { body: (ids) => ({ customerId: ids.customerId, from: '2026-10-01', to: '2026-10-31' }), foreignIds: 'refused', otherBranchIds: 'scoped' },
  'ph.credit.ageing': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.credit.payment.record': { body: (ids) => ({ customerId: ids.customerId, method: 'CARD', amountMinor: 1n, clientKey: key() }), foreignIds: 'refused', otherBranchIds: 'harmless' },
  'ph.credit.payment.reverse': { body: (ids, n) => ({ paymentId: pick(ids, n).custPayId, clientKey: key() }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.credit.settings.get': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.credit.settings.set': { body: () => ({ creditEnabled: false, version: 1 }), foreignIds: 'harmless', otherBranchIds: 'harmless' },
  // The daily assistant (phase 7, task 4). Asking reads through the scoped client and the tools' own queries, so a batch of another branch or business
  // answers nothing of theirs (the provider is switched off in this file: the answer is the tables). A proposal is branch-scoped: another branch's or
  // business's id is not found, and a transfer from a branch the person cannot reach is refused.
  'ph.assistant.ask': { body: (ids, n) => ({ question: 'What is expiring soon?', batchId: pick(ids, n).batchId }), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.assistant.proposals': { body: () => ({}), foreignIds: 'scoped', otherBranchIds: 'scoped' },
  'ph.assistant.proposal.create': {
    body: (ids, n) => ({ proposal: { kind: 'TRANSFER', fromBranchId: n === 1 ? ids.b1 : ids.b2, toBranchId: n === 1 ? ids.b2 : ids.b1, lines: [{ productId: ids.productId, qty: 1 }] } }),
    foreignIds: 'harmless',
    otherBranchIds: 'refused',
  },
  'ph.assistant.proposal.accept': { body: (ids, n) => ({ proposalId: pick(ids, n).proposalId }), foreignIds: 'refused', otherBranchIds: 'refused' },
  'ph.assistant.proposal.dismiss': { body: (ids, n) => ({ proposalId: pick(ids, n).proposalId }), foreignIds: 'refused', otherBranchIds: 'refused' },
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

  it('covers every phase 5 intake definition', () => {
    const names = [...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.intake.'));
    expect(names.sort()).toEqual([
      'ph.intake.approve', 'ph.intake.batch.create', 'ph.intake.batch.get', 'ph.intake.batch.list', 'ph.intake.cancel', 'ph.intake.extract', 'ph.intake.file.add', 'ph.intake.file.url',
      'ph.intake.header.acknowledge', 'ph.intake.header.update', 'ph.intake.rematch', 'ph.intake.retry',
      'ph.intake.row.add', 'ph.intake.row.clearMatch', 'ph.intake.row.fillFromBarcode', 'ph.intake.row.match', 'ph.intake.row.remove', 'ph.intake.row.review', 'ph.intake.row.update',
      'ph.intake.scan', 'ph.intake.usage',
    ]);
    expect(names.filter((name) => CASES[name] === undefined || COVERED_ELSEWHERE.includes(name))).toEqual([]);
  });

  it('covers every phase 7 prescription and controlled-drug definition, each with a sweep case of its own', () => {
    const names = [...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.rx.') || name.startsWith('ph.settings.controlled.'));
    expect(names.sort()).toEqual([
      'ph.rx.attachment.read', 'ph.rx.create', 'ph.rx.file.add', 'ph.rx.get', 'ph.rx.list', 'ph.rx.register',
      'ph.settings.controlled.get', 'ph.settings.controlled.set',
    ]);
    expect(names.filter((name) => CASES[name] === undefined || COVERED_ELSEWHERE.includes(name))).toEqual([]);
  });

  it('has real prescription rows to guard: the owner sees both branches’ prescriptions and register rows, the branch-1 manager only branch 1’s', async () => {
    const { a, b, ownerA, managerA1 } = world;
    for (const name of ['ph.rx.list', 'ph.rx.register']) {
      const owner = json(await run(DEFINITIONS.get(name)!, ownerA, { restaurantId: a.restaurantId }));
      expect(owner, `${name} shows branch 1 to the owner`).toContain(a.b1);
      expect(owner, `${name} shows branch 2 to the owner`).toContain(a.b2);
      expect(owner, `${name} shows nothing of the other business`).not.toContain(b.restaurantId);
      const mine = json(await run(DEFINITIONS.get(name)!, managerA1, { restaurantId: a.restaurantId }));
      expect(mine, `${name} shows branch 1 to the manager`).toContain(a.b1);
      expect(mine, `${name} leaks branch 2 to the branch-1 manager`).not.toContain(a.b2);
    }
    const list = json(await run(DEFINITIONS.get('ph.rx.list')!, ownerA, { restaurantId: a.restaurantId }));
    expect(list).toContain(a.rx1);
    expect(list).toContain(a.rx2);
    expect(list).not.toContain(b.rx1);
  });

  it('covers every phase 7 customer and credit definition, each with a sweep case of its own', () => {
    const names = [...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.customers.') || name.startsWith('ph.credit.'));
    expect(names.sort()).toEqual([
      'ph.credit.ageing', 'ph.credit.payment.record', 'ph.credit.payment.reverse', 'ph.credit.settings.get', 'ph.credit.settings.set', 'ph.credit.statement',
      'ph.customers.archive', 'ph.customers.create', 'ph.customers.get', 'ph.customers.list', 'ph.customers.update',
    ]);
    expect(names.filter((name) => CASES[name] === undefined || COVERED_ELSEWHERE.includes(name))).toEqual([]);
  });

  it('has real customer rows to guard: the owner and the branch-1 manager both see the business customer, its statement and ageing, and nothing of the other business or of branch 2', async () => {
    const { a, b, ownerA, managerA1 } = world;
    for (const who of [ownerA, managerA1]) {
      const place = { restaurantId: a.restaurantId };
      const list = json(await run(DEFINITIONS.get('ph.customers.list')!, who, place));
      expect(list).toContain(a.customerId);
      expect(list).not.toContain(b.customerId);
      const statement = json(await run(DEFINITIONS.get('ph.credit.statement')!, who, { ...place, ...CASES['ph.credit.statement']!.body(a, 1) }));
      expect(statement, 'the statement shows the charge').toContain('"CHARGE"');
      expect(statement).not.toContain(b.customerId);
      expect(statement).not.toContain(a.b2);
      const ageing = json(await run(DEFINITIONS.get('ph.credit.ageing')!, who, place));
      expect(ageing).toContain(a.customerId);
      expect(ageing).not.toContain(b.customerId);
      expect(ageing).not.toContain(b.customerName);
    }
  });

  it('covers every phase 7 assistant definition, each with a sweep case of its own', () => {
    const names = [...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.assistant.'));
    expect(names.sort()).toEqual(['ph.assistant.ask', 'ph.assistant.proposal.accept', 'ph.assistant.proposal.create', 'ph.assistant.proposal.dismiss', 'ph.assistant.proposals']);
    expect(names.filter((name) => CASES[name] === undefined || COVERED_ELSEWHERE.includes(name))).toEqual([]);
  });

  it('has real proposals to guard: the owner sees both branches of the business and the branch-1 manager only branch 1, and neither sees the other business', async () => {
    const { a, b, ownerA, managerA1 } = world;
    const place = { restaurantId: a.restaurantId };
    const owner = json(await run(DEFINITIONS.get('ph.assistant.proposals')!, ownerA, place));
    expect(owner).toContain(a.proposal1);
    expect(owner).toContain(a.proposal2);
    expect(owner).not.toContain(b.proposal1);
    const manager = json(await run(DEFINITIONS.get('ph.assistant.proposals')!, managerA1, place));
    expect(manager).toContain(a.proposal1);
    expect(manager, 'a branch-1 manager does not see branch 2').not.toContain(a.proposal2);
    expect(manager).not.toContain(b.proposal1);
  });

  it('covers every phase 6 transfer definition', () => {
    const names = [...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.transfers.'));
    expect(names.sort()).toEqual(['ph.transfers.cancel', 'ph.transfers.get', 'ph.transfers.inTransit', 'ph.transfers.list', 'ph.transfers.receive', 'ph.transfers.request', 'ph.transfers.send', 'ph.transfers.update']);
    expect(names.filter((name) => CASES[name] === undefined || COVERED_ELSEWHERE.includes(name))).toEqual([]);
  });

  it('covers every phase 6 report definition', () => {
    const names = [...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.reports.'));
    expect(names.sort()).toEqual([
      'ph.reports.damaged', 'ph.reports.discounts', 'ph.reports.expiry', 'ph.reports.lowStock', 'ph.reports.margin',
      'ph.reports.returns', 'ph.reports.sales', 'ph.reports.stockValuation', 'ph.reports.transfers',
    ]);
    expect(names.filter((name) => CASES[name] === undefined || COVERED_ELSEWHERE.includes(name))).toEqual([]);
  });

  it('covers the chain dashboard, and it has real rows: the owner sees both branches of their own business and none of the other, the branch-1 manager is told the view needs more branches', async () => {
    const names = [...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.chain.'));
    expect(names).toEqual(['ph.chain.dashboard']);
    expect(names.filter((name) => CASES[name] === undefined || COVERED_ELSEWHERE.includes(name))).toEqual([]);
    const { a, b, ownerA, managerA1 } = world;
    const c = CASES['ph.chain.dashboard']!;
    const owner = json(await run(DEFINITIONS.get('ph.chain.dashboard')!, ownerA, { ...c.body(a, 1), restaurantId: a.restaurantId }));
    expect(owner).toContain(a.b1);
    expect(owner).toContain(a.b2);
    expect(owner).toContain('"salesMinor"');
    expect(owner).not.toContain(b.b1);
    expect(owner).not.toContain(b.b2);
    const mine = await run(DEFINITIONS.get('ph.chain.dashboard')!, managerA1, { ...c.body(a, 1), restaurantId: a.restaurantId });
    expect(json(mine)).toContain('CHAIN_NEEDS_MANY_BRANCHES');
  });

  it('covers the report export, and the file shows the owner both branches of their own business, the branch-1 manager only branch 1, and nothing of the other business', async () => {
    expect([...DEFINITIONS.keys()].filter((name) => name.startsWith('ph.exports.')).sort()).toEqual(['ph.exports.products', 'ph.exports.report']);
    const { a, b, ownerA, managerA1 } = world;
    const c = CASES['ph.exports.report']!;
    const fileOf = async (actor: typeof ownerA) => {
      const out = JSON.parse(json(await run(DEFINITIONS.get('ph.exports.report')!, actor, { ...c.body(a, 1), restaurantId: a.restaurantId }))) as { data?: { base64: string } };
      return Buffer.from(out.data!.base64, 'base64').toString('utf8');
    };
    const owner = await fileOf(ownerA);
    expect(owner).toContain(a.b1);
    expect(owner).toContain(a.b2);
    expect(owner).not.toContain(b.b1);
    expect(owner).not.toContain(b.b2);
    const mine = await fileOf(managerA1);
    expect(mine).toContain(a.b1);
    expect(mine).not.toContain(a.b2);
  });

  it('the report cases have real rows to show: each report answers the owner with branch 1 in it, and the branch-1 manager with branch 1 and no branch 2', async () => {
    const { a, ownerA, managerA1 } = world;
    for (const name of Object.keys(CASES).filter((n) => n.startsWith('ph.reports.'))) {
      const c = CASES[name]!;
      const owner = json(await run(DEFINITIONS.get(name)!, ownerA, { ...c.body(a, 1), restaurantId: a.restaurantId }));
      expect(owner, `${name} shows branch 1 to the owner`).toContain(a.b1);
      expect(owner, `${name} shows branch 2 to the owner (so the manager check below looks at something)`).toContain(a.b2);
      const mine = json(await run(DEFINITIONS.get(name)!, managerA1, { ...c.body(a, 1), restaurantId: a.restaurantId }));
      expect(mine, `${name} shows branch 1 to the manager`).toContain(a.b1);
      // A transfer names both of its ends, so the transfers report may show branch 2 as the other end of a branch-1 transfer.
      if (!c.bothEnds) expect(mine, `${name} leaks branch 2 to the branch-1 manager`).not.toContain(a.b2);
    }
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

/** The Baghdad calendar day `shift` days from the real today (for windows around rows stamped by the database clock). */
function baghdadDayFromNow(shift: number): string {
  return new Date(vi.getRealSystemTime() + 3 * 3_600_000 + shift * 86_400_000).toISOString().slice(0, 10);
}
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
  const intakeBatches = await prisma().phIntakeBatch.findMany({ where, orderBy });
  return json({
    // Transfers belong to two branches, so they are compared for a whole business only (phase 6).
    transfers: businessWide ? await prisma().phTransfer.findMany(businessWide) : undefined,
    transferLines: businessWide ? await prisma().phTransferLine.findMany(businessWide) : undefined,
    // Intake batches are branch-scoped; their files are reached through the batch (phase 5).
    intakeBatches,
    intakeFiles: await prisma().phIntakeFile.findMany({ where: { batchId: { in: intakeBatches.map((x) => x.id) } }, orderBy }),
    intakeRows: await prisma().phIntakeRow.findMany({ where: { file: { batchId: { in: intakeBatches.map((x) => x.id) } } }, orderBy }),
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
    // Prescriptions, their files and the controlled register are branch-scoped (phase 7).
    prescriptions: await prisma().phPrescription.findMany({ where, orderBy }),
    rxFiles: await prisma().phRxAttachment.findMany({ where, orderBy }),
    controlled: await prisma().phControlledEntry.findMany({ where, orderBy }),
    // Customers and their ledger are the business's (compared for a whole business); payments are branch-scoped (phase 7, task 3).
    customers: businessWide ? await prisma().phCustomer.findMany(businessWide) : undefined,
    customerLedger: businessWide ? await prisma().phCustomerLedger.findMany(businessWide) : undefined,
    customerPayments: await prisma().phCustomerPayment.findMany({ where, orderBy }),
    aiProposals: await prisma().phAiProposal.findMany({ where, orderBy }),
    settings: branchId ? undefined : await prisma().phSettings.findMany({ where: { restaurantId: ids.restaurantId }, orderBy }),
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
    const { movementId, receiptId, countId, lineId, saleId, shiftId, returnId, purchaseOrderId, supplierReturnId, intakeBatchId, intakeFileId, intakeRowId, rxId, rxFileId, proposalId } = pick(ids, n);
    return [n === 1 ? ids.b1 : ids.b2, movementId, receiptId, countId, lineId, saleId, shiftId, returnId, purchaseOrderId, supplierReturnId, intakeBatchId, intakeFileId, intakeRowId, rxId, rxFileId, proposalId];
  };
  if (branch) return docs(branch);
  return [ids.restaurantId, ids.categoryId, ids.tradeName, ids.customerId, ids.customerName, ids.batch1, ids.batch2, ids.lot1, ids.lot2, ids.supplierId, ids.supplierName, ids.invoiceId, ids.invoiceNumber, ids.invReceiptId, ids.invLineId, ids.paymentId, ids.creditNoteId, ids.transfer1, ids.transfer2, ...docs(1), ...docs(2)];
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
    const guarded = { ids: a, branchId: a.b2, traces: tracesOf(a, 2).filter((trace) => !(c.bothEnds && trace === a.b2)) };
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
