import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as entryActions from '@/server/pharmacy/actions/fast-entry';
import * as productActions from '@/server/pharmacy/actions/products';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import * as supplierActions from '@/server/pharmacy/actions/suppliers';
import { checkProduct, productInput } from '@/server/pharmacy/products';
import * as entryQueries from '@/server/pharmacy/queries/fast-entry';
import * as sellQueries from '@/server/pharmacy/queries/sell';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, ask, codeOf, dataOf, phCodeOf } from './stock-helpers';

/**
 * Fast product entry (Task 13): one draft receiving document per person and branch, a line per scanned product (in
 * packets), a new product made with catalog defaults, the selling price applied only for `price.change`, and one post.
 * NOW is 2026-10-27, so October 2026 is the current (still valid) expiry month.
 */

const LADDER = [
  { level: 0, label: 'tablet', baseQty: 1, sellable: true },
  { level: 1, label: 'strip', baseQty: 10, sellable: true },
  { level: 2, label: 'box', baseQty: 30, sellable: true },
];

interface World {
  a: { id: string; branchId: string; branchIds: string[] };
  owner: Person;
  stock: Person;
  cashier: Person;
  accountant: Person;
  known: { id: string; box: string };
  supplierId: string;
  otherSupplierId: string;
}

let keySeq = 0;
const key = () => `entry-request-${(keySeq += 1)}`;

async function world(): Promise<World> {
  const a = await pharmacy('A', { branches: 2 });
  await prisma().phSettings.create({ data: { restaurantId: a.id } });
  const b1 = a.branchIds[0]!;
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const stock = await person('stock', { staff: [a.id, 'STOCK', [b1]] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [b1]] });
  const accountant = await person('accountant', { staff: [a.id, 'ACCOUNTANT', [b1]] });
  const made = dataOf(await act(owner, productActions.create, { restaurantId: a.id, tradeName: 'Glucophage', strength: '500 mg', levels: LADDER, barcodes: [{ code: '6260147701596', level: 2 }] }));
  const box = (await prisma().phProductUnit.findFirstOrThrow({ where: { productId: made.id, level: 2 } })).id;
  const supplier = dataOf(await act(owner, supplierActions.create, { restaurantId: a.id, clientKey: key(), name: 'Al-Hakeem Store', defaultCurrency: 'USD' }));
  const otherSupplier = dataOf(await act(owner, supplierActions.create, { restaurantId: a.id, clientKey: key(), name: 'Al-Sharq Store', defaultCurrency: 'USD' }));
  return { a, owner, stock, cashier, accountant, known: { id: made.id, box }, supplierId: supplier.id, otherSupplierId: otherSupplier.id };
}

const placeOf = (w: World, branchId = w.a.branchIds[0]!) => ({ restaurantId: w.a.id, branchId });

const knownLine = (w: World, over: Record<string, unknown> = {}) => ({
  ...placeOf(w),
  requestKey: key(),
  product: { kind: 'known', productId: w.known.id },
  qty: 2,
  expiry: { month: 8, year: 2028 },
  purchasePrice: '3.10',
  purchaseCurrency: 'USD',
  sellPrice: null,
  lot: '',
  supplierId: w.supplierId,
  ...over,
});

const newLine = (w: World, over: Record<string, unknown> = {}, product: Record<string, unknown> = {}) => ({
  ...placeOf(w),
  requestKey: key(),
  product: { kind: 'new', tradeName: 'Augmentin 1g', barcode: '1234500099', ...product },
  qty: 3,
  expiry: { month: 8, year: 2028 },
  sellPrice: '6000',
  supplierId: w.supplierId,
  ...over,
});

const available = async (productId: string, branchId: string) =>
  (await prisma().phStockBalance.aggregate({ where: { productId, branchId }, _sum: { available: true } }))._sum.available ?? 0;

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

