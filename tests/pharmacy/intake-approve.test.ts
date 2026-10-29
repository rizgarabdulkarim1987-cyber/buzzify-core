import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { scopedClient } from '@/server/data/tenant-db';
import { identityKeyOf, searchTextOf } from '@/server/domain/pharmacy/product-identity';
import type { PhRole } from '@/server/domain/pharmacy/permissions';
import * as approveActions from '@/server/pharmacy/actions/intake-approve';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import * as reviewActions from '@/server/pharmacy/actions/intake-review';
import { expireOpenBatches, NS_APPROVE_INVOICE } from '@/server/pharmacy/intake/approve';
import { getBatch } from '@/server/pharmacy/intake/batches';
import { matchRows } from '@/server/pharmacy/intake/review';
import { withIntakeStorage } from '@/server/pharmacy/intake/storage';
import * as reviewQueries from '@/server/pharmacy/queries/intake-review';
import type { ActionDef } from '@/server/studio/framework/action';
import { grant, holdRowLock, NOW, person, pharmacy, prisma, resetWorld, untilBlockedOnALock, useTestDatabase, type Person } from './fixture';
import { memoryIntakeStorage } from './intake-helpers';
import { act, ask, codeOf, dataOf, phCodeOf } from './stock-helpers';

/**
 * Invoice intake, approval into a DRAFT receipt, cancel and the expiry sweep (phase 5, task 7). The database is the real one
 * (port 54503). Lines are seeded straight in as the model would have left them; matching, edits, acknowledgements and the
 * approval itself go through the services and actions.
 */

let seq = 0;
const key = () => `approve-key-${(seq += 1)}-aaaa`;

const LINE = {
  name: 'Panadol',
  strength: '500 mg',
  form: 'tablet',
  pack: '10 strip',
  quantity: 10,
  bonus: 0,
  unitCost: 1000,
  lineTotal: 10000,
  lot: 'L1',
  expiry: '2028-03',
  barcodeText: null as string | null,
  unclear: [] as string[],
  page: 1,
};
const headerOf = (over: Record<string, unknown> = {}) => ({ extracted: { supplierName: 'Acme', invoiceNumber: 'INV-1', invoiceDate: '2026-10-20', currency: 'IQD', total: 10000, discount: 0, tax: 0, unclear: [], ...over } });

async function world() {
  const a = await pharmacy('A', { branches: 2 });
  const [b1, b2] = a.branchIds as [string, string];
  const staff = (label: string, role: PhRole, branches = [b1]) => person(label, { staff: [a.id, role, branches] });
  const supplier = await prisma().phSupplier.create({ data: { restaurantId: a.id, name: 'Acme Pharma', nameKey: 'acme pharma', clientKey: key(), defaultCurrency: 'IQD', createdById: 'seed' }, select: { id: true } });
  return {
    a,
    b1,
    b2,
    supplierId: supplier.id,
    owner: await person('owner', { membership: [a.id, 'OWNER'] }),
    pic: await staff('pic', 'PHARMACIST_IN_CHARGE'),
    manager2: await staff('manager2', 'BRANCH_MANAGER', [b2]),
    cashier: await staff('cashier', 'CASHIER'),
    pharmacist: await staff('pharmacist', 'PHARMACIST'),
    stock: await staff('stock', 'STOCK'),
    accountant: await staff('accountant', 'ACCOUNTANT'),
  };
}
type World = Awaited<ReturnType<typeof world>>;
const place = (w: World, branch: 1 | 2 = 1) => ({ restaurantId: w.a.id, branchId: branch === 1 ? w.b1 : w.b2 });

async function product(restaurantId: string, tradeName: string) {
  const made = await prisma().phProduct.create({
    data: {
      restaurantId,
      tradeName,
      strength: '500 mg',
      form: 'tablet',
      identityKey: identityKeyOf({ tradeName, strength: '500 mg', form: 'tablet', manufacturer: `maker-${(seq += 1)}`, packLabel: '10 strip' }),
      searchText: searchTextOf({ tradeName, genericName: '', activeIngredient: '', strength: '500 mg', form: 'tablet', manufacturer: '' }),
    },
    select: { id: true },
  });
  const tablet = await prisma().phProductUnit.create({ data: { restaurantId, productId: made.id, level: 0, label: 'tablet', baseQty: 1 }, select: { id: true } });
  const strip = await prisma().phProductUnit.create({ data: { restaurantId, productId: made.id, level: 1, label: 'strip', baseQty: 10 }, select: { id: true } });
  return { id: made.id, tablet: tablet.id, strip: strip.id };
}

/** The business's one product of that name (a second one would make the match ambiguous). */
async function productOnce(restaurantId: string, tradeName: string) {
  const found = await prisma().phProduct.findFirst({ where: { restaurantId, tradeName }, select: { id: true, units: { orderBy: { level: 'asc' }, select: { id: true } } } });
  return found ? { id: found.id, tablet: found.units[0]!.id, strip: found.units[1]!.id } : product(restaurantId, tradeName);
}

async function batch(w: World, o: { branch?: 1 | 2; status?: 'OPEN' | 'APPROVED' | 'CANCELLED'; header?: unknown; supplierId?: string | null; storageKey?: string | null; updatedAt?: Date } = {}) {
  const branchId = o.branch === 2 ? w.b2 : w.b1;
  const status = o.status ?? 'OPEN';
  const made = await prisma().phIntakeBatch.create({
    data: {
      restaurantId: w.a.id,
      branchId,
      clientKey: key(),
      payloadHash: 'seed',
      createdById: w.owner.userId,
      status,
      supplierId: o.supplierId === undefined ? w.supplierId : o.supplierId,
      header: (o.header ?? headerOf()) as object,
      ...(status === 'CANCELLED' ? { cancelledAt: NOW } : {}),
      ...(status === 'APPROVED'
        ? { approvedAt: NOW, approvedById: w.owner.userId, receiptId: (await prisma().phReceipt.create({ data: { restaurantId: w.a.id, branchId, clientKey: key(), receivedOn: new Date('2026-10-30T00:00:00.000Z'), createdById: w.owner.userId }, select: { id: true } })).id }
        : {}),
    },
    select: { id: true },
  });
  if (o.updatedAt) await prisma().phIntakeBatch.update({ where: { id: made.id }, data: { updatedAt: o.updatedAt } });
  const file = await addFile(w, made.id, { storageKey: o.storageKey ?? null });
  return { batchId: made.id, fileId: file };
}

async function addFile(w: World, batchId: string, o: { storageKey?: string | null; status?: 'UPLOADED' | 'EXTRACTED' | 'EXTRACTING' } = {}) {
  const status = o.status ?? 'EXTRACTED';
  const file = await prisma().phIntakeFile.create({
    data: {
      restaurantId: w.a.id,
      batchId,
      sha256: createHash('sha256').update(`seed-${(seq += 1)}-${batchId}`).digest('hex'),
      storageKey: o.storageKey ?? null,
      mediaType: 'image/png',
      bytes: 10,
      pages: 1,
      status,
      ...(status === 'EXTRACTING' ? { extractingSince: NOW } : {}),
      expiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
      uploadedById: w.owner.userId,
    },
    select: { id: true },
  });
  return file.id;
}

let lineNo = 0;
async function row(w: World, fileId: string, over: Record<string, unknown> = {}) {
  const made = await prisma().phIntakeRow.create({ data: { restaurantId: w.a.id, fileId, lineNo: (lineNo += 1), page: 1, extracted: { ...LINE, ...over } }, select: { id: true } });
  return made.id;
}

/** A batch of one matched, clean line with a supplier: approvable as it stands. */
async function ready(w: World, o: { line?: Record<string, unknown>; header?: Record<string, unknown>; supplierId?: string | null; storageKey?: string | null } = {}) {
  const p = await productOnce(w.a.id, 'Panadol');
  const b = await batch(w, { header: headerOf(o.header), supplierId: o.supplierId, storageKey: o.storageKey });
  const rowId = await row(w, b.fileId, o.line);
  await matchRows(prisma(), { restaurantId: w.a.id }, b.batchId, NOW);
  return { ...b, rowId, p };
}

const get = (w: World, who: Person, batchId: string, branch: 1 | 2 = 1) => ask(who, reviewQueries.batchGet, { ...place(w, branch), batchId });
const rowOf = (id: string) => prisma().phIntakeRow.findUniqueOrThrow({ where: { id } });
const batchOf = (id: string) => prisma().phIntakeBatch.findUniqueOrThrow({ where: { id } });

/** What the screen holds: the version and the verdict token of the batch as it reads now. */
async function seen(w: World, batchId: string, branch: 1 | 2 = 1) {
  const read = dataOf(await get(w, w.owner, batchId, branch));
  return { expectedVersion: read.batch.version, verdictToken: read.verdictToken };
}
/** Approves the way the screen does: with what it last read, unless the test overrides it. */
async function approve(w: World, who: Person, batchId: string, over: Record<string, unknown> = {}, branch: 1 | 2 = 1) {
  const s = over.verdictToken !== undefined && over.expectedVersion !== undefined ? {} : await seen(w, batchId, branch);
  return act(who, approveActions.approve, { ...place(w, branch), batchId, clientKey: key(), ...s, ...over });
}
const cancel = (w: World, who: Person, batchId: string, over: Record<string, unknown> = {}, branch: 1 | 2 = 1) => act(who, approveActions.cancel, { ...place(w, branch), batchId, ...over });

/** A review write with the version (and, for a review, the flags shown) the screen last read. */
async function vact<I, O>(who: Person, def: ActionDef<I, O>, input: Record<string, unknown>) {
  const out = { ...input };
  const full = async (batchId: string) => getBatch(scopedClient(prisma(), { restaurantId: String(input.restaurantId), allBranches: true }), batchId, undefined, true, NOW);
  if (typeof out.rowId === 'string') {
    const found = await prisma().phIntakeRow.findUnique({ where: { id: out.rowId }, select: { version: true, file: { select: { batchId: true } } } });
    if (out.version === undefined) out.version = found?.version ?? 1;
    if (def === (reviewActions.rowReview as unknown) && out.shown === undefined && found) out.shown = (await full(found.file.batchId)).rows.find((r) => r.id === out.rowId)?.flags ?? [];
  } else if (typeof out.batchId === 'string') {
    const found = await prisma().phIntakeBatch.findUnique({ where: { id: out.batchId }, select: { version: true } });
    if (out.version === undefined) out.version = found?.version ?? 1;
    if (def === (reviewActions.headerAcknowledge as unknown) && out.shown === undefined && found) {
      const read = await full(out.batchId);
      const a = read.header.arithmetic;
      out.shown = { difference: a && a.status !== 'UNKNOWN' ? a.difference : '0', currency: read.header.values.currency ?? null };
    }
  }
  return act(who, def, out);
}
const update = (w: World, who: Person, rowId: string, patch: object) => vact(who, reviewActions.rowUpdate, { ...place(w), rowId, patch, clientKey: key() });

/** Counts of every table an approval must not touch. */
async function stockCounts() {
  const p = prisma();
  return [await p.phBatch.count(), await p.phStockBalance.count(), await p.phStockMovement.count(), await p.phSupplierInvoice.count()];
}

let storage: ReturnType<typeof memoryIntakeStorage>;
let restore: () => void;
beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  await resetWorld();
  storage = memoryIntakeStorage();
  restore = withIntakeStorage(storage);
});
afterEach(() => restore());