describe('addEntryLine', () => {
  it('refuses a person without the receive permission (purchase.manage)', async () => {
    const w = await world();
    expect(codeOf(await act(w.cashier, entryActions.addEntryLine, knownLine(w)))).toBe('FORBIDDEN');
    expect(await prisma().phReceipt.count()).toBe(0);
  });

  it('puts several lines into one draft receiving document, in packets of the product’s largest unit, and lists them newest first', async () => {
    const w = await world();
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const first = dataOf(await act(w.owner, entryActions.addEntryLine, knownLine(w, { qty: 2 })));
    const second = dataOf(await act(w.owner, entryActions.addEntryLine, knownLine(w, { qty: 4, lot: 'b-77', expiry: { month: 1, year: 2029 } })));
    expect(second.receiptId).toBe(first.receiptId);
    expect(second.lineNo).toBe(2);
    expect(second.lineCount).toBe(2);
    expect(await prisma().phReceipt.count()).toBe(1);
    const head = await prisma().phReceipt.findFirstOrThrow({ select: { status: true, supplierId: true, branchId: true } });
    expect(head).toEqual({ status: 'DRAFT', supplierId: w.supplierId, branchId: w.a.branchIds[0] });
    const lines = await prisma().phReceiptLine.findMany({ orderBy: { lineNo: 'asc' } });
    expect(lines.map((l) => [l.unitId, l.qty, l.baseQty, l.lot, l.unitCostMinor, l.costCurrency])).toEqual([
      [w.known.box, 2, 60, 'EXP-202808', 310n, 'USD'],
      [w.known.box, 4, 120, 'B-77', 310n, 'USD'],
    ]);
    const draft = dataOf(await ask(w.owner, entryQueries.entryDraft, placeOf(w)));
    expect(draft.draft?.receiptId).toBe(first.receiptId);
    expect(draft.draft?.supplierId).toBe(w.supplierId);
    expect(draft.draft?.lines.map((l) => [l.lineNo, l.productName, l.qty, l.expiry, l.isNew])).toEqual([
      [2, 'Glucophage', 4, '01/2029', false],
      [1, 'Glucophage', 2, '08/2028', false],
    ]);
  });

  it('answers a repeated request key with the same line, adding nothing', async () => {
    const w = await world();
    const body = knownLine(w);
    const first = dataOf(await act(w.owner, entryActions.addEntryLine, body));
    const again = dataOf(await act(w.owner, entryActions.addEntryLine, body));
    expect(again).toMatchObject({ receiptId: first.receiptId, lineNo: first.lineNo, replayed: true });
    expect(first.replayed).toBe(false);
    expect(await prisma().phReceiptLine.count()).toBe(1);
    // The second line of a draft too.
    const body2 = knownLine(w, { qty: 9 });
    dataOf(await act(w.owner, entryActions.addEntryLine, body2));
    dataOf(await act(w.owner, entryActions.addEntryLine, body2));
    expect(await prisma().phReceiptLine.count()).toBe(2);
    // Another person's key is not theirs to replay.
    const stolen = await act(w.stock, entryActions.addEntryLine, body);
    expect(phCodeOf(stolen)).toBe('CLIENT_KEY_MISMATCH');
  });

  it('keeps each person’s draft their own, and resumes it after a reload', async () => {
    const w = await world();
    const mine = dataOf(await act(w.owner, entryActions.addEntryLine, knownLine(w)));
    const theirs = dataOf(await act(w.stock, entryActions.addEntryLine, knownLine(w)));
    expect(theirs.receiptId).not.toBe(mine.receiptId);
    const resumed = dataOf(await ask(w.owner, entryQueries.entryDraft, placeOf(w)));
    expect(resumed.draft?.receiptId).toBe(mine.receiptId);
    expect(dataOf(await act(w.owner, entryActions.addEntryLine, knownLine(w))).receiptId).toBe(mine.receiptId);
    // The other branch starts its own.
    const other = dataOf(await act(w.owner, entryActions.addEntryLine, knownLine(w, placeOf(w, w.a.branchIds[1]))));
    expect(other.receiptId).not.toBe(mine.receiptId);
  });

  it('ignores the selling price of a person without price.change, and writes the normal price row for one with it', async () => {
    const w = await world();
    const before = await prisma().phPrice.count();
    const ignored = dataOf(await act(w.stock, entryActions.addEntryLine, knownLine(w, { sellPrice: '99999' })));
    expect(ignored.priceChanged).toBe(false);
    expect(await prisma().phPrice.count()).toBe(before);

    const applied = dataOf(await act(w.owner, entryActions.addEntryLine, knownLine(w, { sellPrice: '20,000' })));
    expect(applied.priceChanged).toBe(true);
    const rows = await prisma().phPrice.findMany({ where: { productId: w.known.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ unitId: w.known.box, amountMinor: 20000n, currency: 'IQD', branchId: null, validTo: null, changedById: w.owner.userId });
    // The same price again writes nothing new.
    expect(dataOf(await act(w.owner, entryActions.addEntryLine, knownLine(w, { sellPrice: '20000' }))).priceChanged).toBe(false);
    expect(await prisma().phPrice.count({ where: { productId: w.known.id } })).toBe(1);
    const audit = await prisma().auditLog.findMany({ where: { action: 'ph.price.set' } });
    expect(audit).toHaveLength(1);
  });

  it('refuses a known product without its purchase price, a past expiry, and a quantity out of bounds, writing nothing', async () => {
    const w = await world();
    const missing = await act(w.owner, entryActions.addEntryLine, knownLine(w, { purchasePrice: null }));
    expect(codeOf(missing)).toBe('INVALID');
    expect(!missing.ok && missing.error.fields?.purchasePrice).toBeTruthy();
    const expired = await act(w.owner, entryActions.addEntryLine, knownLine(w, { expiry: { month: 9, year: 2026 } }));
    expect(phCodeOf(expired)).toBe('EXPIRY_PAST');
    expect(codeOf(await act(w.owner, entryActions.addEntryLine, knownLine(w, { expiry: { month: 13, year: 2028 } })))).toBe('INVALID');
    expect(codeOf(await act(w.owner, entryActions.addEntryLine, knownLine(w, { qty: 0 })))).toBe('INVALID');
    expect(codeOf(await act(w.owner, entryActions.addEntryLine, knownLine(w, { qty: 1.5 })))).toBe('INVALID');
    expect(codeOf(await act(w.owner, entryActions.addEntryLine, knownLine(w, { qty: 100_000_000 })))).toBe('INVALID');
    expect(codeOf(await act(w.owner, entryActions.addEntryLine, knownLine(w, { purchasePrice: '0' })))).toBe('INVALID');
    expect(await prisma().phReceipt.count()).toBe(0);
    // The current month is still good.
    expect(codeOf(await act(w.owner, entryActions.addEntryLine, knownLine(w, { expiry: { month: 10, year: 2026 } })))).toBe('OK');
  });

  it('keeps one supplier per entry: a line naming another supplier is refused until the entry is finished', async () => {
    const w = await world();
    dataOf(await act(w.owner, entryActions.addEntryLine, knownLine(w)));
    const other = await act(w.owner, entryActions.addEntryLine, knownLine(w, { supplierId: w.otherSupplierId }));
    expect(phCodeOf(other)).toBe('SUPPLIER_DIFFERS');
    expect(await prisma().phReceiptLine.count()).toBe(1);
  });

  it('makes a new product from the four required fields with catalog defaults that pass the catalog’s own validation, and it sells at the cashier after finish', async () => {
    const w = await world();
    const b1 = w.a.branchIds[0]!;
    const body = newLine(w, { sellPrice: '6000', qty: 3, purchasePrice: undefined, supplierId: undefined }, { barcode: '1234500099' });
    const made = dataOf(await act(w.owner, entryActions.addEntryLine, body));
    expect(made.productCreated).toBe(true);
    const product = await prisma().phProduct.findFirstOrThrow({
      where: { id: made.productId },
      include: { units: { orderBy: { level: 'asc' } }, barcodes: true },
    });
    expect(product).toMatchObject({ tradeName: 'Augmentin 1g', rxLevel: 'OTC', categoryId: null, active: true });
    // The ladder is a valid catalog ladder: the catalog's own checks accept the product as stored.
    const asInput = productInput.parse({
      tradeName: product.tradeName,
      levels: product.units.map((u) => ({ level: u.level, label: u.label, baseQty: u.baseQty, sellable: u.sellable })),
      barcodes: product.barcodes.map((b) => ({ code: b.code, level: product.units.find((u) => u.id === b.unitId)!.level })),
    });
    expect(() => checkProduct(asInput)).not.toThrow();
    const packet = product.units[product.units.length - 1]!;
    expect(product.barcodes.map((b) => [b.code, b.unitId])).toEqual([['1234500099', packet.id]]);
    const line = await prisma().phReceiptLine.findFirstOrThrow({ where: { productId: made.productId } });
    expect(line).toMatchObject({ unitId: packet.id, qty: 3, unitCostMinor: null, costCurrency: null });
    expect(dataOf(await ask(w.owner, entryQueries.entryDraft, placeOf(w))).draft?.lines[0]).toMatchObject({ productName: 'Augmentin 1g', isNew: true });

    dataOf(await act(w.owner, entryActions.finishEntry, placeOf(w)));
    expect(await available(made.productId, b1)).toBe(3 * packet.baseQty);
    const sell = dataOf(await ask(w.owner, sellQueries.search, { ...placeOf(w), q: 'Augmentin' }));
    const item = sell.items.find((i) => i.productId === made.productId);
    expect(item).toBeTruthy();
    expect(item!.sellableQty).toBe(3 * packet.baseQty);
    expect(item!.units.find((u) => u.id === packet.id)?.priceMinor).toBe('6000');
  });

  it('builds the new product’s ladder from strips per packet and tablets per strip, with its rx level, ingredient and low-stock level', async () => {
    const w = await world();
    const b1 = w.a.branchIds[0]!;
    const made = dataOf(
      await act(w.owner, entryActions.addEntryLine, newLine(w, { qty: 2, purchasePrice: '2.50' }, { tradeName: 'Amoxil', barcode: null, stripsPerPacket: 3, tabletsPerStrip: 10, rxLevel: 'RX', activeIngredient: 'amoxicillin', lowStockPackets: 5 })),
    );
    const product = await prisma().phProduct.findFirstOrThrow({ where: { id: made.productId }, include: { units: { orderBy: { level: 'asc' } }, barcodes: true } });
    expect(product.units.map((u) => [u.level, u.baseQty])).toEqual([[0, 1], [1, 10], [2, 30]]);
    expect(product).toMatchObject({ rxLevel: 'RX', activeIngredient: 'amoxicillin' });
    expect(product.barcodes).toEqual([]);
    expect(await prisma().phProductBranch.findFirst({ where: { productId: made.productId }, select: { branchId: true, minQty: true } })).toEqual({ branchId: b1, minQty: 150 });
    const line = await prisma().phReceiptLine.findFirstOrThrow({ where: { productId: made.productId } });
    expect(line).toMatchObject({ qty: 2, baseQty: 60, unitCostMinor: 250n, costCurrency: 'USD' });
  });

  it('refuses a new product whose barcode another product already holds, and one from a person who may not add products', async () => {
    const w = await world();
    // An archived product still holds its barcode: the lookup calls the code new, the catalog refuses it.
    const old = dataOf(await act(w.owner, productActions.create, { restaurantId: w.a.id, tradeName: 'Old', levels: LADDER, barcodes: [{ code: '5550001', level: 2 }] }));
    dataOf(await act(w.owner, productActions.archive, { restaurantId: w.a.id, productId: old.id, expectedVersion: 1 }));
    const clash = await act(w.owner, entryActions.addEntryLine, newLine(w, {}, { barcode: '5550001' }));
    expect(phCodeOf(clash)).toBe('BARCODE_IN_USE');
    expect(await prisma().phReceipt.count()).toBe(0);
    expect(await prisma().phProduct.count({ where: { tradeName: 'Augmentin 1g' } })).toBe(0);
    // An accountant receives goods but does not manage the catalog.
    expect(codeOf(await act(w.accountant, entryActions.addEntryLine, newLine(w)))).toBe('FORBIDDEN');
    // A person without price.change may add a product; its price is not set (the field is read-only for them).
    const unpriced = dataOf(await act(w.stock, entryActions.addEntryLine, newLine(w, { sellPrice: '6000' }, { barcode: '777000111' })));
    expect(unpriced.priceChanged).toBe(false);
    expect(await prisma().phPrice.count({ where: { productId: unpriced.productId } })).toBe(0);
  });

  it('asks a new product for its selling price when the person may set one', async () => {
    const w = await world();
    const result = await act(w.owner, entryActions.addEntryLine, newLine(w, { sellPrice: null }));
    expect(codeOf(result)).toBe('INVALID');
    expect(!result.ok && result.error.fields?.sellPrice).toBeTruthy();
    expect(await prisma().phProduct.count({ where: { tradeName: 'Augmentin 1g' } })).toBe(0);
  });

  it('keeps businesses and branches apart', async () => {
    const w = await world();
    const b = await pharmacy('B');
    const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
    // B's owner naming A's product from B's place: not B's product.
    const foreign = await act(ownerB, entryActions.addEntryLine, { ...knownLine(w), restaurantId: b.id, branchId: b.branchId, supplierId: null });
    expect(['INVALID', 'NOT_FOUND']).toContain(codeOf(foreign));
    // ...nor A's place.
    expect(codeOf(await act(ownerB, entryActions.addEntryLine, knownLine(w)))).toBe('FORBIDDEN');
    // A branch-1 person in branch 2.
    expect(codeOf(await act(w.stock, entryActions.addEntryLine, knownLine(w, placeOf(w, w.a.branchIds[1]))))).toBe('FORBIDDEN');
    // A's supplier is not B's.
    const bProduct = dataOf(await act(ownerB, productActions.create, { restaurantId: b.id, tradeName: 'Bee', levels: LADDER }));
    const bSupplier = await act(ownerB, entryActions.addEntryLine, { ...knownLine(w), restaurantId: b.id, branchId: b.branchId, product: { kind: 'known', productId: bProduct.id }, supplierId: w.supplierId });
    expect(['INVALID', 'NOT_FOUND']).toContain(codeOf(bSupplier));
    expect(await prisma().phReceipt.count()).toBe(0);
  });
});

describe('finishEntry', () => {
  it('posts the draft once: stock rises by packets times the packet size in base units, and a repeat changes nothing', async () => {
    const w = await world();
    const b1 = w.a.branchIds[0]!;
    dataOf(await act(w.owner, entryActions.addEntryLine, knownLine(w, { qty: 2 })));
    const last = dataOf(await act(w.owner, entryActions.addEntryLine, knownLine(w, { qty: 3, lot: 'x1' })));
    expect(await available(w.known.id, b1)).toBe(0);
    const done = dataOf(await act(w.owner, entryActions.finishEntry, { ...placeOf(w), receiptId: last.receiptId }));
    expect(done).toMatchObject({ id: last.receiptId, status: 'CONFIRMED', lines: 2, baseQty: 150, replayed: false });
    expect(await available(w.known.id, b1)).toBe((2 + 3) * 30);
    const again = dataOf(await act(w.owner, entryActions.finishEntry, { ...placeOf(w), receiptId: last.receiptId }));
    expect(again).toMatchObject({ id: last.receiptId, status: 'CONFIRMED', number: done.number, replayed: true });
    expect(await available(w.known.id, b1)).toBe(150);
    expect(await prisma().phStockMovement.count({ where: { type: 'RECEIPT' } })).toBe(2);
    // The next line starts a new draft.
    const next = dataOf(await act(w.owner, entryActions.addEntryLine, knownLine(w)));
    expect(next.receiptId).not.toBe(last.receiptId);
    expect(dataOf(await ask(w.owner, entryQueries.entryDraft, placeOf(w))).draft?.receiptId).toBe(next.receiptId);
  });

  it('refuses to finish when nothing was entered, and another person’s or another branch’s draft', async () => {
    const w = await world();
    expect(phCodeOf(await act(w.owner, entryActions.finishEntry, placeOf(w)))).toBe('ENTRY_EMPTY');
    const theirs = dataOf(await act(w.stock, entryActions.addEntryLine, knownLine(w)));
    expect(codeOf(await act(w.owner, entryActions.finishEntry, { ...placeOf(w), receiptId: theirs.receiptId }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.owner, entryActions.finishEntry, { ...placeOf(w, w.a.branchIds[1]), receiptId: theirs.receiptId }))).toBe('NOT_FOUND');
    // A plain receipt from the receiving screen is not an entry.
    const plain = dataOf(
      await act(w.owner, receiptActions.create, {
        ...placeOf(w),
        clientKey: key(),
        receivedOn: '2026-10-27',
        lines: [{ productId: w.known.id, unitId: w.known.box, qty: 1, lot: 'P', expiry: '2028-03-15', unitCostMinor: 1n, currency: 'IQD' }],
      }),
    );
    expect(codeOf(await act(w.owner, entryActions.finishEntry, { ...placeOf(w), receiptId: plain.id }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.cashier, entryActions.finishEntry, placeOf(w)))).toBe('FORBIDDEN');
    expect(await prisma().phReceipt.count({ where: { status: 'CONFIRMED' } })).toBe(0);
  });
});

describe('fix round 1', () => {
  it('never lets a costless batch of a new product absorb a later costed delivery of the same expiry month', async () => {
    const w = await world();
    const made = dataOf(await act(w.owner, entryActions.addEntryLine, newLine(w, { purchasePrice: undefined, supplierId: undefined })));
    dataOf(await act(w.owner, entryActions.finishEntry, { ...placeOf(w), receiptId: made.receiptId }));
    // The costless line got a lot of its own.
    expect((await prisma().phReceiptLine.findFirstOrThrow({ where: { receiptId: made.receiptId } })).lot).toBe('EXP-202808-NC');
    // The same product delivered with a cost, same month, default lot: a costed batch.
    const costed = dataOf(await act(w.owner, entryActions.addEntryLine, knownLine(w, { product: { kind: 'known', productId: made.productId }, purchasePrice: '2.50', supplierId: undefined })));
    dataOf(await act(w.owner, entryActions.finishEntry, { ...placeOf(w), receiptId: costed.receiptId }));
    const line = await prisma().phReceiptLine.findFirstOrThrow({ where: { receiptId: costed.receiptId }, include: { batch: true } });
    expect(line.batch).toMatchObject({ lot: 'EXP-202808', unitCostMinor: 250n, costCurrency: 'USD', costUnitId: line.unitId });
  });

  it('gives a costless batch the cost of the first costed line that lands on it', async () => {
    const w = await world();
    const made = dataOf(await act(w.owner, entryActions.addEntryLine, newLine(w, { purchasePrice: undefined, supplierId: undefined })));
    dataOf(await act(w.owner, entryActions.finishEntry, { ...placeOf(w), receiptId: made.receiptId }));
    const costed = dataOf(
      await act(w.owner, entryActions.addEntryLine, knownLine(w, { product: { kind: 'known', productId: made.productId }, purchasePrice: '2.50', lot: 'EXP-202808-NC', supplierId: undefined })),
    );
    const done = dataOf(await act(w.owner, entryActions.finishEntry, { ...placeOf(w), receiptId: costed.receiptId }));
    expect(done.warnings).toEqual([]);
    const batches = await prisma().phBatch.findMany({ where: { productId: made.productId } });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ unitCostMinor: 250n, costCurrency: 'USD' });
    expect(batches[0]!.costUnitId).not.toBeNull();
  });

  it('answers a double-clicked Finish without a receipt id with the receipt it just posted', async () => {
    const w = await world();
    const b1 = w.a.branchIds[0]!;
    const added = dataOf(await act(w.owner, entryActions.addEntryLine, knownLine(w)));
    const first = dataOf(await act(w.owner, entryActions.finishEntry, placeOf(w)));
    const second = dataOf(await act(w.owner, entryActions.finishEntry, placeOf(w)));
    expect(first).toMatchObject({ id: added.receiptId, replayed: false });
    expect(second).toMatchObject({ id: added.receiptId, number: first.number, replayed: true });
    expect(await available(w.known.id, b1)).toBe(60);
    // Long after, there is nothing to finish.
    vi.setSystemTime(new Date(NOW.getTime() + 10 * 60_000));
    expect(phCodeOf(await act(w.owner, entryActions.finishEntry, placeOf(w)))).toBe('ENTRY_EMPTY');
  });

  it('posts once when two Finish calls race', async () => {
    const w = await world();
    const b1 = w.a.branchIds[0]!;
    const added = dataOf(await act(w.owner, entryActions.addEntryLine, knownLine(w)));
    const both = await Promise.all([
      act(w.owner, entryActions.finishEntry, { ...placeOf(w), receiptId: added.receiptId }),
      act(w.owner, entryActions.finishEntry, { ...placeOf(w), receiptId: added.receiptId }),
    ]);
    expect(both.map((r) => dataOf(r).replayed).sort()).toEqual([false, true]);
    expect(await available(w.known.id, b1)).toBe(60);
    expect(await prisma().phStockMovement.count({ where: { type: 'RECEIPT' } })).toBe(1);
  });

  it('refuses a replayed key whose receipt was voided, and a key reused for a different line', async () => {
    const w = await world();
    const body = knownLine(w);
    const added = dataOf(await act(w.owner, entryActions.addEntryLine, body));
    expect(phCodeOf(await act(w.owner, entryActions.addEntryLine, { ...body, qty: 7 }))).toBe('CLIENT_KEY_MISMATCH');
    dataOf(await act(w.owner, receiptActions.voidReceipt, { ...placeOf(w), receiptId: added.receiptId }));
    expect(phCodeOf(await act(w.owner, entryActions.addEntryLine, body))).toBe('NOT_DRAFT');
  });

  it('keeps a line’s request key when the receiving editor saves the entry draft unchanged', async () => {
    const w = await world();
    const body = knownLine(w);
    const added = dataOf(await act(w.owner, entryActions.addEntryLine, body));
    dataOf(
      await act(w.owner, receiptActions.update, {
        ...placeOf(w),
        receiptId: added.receiptId,
        expectedVersion: added.version,
        supplierId: w.supplierId,
        receivedOn: '2026-10-27',
        lines: [{ productId: w.known.id, unitId: w.known.box, qty: 2, lot: 'EXP-202808', expiry: '08/2028', unitCostMinor: 310n, currency: 'USD' }],
      }),
    );
    const again = dataOf(await act(w.owner, entryActions.addEntryLine, body));
    expect(again.replayed).toBe(true);
    expect(await prisma().phReceiptLine.count()).toBe(1);
  });

  it('settles two people racing with the same request key: one line, the other refused', async () => {
    const w = await world();
    const body = knownLine(w);
    const both = await Promise.all([act(w.owner, entryActions.addEntryLine, body), act(w.stock, entryActions.addEntryLine, body)]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(both.map((r) => (r.ok ? 'OK' : phCodeOf(r)))).toContain('CLIENT_KEY_MISMATCH');
    expect(await prisma().phReceiptLine.count()).toBe(1);
  });
});