describe('approval makes a DRAFT receipt and nothing else', () => {
  it('lines equal the effective rows exactly (IQD), edits and a free line included; stock and invoices untouched', async () => {
    const w = await world();
    const b = await batch(w, { header: headerOf({ total: 10000 + 2 * 750 + 0 }) });
    const p = await product(w.a.id, 'Panadol');
    const q = await product(w.a.id, 'Brufen');
    const first = await row(w, b.fileId, { lot: 'ab-1', quantity: 12, bonus: 2, unitCost: 750, lineTotal: 9000 });
    const free = await row(w, b.fileId, { name: 'Brufen', lot: 'FR-1', expiry: '2029-01-31', quantity: 3, unitCost: 0, lineTotal: 0 });
    await matchRows(prisma(), { restaurantId: w.a.id }, b.batchId, NOW);
    // a person fixes the second line's cost and says it is free of charge
    dataOf(await update(w, w.pic, free, { freeOfCharge: true }));
    const gone = await row(w, b.fileId, { name: 'Removed line', lot: 'X', quantity: 1 });
    dataOf(await vact(w.pic, reviewActions.rowRemove, { ...place(w), rowId: gone }));
    // header total = 12 x 750 = 9000 + 0
    dataOf(await vact(w.pic, reviewActions.headerUpdate, { ...place(w), batchId: b.batchId, patch: { total: 9000 } }));
    const before = await stockCounts();
    const versionBefore = (await batchOf(b.batchId)).version;
    const done = dataOf(await approve(w, w.pic, b.batchId));
    expect(done).toMatchObject({ batchId: b.batchId, replayed: false, lineCount: 2 });
    const receipt = await prisma().phReceipt.findUniqueOrThrow({ where: { id: done.receiptId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    expect(receipt).toMatchObject({ status: 'DRAFT', branchId: w.b1, supplierId: w.supplierId, invoiceRef: 'INV-1', createdById: w.pic.userId });
    expect(receipt.lines).toHaveLength(2);
    expect(receipt.lines[0]).toMatchObject({ productId: p.id, unitId: p.strip, qty: 12, bonusQty: 2, lot: 'AB-1', unitCostMinor: 750n, costCurrency: 'IQD', freeOfCharge: false, acceptExpired: false });
    expect(receipt.lines[0]!.expiryDate.toISOString().slice(0, 10)).toBe('2028-03-31');
    expect(receipt.lines[0]!.expiryPrecision).toBe('MONTH');
    expect(receipt.lines[1]).toMatchObject({ productId: q.id, qty: 3, bonusQty: 0, lot: 'FR-1', unitCostMinor: 0n, freeOfCharge: true });
    const stored = await batchOf(b.batchId);
    expect(stored).toMatchObject({ status: 'APPROVED', receiptId: done.receiptId, approvedById: w.pic.userId, version: versionBefore + 1 });
    expect(stored.approvedAt).not.toBeNull();
    // nothing moved: no stock batch, balance, movement, and no supplier invoice
    expect(await stockCounts()).toEqual(before);
    expect(first).toBeTruthy();
  });

  it('a USD invoice makes USD lines', async () => {
    const w = await world();
    const r = await ready(w, { header: { currency: 'USD', total: 2500 }, line: { unitCost: 250, lineTotal: 2500 } });
    const done = dataOf(await approve(w, w.owner, r.batchId));
    const line = await prisma().phReceiptLine.findFirstOrThrow({ where: { receiptId: done.receiptId } });
    expect(line).toMatchObject({ unitCostMinor: 250n, costCurrency: 'USD', qty: 10 });
  });

  it('an acknowledged expired line is accepted on the receipt line', async () => {
    const w = await world();
    const r = await ready(w, { line: { expiry: '2026-01-31' } });
    expect((await readOpen(w, r.batchId, r.rowId))).toEqual(['EXPIRED']);
    dataOf(await vact(w.pic, reviewActions.rowReview, { ...place(w), rowId: r.rowId, note: 'checked: near-expiry batch accepted' }));
    const done = dataOf(await approve(w, w.pic, r.batchId));
    expect(await prisma().phReceiptLine.findFirstOrThrow({ where: { receiptId: done.receiptId } })).toMatchObject({ acceptExpired: true });
  });

  it('the confirmed draft goes through the normal receipt path: stock arrives', async () => {
    const w = await world();
    const r = await ready(w, { line: { bonus: 2, lineTotal: 10000 } });
    const done = dataOf(await approve(w, w.owner, r.batchId));
    expect(await prisma().phStockBalance.count()).toBe(0);
    dataOf(await act(w.owner, receiptActions.confirm, { ...place(w), receiptId: done.receiptId }));
    const balance = await prisma().phStockBalance.findFirstOrThrow({ where: { branchId: w.b1 } });
    // 10 strips + 2 bonus strips of 10 tablets
    expect(balance.available).toBe(120);
    expect((await prisma().phReceipt.findUniqueOrThrow({ where: { id: done.receiptId } })).status).toBe('CONFIRMED');
  });
});

async function readOpen(w: World, batchId: string, rowId: string) {
  return dataOf(await get(w, w.owner, batchId)).rows.find((r) => r.id === rowId)!.openFlags;
}

describe('what blocks approval, and what clears it', () => {
  const reasons = (result: Awaited<ReturnType<typeof approve>>): Array<Record<string, unknown>> => JSON.parse((result.ok ? '[]' : result.error.fields?.reasons) ?? '[]');

  it('MISSING blocks until the value is supplied', async () => {
    const w = await world();
    const r = await ready(w, { line: { lot: null } });
    const blocked = await approve(w, w.pic, r.batchId);
    expect(phCodeOf(blocked)).toBe('NOT_APPROVABLE');
    expect(reasons(blocked)).toEqual([{ code: 'OPEN_FLAG', rowId: r.rowId, flag: 'MISSING' }]);
    dataOf(await update(w, w.pic, r.rowId, { lot: 'L9' }));
    expect(codeOf(await approve(w, w.pic, r.batchId))).toBe('OK');
  });

  it('MATH_MISMATCH blocks until a reason is given for that difference', async () => {
    const w = await world();
    const r = await ready(w, { line: { lineTotal: 9000 }, header: { total: 9000 } });
    const blocked = await approve(w, w.pic, r.batchId);
    expect(reasons(blocked)).toEqual([{ code: 'OPEN_FLAG', rowId: r.rowId, flag: 'MATH_MISMATCH' }]);
    dataOf(await vact(w.pic, reviewActions.rowReview, { ...place(w), rowId: r.rowId, note: 'checked', mismatchReason: 'supplier discount on this line' }));
    expect(codeOf(await approve(w, w.pic, r.batchId))).toBe('OK');
  });

  it('AMBIGUOUS_MATCH blocks until a product is chosen', async () => {
    const w = await world();
    const r = await ready(w);
    const other = await product(w.a.id, 'Panadol Extra');
    await prisma().phIntakeRow.update({ where: { id: r.rowId }, data: { matchState: 'AMBIGUOUS', candidates: [{ productId: r.p.id, score: 0.9 }, { productId: other.id, score: 0.9 }] } });
    expect(reasons(await approve(w, w.pic, r.batchId))).toEqual([{ code: 'OPEN_FLAG', rowId: r.rowId, flag: 'AMBIGUOUS_MATCH' }]);
    dataOf(await vact(w.pic, reviewActions.rowMatch, { ...place(w), rowId: r.rowId, productId: r.p.id, unitId: r.p.strip }));
    expect(codeOf(await approve(w, w.pic, r.batchId))).toBe('OK');
  });

  it('EXPIRED blocks until a note acknowledges it', async () => {
    const w = await world();
    const r = await ready(w, { line: { expiry: '2026-01-31' } });
    expect(reasons(await approve(w, w.pic, r.batchId))).toEqual([{ code: 'OPEN_FLAG', rowId: r.rowId, flag: 'EXPIRED' }]);
    dataOf(await vact(w.pic, reviewActions.rowReview, { ...place(w), rowId: r.rowId, note: 'checked' }));
    expect(codeOf(await approve(w, w.pic, r.batchId))).toBe('OK');
  });

  it('DUPLICATE_LINE blocks until a note acknowledges it', async () => {
    const w = await world();
    const r = await ready(w);
    const twin = await row(w, r.fileId);
    await matchRows(prisma(), { restaurantId: w.a.id }, r.batchId, NOW);
    await prisma().phIntakeBatch.update({ where: { id: r.batchId }, data: { header: headerOf({ total: 20000 }) } });
    const blocked = reasons(await approve(w, w.pic, r.batchId));
    expect(blocked).toEqual(expect.arrayContaining([{ code: 'OPEN_FLAG', rowId: r.rowId, flag: 'DUPLICATE_LINE' }, { code: 'OPEN_FLAG', rowId: twin, flag: 'DUPLICATE_LINE' }]));
    for (const id of [r.rowId, twin]) dataOf(await vact(w.pic, reviewActions.rowReview, { ...place(w), rowId: id, note: 'two lots on one line' }));
    expect(codeOf(await approve(w, w.pic, r.batchId))).toBe('OK');
  });

  it('MODEL_UNCLEAR blocks until a note acknowledges it', async () => {
    const w = await world();
    const r = await ready(w, { line: { unclear: ['lot'] } });
    expect(reasons(await approve(w, w.pic, r.batchId))).toEqual([{ code: 'OPEN_FLAG', rowId: r.rowId, flag: 'MODEL_UNCLEAR' }]);
    dataOf(await vact(w.pic, reviewActions.rowReview, { ...place(w), rowId: r.rowId, note: 'lot checked on the box' }));
    expect(codeOf(await approve(w, w.pic, r.batchId))).toBe('OK');
  });

  it('a header total that does not add up blocks until the difference is acknowledged', async () => {
    const w = await world();
    const r = await ready(w, { header: { total: 12345 } });
    expect(reasons(await approve(w, w.pic, r.batchId))).toEqual([{ code: 'HEADER_MISMATCH' }]);
    dataOf(await vact(w.pic, reviewActions.headerAcknowledge, { ...place(w), batchId: r.batchId, reason: 'delivery charge printed in the total' }));
    expect(codeOf(await approve(w, w.pic, r.batchId))).toBe('OK');
  });

  it('an acknowledgement is invalidated by a later edit that changes the difference', async () => {
    const w = await world();
    const r = await ready(w, { line: { lineTotal: 9000 }, header: { total: 9000 } });
    dataOf(await vact(w.pic, reviewActions.rowReview, { ...place(w), rowId: r.rowId, note: 'checked', mismatchReason: 'discount' }));
    dataOf(await update(w, w.pic, r.rowId, { lineTotal: 8000 }));
    dataOf(await vact(w.pic, reviewActions.headerUpdate, { ...place(w), batchId: r.batchId, patch: { total: 8000 } }));
    expect(reasons(await approve(w, w.pic, r.batchId))).toEqual([{ code: 'OPEN_FLAG', rowId: r.rowId, flag: 'MATH_MISMATCH' }]);
  });

  it('a batch whose lines are all removed has nothing to approve', async () => {
    const w = await world();
    const r = await ready(w);
    dataOf(await vact(w.pic, reviewActions.rowRemove, { ...place(w), rowId: r.rowId }));
    const blocked = await approve(w, w.pic, r.batchId);
    expect(phCodeOf(blocked)).toBe('NOT_APPROVABLE');
    expect(reasons(blocked)).toEqual([{ code: 'NO_ROWS' }]);
  });

  it('an unmatched supplier, a missing currency, and a file still being read each refuse', async () => {
    const w = await world();
    const noSupplier = await ready(w, { supplierId: null });
    expect(phCodeOf(await approve(w, w.pic, noSupplier.batchId))).toBe('SUPPLIER_REQUIRED');
    const noCurrency = await ready(w, { header: { currency: null } });
    expect(phCodeOf(await approve(w, w.pic, noCurrency.batchId))).toBe('CURRENCY_REQUIRED');
    const busy = await ready(w);
    await addFile(w, busy.batchId, { status: 'UPLOADED' });
    expect(phCodeOf(await approve(w, w.pic, busy.batchId))).toBe('FILES_STILL_PROCESSING');
    const reading = await ready(w);
    await addFile(w, reading.batchId, { status: 'EXTRACTING' });
    expect(phCodeOf(await approve(w, w.pic, reading.batchId))).toBe('FILES_STILL_PROCESSING');
    for (const id of [noSupplier.batchId, noCurrency.batchId, busy.batchId, reading.batchId]) expect((await batchOf(id)).status).toBe('OPEN');
    expect(await prisma().phReceipt.count()).toBe(0);
  });
});

describe('duplicate invoices', () => {
  it('names an existing supplier invoice with the same number, however it is spelled', async () => {
    const w = await world();
    const existing = await prisma().phSupplierInvoice.create({
      data: { restaurantId: w.a.id, supplierId: w.supplierId, number: 'INV-1', numberRaw: 'INV-1', invoiceDate: new Date('2026-09-01'), dueDate: new Date('2026-09-01'), currency: 'IQD', totalMinor: 0n, fingerprint: 'f', clientKey: key(), createdById: 'seed' },
      select: { id: true },
    });
    const r = await ready(w, { header: { invoiceNumber: ' inv-1 ' } });
    const refused = await approve(w, w.pic, r.batchId);
    expect(phCodeOf(refused)).toBe('DUPLICATE_INVOICE');
    expect(refused.ok ? '' : refused.error.fields?.existingInvoiceId).toBe(existing.id);
    expect((await batchOf(r.batchId)).status).toBe('OPEN');
    expect(await prisma().phReceipt.count()).toBe(0);
  });

  it('names another approved batch of the same supplier with the same number; another supplier is fine', async () => {
    const w = await world();
    const first = await ready(w);
    dataOf(await approve(w, w.pic, first.batchId));
    const second = await ready(w, { header: { invoiceNumber: 'inv-1' } });
    const refused = await approve(w, w.pic, second.batchId);
    expect(phCodeOf(refused)).toBe('DUPLICATE_INVOICE');
    expect(refused.ok ? '' : refused.error.fields?.batchId).toBe(first.batchId);
    const other = await prisma().phSupplier.create({ data: { restaurantId: w.a.id, name: 'Other Co', nameKey: 'other co', clientKey: key(), defaultCurrency: 'IQD', createdById: 'seed' }, select: { id: true } });
    const third = await ready(w, { supplierId: other.id });
    expect(codeOf(await approve(w, w.pic, third.batchId))).toBe('OK');
  });

  it('two different batches of one invoice approved at once: one wins', async () => {
    const w = await world();
    const a = await ready(w);
    const b = await ready(w);
    const results = await Promise.all([approve(w, w.pic, a.batchId), approve(w, w.pic, b.batchId)]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    expect(results.filter((r) => !r.ok).map(phCodeOf)).toEqual(['DUPLICATE_INVOICE']);
    expect(await prisma().phReceipt.count()).toBe(1);
  });

  it('an approval waits on the invoice guard of its supplier and number (the guard that makes two batches of one invoice meet)', async () => {
    const w = await world();
    const r = await ready(w);
    const s = await seen(w, r.batchId);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held!: () => void;
    const locked = new Promise<void>((resolve) => {
      held = resolve;
    });
    const holder = prisma().$transaction(async (tx) => {
      // eslint-disable-next-line no-restricted-properties -- the test takes the approval's invoice guard itself; no tenant rows
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_APPROVE_INVOICE}::int, hashtext(${`${w.a.id}:${w.supplierId}:INV-1`}))`;
      held();
      await gate;
    });
    await locked;
    const approval = approve(w, w.pic, r.batchId, s);
    await untilBlockedOnALock(5000, 1);
    expect((await batchOf(r.batchId)).status).toBe('OPEN');
    release();
    await holder;
    expect(codeOf(await approval)).toBe('OK');
  });
});

describe('the verdict token', () => {
  it('is the same for every reader, changes with any edit, and is refused when stale', async () => {
    const w = await world();
    const r = await ready(w);
    const one = await seen(w, r.batchId);
    expect(one.verdictToken).toMatch(/^[0-9a-f]{64}$/);
    expect((await seen(w, r.batchId)).verdictToken).toBe(one.verdictToken);
    const cost = await getBatch(scopedClient(prisma(), { restaurantId: w.a.id, allBranches: true }), r.batchId, undefined, true, NOW);
    const plain = await getBatch(scopedClient(prisma(), { restaurantId: w.a.id, allBranches: true }), r.batchId, undefined, false, NOW);
    expect(cost.verdictToken).toBe(plain.verdictToken);
    dataOf(await update(w, w.pic, r.rowId, { lot: 'L2' }));
    const two = await seen(w, r.batchId);
    expect(two.verdictToken).not.toBe(one.verdictToken);
    const stale = await approve(w, w.pic, r.batchId, one);
    expect(phCodeOf(stale)).toBe('APPROVAL_STALE');
    expect((await batchOf(r.batchId)).status).toBe('OPEN');
    expect(codeOf(await approve(w, w.pic, r.batchId, two))).toBe('OK');
  });

  it('changes when a second file finishes its reading, when a line is matched differently, and when the header changes', async () => {
    const w = await world();
    const r = await ready(w);
    const base = (await seen(w, r.batchId)).verdictToken;
    const second = await addFile(w, r.batchId);
    expect((await seen(w, r.batchId)).verdictToken).not.toBe(base);
    await row(w, second, { name: 'Late line', lot: 'LATE' });
    const withLine = (await seen(w, r.batchId)).verdictToken;
    expect(withLine).not.toBe(base);
    dataOf(await vact(w.pic, reviewActions.headerUpdate, { ...place(w), batchId: r.batchId, patch: { invoiceNumber: 'INV-2' } }));
    expect((await seen(w, r.batchId)).verdictToken).not.toBe(withLine);
  });

  it('refuses a wrong version as the stale invoice it is', async () => {
    const w = await world();
    const r = await ready(w);
    const s = await seen(w, r.batchId);
    const refused = await approve(w, w.pic, r.batchId, { ...s, expectedVersion: s.expectedVersion + 1 });
    expect(phCodeOf(refused)).toBe('VERSION_CONFLICT');
  });
});

describe('a repeated approval', () => {
  it('returns the same receipt for the same key and request, and refuses another request or person', async () => {
    const w = await world();
    const r = await ready(w);
    const s = await seen(w, r.batchId);
    const k = key();
    const first = dataOf(await approve(w, w.pic, r.batchId, { ...s, clientKey: k }));
    const again = dataOf(await approve(w, w.pic, r.batchId, { ...s, clientKey: k }));
    expect(again).toMatchObject({ receiptId: first.receiptId, replayed: true });
    expect(await prisma().phReceipt.count()).toBe(1);
    expect(phCodeOf(await approve(w, w.pic, r.batchId, { ...s, clientKey: k, verdictToken: 'f'.repeat(64) }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await approve(w, w.owner, r.batchId, { ...s, clientKey: k }))).toBe('CLIENT_KEY_MISMATCH');
    const other = await ready(w, { header: { invoiceNumber: 'INV-9' } });
    expect(phCodeOf(await approve(w, w.pic, other.batchId, { ...(await seen(w, other.batchId)), clientKey: k }))).toBe('CLIENT_KEY_MISMATCH');
    expect((await batchOf(other.batchId)).status).toBe('OPEN');
    expect(await prisma().phReceipt.count()).toBe(1);
    // another key for an approved batch is not a replay
    expect(phCodeOf(await approve(w, w.pic, r.batchId, s))).toBe('NOT_OPEN');
  });

  it('two parallel approvals with one key make one receipt', async () => {
    const w = await world();
    const r = await ready(w);
    const s = await seen(w, r.batchId);
    const k = key();
    const results = await Promise.all([approve(w, w.pic, r.batchId, { ...s, clientKey: k }), approve(w, w.pic, r.batchId, { ...s, clientKey: k })]);
    expect(results.map(codeOf)).toEqual(['OK', 'OK']);
    expect(new Set(results.map((x) => dataOf(x).receiptId)).size).toBe(1);
    expect(results.map((x) => dataOf(x).replayed).sort()).toEqual([false, true]);
    expect(await prisma().phReceipt.count()).toBe(1);
  });

  it('two parallel approvals of one batch with different keys make exactly one receipt', async () => {
    const w = await world();
    const r = await ready(w);
    const s = await seen(w, r.batchId);
    const results = await Promise.all([approve(w, w.pic, r.batchId, s), approve(w, w.owner, r.batchId, s)]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    expect(results.filter((x) => !x.ok).map(phCodeOf)).toEqual(['NOT_OPEN']);
    expect(await prisma().phReceipt.count()).toBe(1);
    expect(await prisma().phReceiptLine.count()).toBe(1);
  });
});

describe('races with other writers', () => {
  it('an edit that is queued behind the approval is refused afterwards (the batch is no longer open)', async () => {
    const w = await world();
    const r = await ready(w);
    const s = await seen(w, r.batchId);
    const held = await holdRowLock('PhIntakeBatch', r.batchId);
    const approval = approve(w, w.pic, r.batchId, s);
    await untilBlockedOnALock(5000, 1);
    const edit = update(w, w.pic, r.rowId, { lot: 'Z9' });
    await untilBlockedOnALock(5000, 2);
    await held.release();
    const [done, edited] = await Promise.all([approval, edit]);
    expect(codeOf(done)).toBe('OK');
    expect(codeOf(edited)).not.toBe('OK');
    expect((await rowOf(r.rowId)).edited).toEqual({});
    const line = await prisma().phReceiptLine.findFirstOrThrow({ where: { receipt: { id: dataOf(done).receiptId } } });
    expect(line.lot).toBe('L1');
  });

  it('an edit that gets in first is seen by the approval as a stale token', async () => {
    const w = await world();
    const r = await ready(w);
    const s = await seen(w, r.batchId);
    const held = await holdRowLock('PhIntakeBatch', r.batchId);
    const edit = update(w, w.pic, r.rowId, { lot: 'Z9' });
    await untilBlockedOnALock(5000, 1);
    const approval = approve(w, w.pic, r.batchId, s);
    await untilBlockedOnALock(5000, 2);
    await held.release();
    const [edited, done] = await Promise.all([edit, approval]);
    expect(codeOf(edited)).toBe('OK');
    expect(phCodeOf(done)).toBe('APPROVAL_STALE');
    expect(await prisma().phReceipt.count()).toBe(0);
  });

  it('approval and cancel at once: exactly one wins, in either order', async () => {
    const w = await world();
    for (const approvalFirst of [true, false]) {
      const r = await ready(w, { header: { invoiceNumber: approvalFirst ? 'INV-A' : 'INV-B' }, storageKey: `intake/${w.a.id}/file-${approvalFirst}` });
      storage.objects.set(`intake/${w.a.id}/file-${approvalFirst}`, { bytes: new Uint8Array([1]), mediaType: 'image/png' });
      const s = await seen(w, r.batchId);
      const held = await holdRowLock('PhIntakeBatch', r.batchId);
      const start = [() => approve(w, w.pic, r.batchId, s), () => cancel(w, w.pic, r.batchId)];
      if (!approvalFirst) start.reverse();
      const first = start[0]!();
      await untilBlockedOnALock(5000, 1);
      const second = start[1]!();
      await untilBlockedOnALock(5000, 2);
      await held.release();
      const [a, b] = await Promise.all([first, second]);
      expect([a, b].filter((x) => x.ok)).toHaveLength(1);
      const status = (await batchOf(r.batchId)).status;
      expect(status).toBe(approvalFirst ? 'APPROVED' : 'CANCELLED');
      // an approved batch keeps its file; a cancelled one lets it go
      expect(storage.objects.has(`intake/${w.a.id}/file-${approvalFirst}`)).toBe(!approvalFirst ? false : true);
    }
    expect(await prisma().phReceipt.count()).toBe(1);
  });
});

describe('who may approve and cancel', () => {
  it('another branch’s batch is not found; so is another business’s', async () => {
    const w = await world();
    const r = await ready(w);
    const s = await seen(w, r.batchId);
    expect(codeOf(await approve(w, w.manager2, r.batchId, s, 2))).toBe('NOT_FOUND');
    expect(codeOf(await cancel(w, w.manager2, r.batchId, {}, 2))).toBe('NOT_FOUND');
    const stranger = await pharmacy('B', { branches: 1 });
    const outsider = await person('outsider', { staff: [stranger.id, 'OWNER', stranger.branchIds as string[]] });
    expect(codeOf(await act(outsider, approveActions.approve, { restaurantId: stranger.id, branchId: (stranger.branchIds as string[])[0], batchId: r.batchId, clientKey: key(), ...s }))).toBe('NOT_FOUND');
    expect((await batchOf(r.batchId)).status).toBe('OPEN');
  });

  it('a cashier and a pharmacist are refused; stock, accountant, the pharmacist in charge and the owner may approve', async () => {
    const w = await world();
    const r = await ready(w);
    for (const who of [w.cashier, w.pharmacist]) {
      expect(codeOf(await approve(w, who, r.batchId))).toBe('FORBIDDEN');
      expect(codeOf(await cancel(w, who, r.batchId))).toBe('FORBIDDEN');
    }
    expect((await batchOf(r.batchId)).status).toBe('OPEN');
    const support = await person('support', { superAdmin: true });
    await grant(support, w.a.id);
    expect(codeOf(await approve(w, support, r.batchId))).not.toBe('OK');
    expect(codeOf(await cancel(w, support, r.batchId))).not.toBe('OK');
    expect((await batchOf(r.batchId)).status).toBe('OPEN');
    let n = 0;
    for (const who of [w.stock, w.accountant, w.pic, w.owner]) {
      const one = await ready(w, { header: { invoiceNumber: `INV-${(n += 1) + 100}` } });
      expect(codeOf(await approve(w, who, one.batchId)), `approve ${n}`).toBe('OK');
    }
    const other = await ready(w, { header: { invoiceNumber: 'INV-300' } });
    expect(codeOf(await cancel(w, w.stock, other.batchId))).toBe('OK');
  });
});

describe('cancel', () => {
  it('lets go of the files: objects deleted, the slot of the bytes freed, rows kept, the reason stays off the audit', async () => {
    const w = await world();
    const k1 = `intake/${w.a.id}/f1`;
    const r = await ready(w, { storageKey: k1 });
    const k2 = `intake/${w.a.id}/f2`;
    const second = await addFile(w, r.batchId, { storageKey: k2 });
    storage.objects.set(k1, { bytes: new Uint8Array([1]), mediaType: 'image/png' });
    storage.objects.set(k2, { bytes: new Uint8Array([2]), mediaType: 'image/png' });
    const filesBefore = await prisma().phIntakeFile.findMany({ where: { batchId: r.batchId }, orderBy: { id: 'asc' } });
    const done = dataOf(await cancel(w, w.pic, r.batchId, { reason: 'SECRET-REASON-5 wrong supplier' }));
    expect(done).toMatchObject({ batchId: r.batchId, status: 'CANCELLED', releasedFiles: 2, replayed: false });
    expect(storage.objects.size).toBe(0);
    const stored = await batchOf(r.batchId);
    expect(stored.status).toBe('CANCELLED');
    expect(stored.cancelledAt).not.toBeNull();
    expect(stored.version).toBe(2);
    expect(JSON.stringify(stored.header)).toContain('SECRET-REASON-5');
    const filesAfter = await prisma().phIntakeFile.findMany({ where: { batchId: r.batchId }, orderBy: { id: 'asc' } });
    for (const f of filesAfter) {
      expect(f).toMatchObject({ status: 'PURGED', storageKey: null });
      expect(f.sha256).not.toBe(filesBefore.find((b) => b.id === f.id)!.sha256);
    }
    expect(second).toBeTruthy();
    expect(await rowOf(r.rowId)).toMatchObject({ id: r.rowId });
    const entries = await prisma().auditLog.findMany({ where: { action: 'ph.intake.cancel' } });
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries[0]!.changes)).not.toContain('SECRET');
    // a repeat is harmless; an approval after a cancel is refused
    expect(dataOf(await cancel(w, w.pic, r.batchId))).toMatchObject({ status: 'CANCELLED', replayed: true });
    expect(await prisma().auditLog.count({ where: { action: 'ph.intake.cancel' } })).toBe(1);
    expect(phCodeOf(await approve(w, w.pic, r.batchId, { expectedVersion: 2, verdictToken: 'a'.repeat(64) }))).toBe('NOT_OPEN');
  });

  it('cannot cancel an approved batch', async () => {
    const w = await world();
    const r = await ready(w);
    dataOf(await approve(w, w.pic, r.batchId));
    const refused = await cancel(w, w.pic, r.batchId);
    expect(phCodeOf(refused)).toBe('NOT_OPEN');
    expect((await batchOf(r.batchId)).status).toBe('APPROVED');
  });

  it('a store that refuses the delete leaves the batch open and untouched', async () => {
    const w = await world();
    const k = `intake/${w.a.id}/stuck`;
    const r = await ready(w, { storageKey: k });
    storage.objects.set(k, { bytes: new Uint8Array([1]), mediaType: 'image/png' });
    storage.hooks.onDelete = () => {
      throw new Error('store down');
    };
    const refused = await cancel(w, w.pic, r.batchId);
    expect(codeOf(refused)).toBe('CONFLICT');
    expect(phCodeOf(refused)).toBe('STORAGE_FAILED');
    expect(await batchOf(r.batchId)).toMatchObject({ status: 'OPEN', cancelledAt: null });
    expect((await prisma().phIntakeFile.findFirstOrThrow({ where: { batchId: r.batchId } })).storageKey).toBe(k);
  });
});

describe('the expiry sweep', () => {
  it('cancels open batches untouched for 30 days, the same way, and nothing else', async () => {
    const w = await world();
    const day = 86_400_000;
    const k = `intake/${w.a.id}/old`;
    const old = await batch(w, { storageKey: k, updatedAt: new Date(NOW.getTime() - 31 * day) });
    storage.objects.set(k, { bytes: new Uint8Array([1]), mediaType: 'image/png' });
    const fresh = await batch(w, { updatedAt: new Date(NOW.getTime() - 29 * day) });
    const approved = await batch(w, { status: 'APPROVED', updatedAt: new Date(NOW.getTime() - 90 * day) });
    const cancelled = await batch(w, { status: 'CANCELLED', updatedAt: new Date(NOW.getTime() - 90 * day) });
    const result = await expireOpenBatches(prisma(), { now: NOW, storage });
    expect(result).toEqual({ cancelled: 1, failed: 0 });
    expect((await batchOf(old.batchId)).status).toBe('CANCELLED');
    expect((await batchOf(old.batchId)).cancelledAt).not.toBeNull();
    expect(storage.objects.size).toBe(0);
    expect(await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: old.fileId } })).toMatchObject({ status: 'PURGED', storageKey: null });
    expect((await batchOf(fresh.batchId)).status).toBe('OPEN');
    expect((await batchOf(approved.batchId)).status).toBe('APPROVED');
    expect((await batchOf(cancelled.batchId)).status).toBe('CANCELLED');
    // a second run finds nothing; a different age is honoured
    expect(await expireOpenBatches(prisma(), { now: NOW, storage })).toEqual({ cancelled: 0, failed: 0 });
    expect(await expireOpenBatches(prisma(), { now: NOW, storage, olderThanDays: 10 })).toEqual({ cancelled: 1, failed: 0 });
  });

  it('counts a batch whose files could not be deleted as failed and leaves it open for the next run', async () => {
    const w = await world();
    const k = `intake/${w.a.id}/stuck`;
    const old = await batch(w, { storageKey: k, updatedAt: new Date(NOW.getTime() - 40 * 86_400_000) });
    storage.objects.set(k, { bytes: new Uint8Array([1]), mediaType: 'image/png' });
    storage.hooks.onDelete = () => {
      throw new Error('store down');
    };
    expect(await expireOpenBatches(prisma(), { now: NOW, storage })).toEqual({ cancelled: 0, failed: 1 });
    expect((await batchOf(old.batchId)).status).toBe('OPEN');
    storage.hooks.onDelete = undefined;
    expect(await expireOpenBatches(prisma(), { now: NOW, storage })).toEqual({ cancelled: 1, failed: 0 });
  });
});

describe('the audit trail', () => {
  it('holds ids, counts and flag codes only', async () => {
    const w = await world();
    const r = await ready(w, { line: { lot: 'SECRET-LOT-88', unitCost: 4321, lineTotal: 43210, unclear: ['lot'] }, header: { invoiceNumber: 'SECRET-INV-88', total: 43210 } });
    dataOf(await vact(w.pic, reviewActions.rowReview, { ...place(w), rowId: r.rowId, note: 'SECRET-NOTE-88' }));
    const done = dataOf(await approve(w, w.pic, r.batchId));
    const entries = await prisma().auditLog.findMany({ where: { action: { in: ['ph.intake.approve', 'ph.receipt.create'] } }, orderBy: { occurredAt: 'asc' } });
    expect(entries.map((e) => e.action).sort()).toEqual(['ph.intake.approve', 'ph.receipt.create']);
    const approveEntry = entries.find((e) => e.action === 'ph.intake.approve')!;
    expect(approveEntry).toMatchObject({ entityType: 'PhIntakeBatch', entityId: r.batchId });
    expect(approveEntry.changes).toMatchObject({ status: { before: 'OPEN', after: 'APPROVED' }, receiptId: { after: done.receiptId }, lineCount: { after: 1 } });
    const text = JSON.stringify(entries.map((e) => e.changes));
    expect(text).not.toMatch(/SECRET/);
    for (const value of ['Panadol', '4321', '43210', '10000', 'IQD', 'USD', 'Acme', 'INV-1']) expect(text, value).not.toContain(value);
    // a blocked approval writes nothing
    const blocked = await ready(w, { line: { lot: null }, header: { invoiceNumber: 'INV-2' } });
    const before = await prisma().auditLog.count();
    expect(codeOf(await approve(w, w.pic, blocked.batchId))).toBe('CONFLICT');
    expect(await prisma().auditLog.count()).toBe(before);
  });
});