describe('entryLookup', () => {
  it('names a known product by barcode or by name, with its stock, price and last purchase pre-fill', async () => {
    const w = await world();
    const b1 = w.a.branchIds[0]!;
    dataOf(await act(w.owner, entryActions.addEntryLine, knownLine(w, { qty: 2, purchasePrice: '3.10', sellPrice: '20000' })));
    dataOf(await act(w.owner, entryActions.finishEntry, placeOf(w)));
    const byCode = dataOf(await ask(w.owner, entryQueries.entryLookup, { ...placeOf(w), q: '6260147701596' }));
    expect(byCode).toMatchObject({ kind: 'known', canChangePrice: true, canCreateProduct: true, currency: 'IQD' });
    if (byCode.kind !== 'known') throw new Error('known expected');
    expect(byCode.product).toMatchObject({ id: w.known.id, tradeName: 'Glucophage', packetUnitId: w.known.box, packetLabel: 'box', packetBaseQty: 30 });
    expect(byCode.stockBaseQty).toBe(60);
    expect(byCode.sellPrice).toEqual({ amountMinor: '20000', currency: 'IQD' });
    expect(byCode.lastPurchase).toMatchObject({ supplierId: w.supplierId, supplierName: 'Al-Hakeem Store', purchasePriceMinor: '310', purchaseCurrency: 'USD', receivedOn: '2026-10-27' });
    const byName = dataOf(await ask(w.owner, entryQueries.entryLookup, { ...placeOf(w), q: 'glucoph' }));
    expect(byName.kind).toBe('known');
    expect(await available(w.known.id, b1)).toBe(60);
  });

  it('calls an unknown barcode new, offers a choice for several names, and hides the price from a person without price.change', async () => {
    const w = await world();
    const unknown = dataOf(await ask(w.owner, entryQueries.entryLookup, { ...placeOf(w), q: '1234500099' }));
    expect(unknown).toMatchObject({ kind: 'new', barcode: '1234500099' });
    const typed = dataOf(await ask(w.owner, entryQueries.entryLookup, { ...placeOf(w), q: 'Brand new name' }));
    expect(typed).toMatchObject({ kind: 'new', barcode: null });
    dataOf(await act(w.owner, productActions.create, { restaurantId: w.a.id, tradeName: 'Glucophage XR', levels: LADDER }));
    const several = dataOf(await ask(w.owner, entryQueries.entryLookup, { ...placeOf(w), q: 'gluco' }));
    expect(several.kind).toBe('choose');
    const picked = dataOf(await ask(w.owner, entryQueries.entryLookup, { ...placeOf(w), productId: w.known.id }));
    expect(picked.kind).toBe('known');
    const forStock = dataOf(await ask(w.stock, entryQueries.entryLookup, { ...placeOf(w), q: '6260147701596' }));
    expect(forStock.canChangePrice).toBe(false);
    expect(codeOf(await ask(w.cashier, entryQueries.entryLookup, { ...placeOf(w), q: '6260147701596' }))).toBe('FORBIDDEN');
  });
});
