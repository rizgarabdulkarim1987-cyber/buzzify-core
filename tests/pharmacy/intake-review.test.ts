import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import { scopedClient } from '@/server/data/tenant-db';
import { identityKeyOf, searchTextOf } from '@/server/domain/pharmacy/product-identity';
import type { PhRole } from '@/server/domain/pharmacy/permissions';
import * as productActions from '@/server/pharmacy/actions/products';
import * as reviewActions from '@/server/pharmacy/actions/intake-review';
import { LEASE_MS } from '@/server/pharmacy/intake/ai';
import { getBatch, listBatches } from '@/server/pharmacy/intake/batches';
import { matchRows } from '@/server/pharmacy/intake/review';
import * as reviewQueries from '@/server/pharmacy/queries/intake-review';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import type { ActionDef } from '@/server/studio/framework/action';
import { act, ask, codeOf, dataOf, phCodeOf } from './stock-helpers';

/**
 * Invoice intake, matching, review edits and batch reads (phase 5, task 6). The database is the real one (port 54503). Rows are
 * seeded straight in with the extraction as the model would have left it; every change after that goes through the actions.
 */

let seq = 0;
const key = () => `review-key-${(seq += 1)}-aaaa`;

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
const HEADER = { extracted: { supplierName: 'Acme', invoiceNumber: 'INV-1', invoiceDate: '2026-10-20', currency: 'IQD', total: 10000, discount: 0, tax: 0, unclear: [] } };

async function world() {
  const a = await pharmacy('A', { branches: 2 });
  const [b1, b2] = a.branchIds as [string, string];
  const staff = (label: string, role: PhRole, branches = [b1]) => person(label, { staff: [a.id, role, branches] });
  return {
    a,
    b1,
    b2,
    owner: await person('owner', { membership: [a.id, 'OWNER'] }),
    pic: await staff('pic', 'PHARMACIST_IN_CHARGE'),
    manager: await staff('manager', 'BRANCH_MANAGER', [b1, b2]),
    cashier: await staff('cashier', 'CASHIER'),
    pharmacist: await staff('pharmacist', 'PHARMACIST'),
    stock: await staff('stock', 'STOCK'),
    accountant: await staff('accountant', 'ACCOUNTANT'),
  };
}
type World = Awaited<ReturnType<typeof world>>;
const place = (w: World, branch: 1 | 2 = 1) => ({ restaurantId: w.a.id, branchId: branch === 1 ? w.b1 : w.b2 });

/** A catalog product with a tablet and a strip of 10 (the pack), optionally with a barcode on the strip. */
async function product(restaurantId: string, tradeName: string, o: { strength?: string; form?: string; active?: boolean; barcode?: string } = {}) {
  const strength = o.strength ?? '';
  const form = o.form ?? '';
  const made = await prisma().phProduct.create({
    data: {
      restaurantId,
      tradeName,
      strength,
      form,
      active: o.active ?? true,
      // the key the catalog writes (the manufacturer field makes two fixtures of one name different)
      identityKey: identityKeyOf({ tradeName, strength, form, manufacturer: `maker-${(seq += 1)}`, packLabel: '10 strip' }),
      searchText: searchTextOf({ tradeName, genericName: '', activeIngredient: '', strength, form, manufacturer: '' }),
    },
    select: { id: true },
  });
  const tablet = await prisma().phProductUnit.create({ data: { restaurantId, productId: made.id, level: 0, label: 'tablet', baseQty: 1 }, select: { id: true } });
  const strip = await prisma().phProductUnit.create({ data: { restaurantId, productId: made.id, level: 1, label: 'strip', baseQty: 10 }, select: { id: true } });
  if (o.barcode) await prisma().phBarcode.create({ data: { restaurantId, productId: made.id, unitId: strip.id, code: o.barcode } });
  return { id: made.id, tablet: tablet.id, strip: strip.id };
}

async function batch(w: World, o: { branch?: 1 | 2; status?: 'OPEN' | 'APPROVED' | 'CANCELLED'; header?: unknown; createdAt?: Date } = {}) {
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
      header: (o.header ?? HEADER) as object,
      ...(status === 'CANCELLED' ? { cancelledAt: NOW } : {}),
      ...(status === 'APPROVED' ? { approvedAt: NOW, approvedById: w.owner.userId, receiptId: (await prisma().phReceipt.create({ data: { restaurantId: w.a.id, branchId, clientKey: key(), receivedOn: new Date('2026-10-30T00:00:00.000Z'), createdById: w.owner.userId }, select: { id: true } })).id } : {}),
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
    },
    select: { id: true },
  });
  const file = await prisma().phIntakeFile.create({
    data: {
      restaurantId: w.a.id,
      batchId: made.id,
      sha256: createHash('sha256').update(`seed-${(seq += 1)}-${made.id}`).digest('hex'),
      storageKey: null,
      mediaType: 'image/png',
      bytes: 10,
      pages: 1,
      status: 'EXTRACTED',
      expiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
      uploadedById: w.owner.userId,
    },
    select: { id: true },
  });
  return { batchId: made.id, fileId: file.id };
}

let lineNo = 0;
async function row(w: World, fileId: string, over: Record<string, unknown> = {}, rowOver: { edited?: object; lineNo?: number } = {}) {
  const made = await prisma().phIntakeRow.create({
    data: { restaurantId: w.a.id, fileId, lineNo: rowOver.lineNo ?? (lineNo += 1), page: 1, extracted: { ...LINE, ...over }, ...(rowOver.edited ? { edited: rowOver.edited } : {}) },
    select: { id: true },
  });
  return made.id;
}

/** A batch with one matched, otherwise clean line. */
async function clean(w: World, over: Record<string, unknown> = {}) {
  const p = await product(w.a.id, 'Panadol', { strength: '500 mg', form: 'tablet' });
  const b = await batch(w);
  const rowId = await row(w, b.fileId, over);
  await matchRows(prisma(), { restaurantId: w.a.id }, b.batchId, NOW);
  return { ...b, rowId, p };
}

const update = (w: World, who: Person, rowId: string, patch: object, extra: Record<string, unknown> = {}, branch: 1 | 2 = 1) =>
  vact(who, reviewActions.rowUpdate, { ...place(w, branch), rowId, patch, clientKey: key(), ...extra });
const get = (w: World, who: Person, batchId: string, branch?: 1 | 2) => ask(who, reviewQueries.batchGet, { restaurantId: w.a.id, ...(branch ? { branchId: branch === 1 ? w.b1 : w.b2 } : { branchId: w.b1 }), batchId });
const rowOf = (id: string) => prisma().phIntakeRow.findUniqueOrThrow({ where: { id } });
const readRow = async (w: World, batchId: string, rowId: string) => dataOf(await get(w, w.owner, batchId)).rows.find((r) => r.id === rowId)!;

/**
 * Calls a write the way the screen does: with the version it last read and with what it showed the person (the flags of a line
 * for a review, the difference and currency for a header acknowledgement). Anything the test passes itself is kept, so a stale
 * version or a wrong "shown" can be tried on purpose.
 */
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
});

// A valid EAN-13 and its GTIN-14 form ------------------------------------------------------------------------------------

const checkDigit = (digits: string): string => {
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i -= 1, w = w === 3 ? 1 : 3) sum += Number(digits[i]) * w;
  return String((10 - (sum % 10)) % 10);
};
const EAN13 = `622103100234${checkDigit('622103100234')}`;
const GTIN14 = `0${EAN13.slice(0, 12)}${checkDigit(`0${EAN13.slice(0, 12)}`)}`;
const GS1 = { gtin: GTIN14, lot: 'A1', expiry: { date: '2028-03-31', precision: 'MONTH' as const }, source: 'barcode' };

describe('matching lines to the catalog', () => {
  const matchOne = async (w: World, over: Record<string, unknown>) => {
    const b = await batch(w);
    const id = await row(w, b.fileId, over);
    await matchRows(prisma(), { restaurantId: w.a.id }, b.batchId, NOW);
    return rowOf(id);
  };

  it('an exact barcode gives the product and the unit the code belongs to', async () => {
    const w = await world();
    const p = await product(w.a.id, 'Brufen', { barcode: EAN13 });
    const r = await matchOne(w, { name: 'something else entirely', barcodeText: EAN13 });
    expect(r).toMatchObject({ matchState: 'MATCHED', matchedProductId: p.id, matchedUnitId: p.strip });
  });

  it('a GTIN-14 (plain or inside a GS1 string) meets the stored EAN-13', async () => {
    const w = await world();
    const p = await product(w.a.id, 'Brufen', { barcode: EAN13 });
    expect(await matchOne(w, { name: '?', barcodeText: GTIN14 })).toMatchObject({ matchState: 'MATCHED', matchedProductId: p.id });
    expect(await matchOne(w, { name: '?', barcodeText: `(01)${GTIN14}(17)280331(10)A1` })).toMatchObject({ matchState: 'MATCHED', matchedProductId: p.id });
  });

  it('the other direction too: an EAN-13, UPC-A or GTIN-8 on the invoice meets the same item stored as a GTIN-14 or EAN-13 (review minor)', async () => {
    const w = await world();
    const stored14 = await product(w.a.id, 'Stored14', { barcode: GTIN14 });
    expect(await matchOne(w, { name: '?', barcodeText: EAN13 })).toMatchObject({ matchState: 'MATCHED', matchedProductId: stored14.id, matchedUnitId: stored14.strip });
    const upc = '036000291452';
    const storedEan = await product(w.a.id, 'StoredEan', { barcode: `0${upc}` });
    expect(await matchOne(w, { name: '?', barcodeText: upc })).toMatchObject({ matchState: 'MATCHED', matchedProductId: storedEan.id });
    const gtin8 = '96385074';
    const stored8 = await product(w.a.id, 'Stored8', { barcode: gtin8.padStart(14, '0') });
    expect(await matchOne(w, { name: '?', barcodeText: gtin8 })).toMatchObject({ matchState: 'MATCHED', matchedProductId: stored8.id });
    // a code whose check digit is wrong is only ever compared as written
    const wrong = `${EAN13.slice(0, 12)}${(Number(EAN13[12]) + 1) % 10}`;
    expect(await matchOne(w, { name: '?', barcodeText: wrong })).toMatchObject({ matchState: 'UNMATCHED', matchedProductId: null });
  });

  it('the identity key (name, strength, form, pack) matches exactly and proposes the pack unit', async () => {
    const w = await world();
    const p = await product(w.a.id, 'Panadol', { strength: '500 mg', form: 'tablet' });
    await product(w.a.id, 'Panadol Extra', { strength: '500 mg', form: 'tablet' });
    const r = await matchOne(w, { name: 'PANADOL', strength: '500MG', form: 'Tablet' });
    expect(r).toMatchObject({ matchState: 'MATCHED', matchedProductId: p.id, matchedUnitId: p.strip });
  });

  it('the same name with another strength is AMBIGUOUS and nothing is picked', async () => {
    const w = await world();
    const p500 = await product(w.a.id, 'Panadol', { strength: '500 mg', form: 'tablet' });
    const p1000 = await product(w.a.id, 'Panadol', { strength: '1000 mg', form: 'tablet' });
    const r = await matchOne(w, { name: 'Panadol', strength: '250 mg', form: 'tablet' });
    expect(r).toMatchObject({ matchState: 'AMBIGUOUS', matchedProductId: null, matchedUnitId: null });
    expect((r.candidates as Array<{ productId: string }>).map((c) => c.productId).sort()).toEqual([p500.id, p1000.id].sort());
    expect(r.flags).toContain('AMBIGUOUS_MATCH');
  });

  it('a line no product answers to is UNMATCHED with at most five candidates', async () => {
    const w = await world();
    for (const suffix of ['', 'x', 'xyz', 'abcdef', 'abcdefghij', 'abcdefghijklmn', 'zq']) await product(w.a.id, `Zolpidem ${suffix}`.trim() + suffix);
    const r = await matchOne(w, { name: 'Zolpid', strength: '', form: '', pack: '' });
    expect(r.matchState).toBe('UNMATCHED');
    expect(r.matchedProductId).toBeNull();
    expect((r.candidates as unknown[]).length).toBeGreaterThan(0);
    expect((r.candidates as unknown[]).length).toBeLessThanOrEqual(5);
  });

  it('an archived product is never matched, by name or by barcode', async () => {
    const w = await world();
    await product(w.a.id, 'Panadol', { strength: '500 mg', form: 'tablet', active: false, barcode: EAN13 });
    expect(await matchOne(w, {})).toMatchObject({ matchState: 'UNMATCHED', matchedProductId: null });
    expect(await matchOne(w, { name: 'nothing', barcodeText: EAN13 })).toMatchObject({ matchState: 'UNMATCHED', matchedProductId: null });
  });

  it('another business is invisible to the matcher', async () => {
    const w = await world();
    const b = await pharmacy('B');
    await product(b.id, 'Panadol', { strength: '500 mg', form: 'tablet' });
    expect(await matchOne(w, {})).toMatchObject({ matchState: 'UNMATCHED' });
  });

  it('a person’s choice survives a rematch; the rest is matched again', async () => {
    const w = await world();
    const p = await product(w.a.id, 'Panadol', { strength: '500 mg', form: 'tablet' });
    const other = await product(w.a.id, 'Zinnat');
    const b = await batch(w);
    const chosen = await row(w, b.fileId, { name: 'Unknown thing', strength: '', form: '', pack: '' });
    const auto = await row(w, b.fileId);
    expect(codeOf(await vact(w.pic, reviewActions.rowMatch, { ...place(w), rowId: chosen, productId: other.id, unitId: other.tablet }))).toBe('OK');
    await prisma().phIntakeRow.update({ where: { id: auto }, data: { matchState: 'UNMATCHED', matchedProductId: null, matchedUnitId: null } });
    const summary = dataOf(await act(w.pic, reviewActions.rematchBatch, { ...place(w), batchId: b.batchId }));
    expect(summary).toMatchObject({ matched: 1, chosen: 1 });
    expect(await rowOf(chosen)).toMatchObject({ matchState: 'CHOSEN', matchedProductId: other.id, matchedUnitId: other.tablet });
    expect(await rowOf(auto)).toMatchObject({ matchState: 'MATCHED', matchedProductId: p.id });
  });

  it('a chosen product must be active and its unit one of its own; a choice can be taken back', async () => {
    const w = await world();
    const live = await product(w.a.id, 'Panadol', { strength: '500 mg', form: 'tablet' });
    const gone = await product(w.a.id, 'Old', { active: false });
    const stranger = await product(w.a.id, 'Zinnat');
    const { rowId } = await clean(w);
    expect(codeOf(await vact(w.pic, reviewActions.rowMatch, { ...place(w), rowId, productId: gone.id, unitId: gone.strip }))).toBe('CONFLICT');
    expect(codeOf(await vact(w.pic, reviewActions.rowMatch, { ...place(w), rowId, productId: live.id, unitId: stranger.strip }))).toBe('INVALID');
    expect(codeOf(await vact(w.pic, reviewActions.rowMatch, { ...place(w), rowId, productId: 'nope', unitId: live.strip }))).toBe('NOT_FOUND');
    const other = await pharmacy('B');
    const foreign = await product(other.id, 'Foreign');
    expect(codeOf(await vact(w.pic, reviewActions.rowMatch, { ...place(w), rowId, productId: foreign.id, unitId: foreign.strip }))).toBe('NOT_FOUND');
    const cleared = dataOf(await vact(w.pic, reviewActions.rowClearMatch, { ...place(w), rowId }));
    expect(cleared.flags).toContain('MISSING');
    expect(await rowOf(rowId)).toMatchObject({ matchState: 'UNMATCHED', matchedProductId: null });
  });
});

describe('matching 200 lines reads the catalog a constant number of times', () => {
  it('20 lines and 200 lines run the same catalog statements', async () => {
    const w = await world();
    for (let i = 0; i < 60; i += 1) await product(w.a.id, `Drug ${String(i).padStart(3, '0')}`);
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl(TEST_DB) }), log: [{ emit: 'event', level: 'query' }] });
    const catalog: string[] = [];
    (client as unknown as { $on: (e: string, h: (q: { query: string }) => void) => void }).$on('query', (q) => {
      if (/^\s*SELECT/i.test(q.query) && /"(PhProduct|PhBarcode|PhProductUnit)"/.test(q.query)) catalog.push(q.query);
    });
    const seeded = async (n: number) => {
      const b = await batch(w);
      for (let i = 0; i < n; i += 1) await row(w, b.fileId, { name: `Drug ${String(i % 60).padStart(3, '0')}`, strength: '', form: '', pack: '10 strip', barcodeText: i % 3 === 0 ? EAN13 : null });
      return b.batchId;
    };
    try {
      const small = await seeded(20);
      const large = await seeded(200);
      catalog.length = 0;
      await matchRows(client, { restaurantId: w.a.id }, small, NOW);
      const forSmall = catalog.length;
      catalog.length = 0;
      await matchRows(client, { restaurantId: w.a.id }, large, NOW);
      expect(forSmall).toBeGreaterThan(0);
      expect(catalog.length).toBe(forSmall);
      expect(await prisma().phIntakeRow.count({ where: { file: { batchId: large }, matchState: 'MATCHED' } })).toBeGreaterThan(100);
    } finally {
      await client.$disconnect();
    }
  }, 120_000);
});

describe('a catalog of 5,000 products (review I5)', () => {
  it('finds the real product however far down by id it is: exact name, exact barcode, and a misspelt name', async () => {
    const w = await world();
    const restaurantId = w.a.id;
    // 5,000 products that all start with the same three letters as the real one, with ids that sort BEFORE the real one's
    const rows = Array.from({ length: 5000 }, (_, i) => {
      const tradeName = `Zolp${i.toString(36)} ${i % 7} mg`;
      return { id: `a-noise-${String(i).padStart(5, '0')}`, restaurantId, tradeName, strength: '', form: '', identityKey: `${tradeName}|||${restaurantId}|${i}`, searchText: searchTextOf({ tradeName, genericName: '', activeIngredient: '', strength: '', form: '', manufacturer: '' }) };
    });
    await prisma().phProduct.createMany({ data: rows });
    const real = await product(restaurantId, 'Zolpidem Tartrate', { strength: '10 mg', form: 'tablet', barcode: EAN13 });
    expect(await prisma().phProduct.count({ where: { restaurantId } })).toBe(5001);
    const b = await batch(w);
    const exact = await row(w, b.fileId, { name: 'ZOLPIDEM TARTRATE', strength: '10MG', form: 'Tablet', pack: '10 strip', barcodeText: null });
    const byCode = await row(w, b.fileId, { name: 'something else', strength: '', form: '', pack: '', barcodeText: EAN13 });
    const typo = await row(w, b.fileId, { name: 'Zolpidm Tartrate', strength: '', form: '', pack: '', barcodeText: null });
    await matchRows(prisma(), { restaurantId }, b.batchId, NOW);
    expect(await rowOf(exact)).toMatchObject({ matchState: 'MATCHED', matchedProductId: real.id, matchedUnitId: real.strip });
    expect(await rowOf(byCode)).toMatchObject({ matchState: 'MATCHED', matchedProductId: real.id });
    const misspelt = await rowOf(typo);
    expect((misspelt.candidates as Array<{ productId: string }>).map((c) => c.productId)).toContain(real.id);
  }, 120_000);
});

describe('editing a line', () => {
  it('writes only `edited`: the extracted JSON is byte-identical, the effective value is the edit', async () => {
    const w = await world();
    const { rowId, batchId } = await clean(w);
    const before = await rowOf(rowId);
    const result = dataOf(await update(w, w.pic, rowId, { quantity: '25', lot: 'B-77', unitCost: '1,500', expiry: '04/2029', freeOfCharge: false }));
    const after = await rowOf(rowId);
    expect(JSON.stringify(after.extracted)).toBe(JSON.stringify(before.extracted));
    expect(after.edited).toMatchObject({ quantity: 25, lot: 'B-77', unitCost: 1500, expiry: '04/2029', freeOfCharge: false });
    expect(after.version).toBe(before.version + 1);
    expect(result.version).toBe(after.version);
    const read = await readRow(w, batchId, rowId);
    expect(read.line).toMatchObject({ quantity: 25, lot: 'B-77', unitCost: 1500, expiry: '04/2029' });
    expect(read.extracted).toMatchObject({ quantity: 10, lot: 'L1', unitCost: 1000 });
    // 25 x 1500 does not equal the printed line total of 10000
    expect(read.openFlags).toContain('MATH_MISMATCH');
  });

  it('an explicit null clears a value and the line is MISSING again', async () => {
    const w = await world();
    const { rowId } = await clean(w);
    expect(dataOf(await update(w, w.pic, rowId, { lot: null })).flags).toEqual(['MISSING']);
    expect(dataOf(await update(w, w.pic, rowId, { lot: '  ' })).flags).toEqual(['MISSING']);
    expect(dataOf(await update(w, w.pic, rowId, { lot: 'Z9' })).flags).toEqual([]);
  });

  it('refuses values the domain cannot read, with codes, and changes nothing', async () => {
    const w = await world();
    const { rowId } = await clean(w);
    const before = await rowOf(rowId);
    expect(phCodeOf(await update(w, w.pic, rowId, { quantity: 'twelve' }))).toBe('INVALID_QUANTITY');
    expect(phCodeOf(await update(w, w.pic, rowId, { quantity: '12.000' }))).toBe('INVALID_QUANTITY');
    expect(phCodeOf(await update(w, w.pic, rowId, { unitCost: '1.5.5' }))).toBe('INVALID_MONEY');
    expect(phCodeOf(await update(w, w.pic, rowId, { unitCost: '$5' }))).toBe('INVALID_MONEY');
    expect(phCodeOf(await update(w, w.pic, rowId, { expiry: 'next year' }))).toBe('INVALID_EXPIRY');
    expect(codeOf(await update(w, w.pic, rowId, { flags: [] }))).toBe('INVALID');
    expect(codeOf(await update(w, w.pic, rowId, {}))).toBe('INVALID');
    expect(codeOf(await update(w, w.pic, rowId, { quantity: -1 }))).toBe('INVALID');
    expect(await rowOf(rowId)).toMatchObject({ edited: before.edited, version: before.version });
  });

  it('money text needs a known invoice currency', async () => {
    const w = await world();
    const p = await product(w.a.id, 'Panadol', { strength: '500 mg', form: 'tablet' });
    const b = await batch(w, { header: { extracted: { currency: null } } });
    const rowId = await row(w, b.fileId);
    await matchRows(prisma(), { restaurantId: w.a.id }, b.batchId, NOW);
    expect(p.id).toBeTruthy();
    expect(phCodeOf(await update(w, w.pic, rowId, { unitCost: '1,500' }))).toBe('CURRENCY_UNKNOWN');
    expect(codeOf(await update(w, w.pic, rowId, { unitCost: 1500 }))).toBe('OK');
  });

  it('flags are recomputed on the server whatever is stored or claimed', async () => {
    const w = await world();
    const { rowId, batchId } = await clean(w, { lot: null });
    // a stale or forged stored flag set, and a client that claims there is nothing to fix
    await prisma().phIntakeRow.update({ where: { id: rowId }, data: { flags: [] } });
    expect((await readRow(w, batchId, rowId)).flags).toEqual(['MISSING']);
    const result = dataOf(await vact(w.pic, reviewActions.rowUpdate, { ...place(w), rowId, patch: { barcodeText: '5901234123457' }, clientKey: key(), flags: [], openFlags: [] }));
    expect(result.flags).toEqual(['MISSING']);
    expect((await rowOf(rowId)).flags).toEqual(['MISSING']);
  });

  it('a duplicate lot on the same product raises DUPLICATE_LINE on both lines, and clears when one changes', async () => {
    const w = await world();
    const { batchId, fileId, rowId } = await clean(w);
    const second = await row(w, fileId);
    await matchRows(prisma(), { restaurantId: w.a.id }, batchId, NOW);
    expect((await readRow(w, batchId, rowId)).openFlags).toEqual(['DUPLICATE_LINE']);
    expect(dataOf(await update(w, w.pic, second, { lot: 'L2' })).flags).toEqual([]);
    expect((await readRow(w, batchId, rowId)).openFlags).toEqual([]);
  });

  it('a version that is not the line’s current one is a conflict', async () => {
    const w = await world();
    const { rowId } = await clean(w);
    const v = (await rowOf(rowId)).version;
    expect(codeOf(await update(w, w.pic, rowId, { lot: 'A' }, { version: v }))).toBe('OK');
    const stale = await update(w, w.pic, rowId, { lot: 'B' }, { version: v });
    expect(codeOf(stale)).toBe('CONFLICT');
    expect(phCodeOf(stale)).toBe('VERSION_CONFLICT');
    expect((await rowOf(rowId)).edited).toMatchObject({ lot: 'A' });
  });

  it('every write to a line or the header needs the version it saw (review I3)', async () => {
    const w = await world();
    const { rowId, batchId } = await clean(w, { lineTotal: 9000, unclear: ['lot'] });
    const p = place(w);
    const calls: Array<[string, Promise<unknown>]> = [
      ['row.update', act(w.pic, reviewActions.rowUpdate, { ...p, rowId, patch: { lot: 'Q' }, clientKey: key() })],
      ['row.match', act(w.pic, reviewActions.rowMatch, { ...p, rowId, productId: 'x', unitId: 'y' })],
      ['row.clearMatch', act(w.pic, reviewActions.rowClearMatch, { ...p, rowId })],
      ['row.review', act(w.pic, reviewActions.rowReview, { ...p, rowId, note: 'seen', shown: ['MODEL_UNCLEAR'] })],
      ['row.fillFromBarcode', act(w.pic, reviewActions.rowFillFromBarcode, { ...p, rowId })],
      ['row.remove', act(w.pic, reviewActions.rowRemove, { ...p, rowId })],
      ['header.update', act(w.pic, reviewActions.headerUpdate, { ...p, batchId, patch: { tax: 0 } })],
      ['header.acknowledge', act(w.pic, reviewActions.headerAcknowledge, { ...p, batchId, reason: 'seen', shown: { difference: '0', currency: 'IQD' } })],
    ];
    for (const [name, call] of calls) expect(codeOf((await call) as never), `${name} without a version`).toBe('INVALID');
    expect((await rowOf(rowId)).edited).toEqual({});
  });

  it('two keys in a row: the late retry of the first key is refused or replayed, and the second change stays (review I3)', async () => {
    const w = await world();
    const { rowId } = await clean(w);
    const [k1, k2] = [key(), key()];
    const v0 = (await rowOf(rowId)).version;
    const first = dataOf(await act(w.pic, reviewActions.rowUpdate, { ...place(w), rowId, version: v0, patch: { lot: 'K1' }, clientKey: k1 }));
    const second = dataOf(await act(w.pic, reviewActions.rowUpdate, { ...place(w), rowId, version: first.version, patch: { lot: 'K2' }, clientKey: k2 }));
    expect(second.version).toBe(first.version + 1);
    // K1 arrives again late (a flaky network), with the version it was sent with: the line is at K2 now
    const late = await act(w.pic, reviewActions.rowUpdate, { ...place(w), rowId, version: v0, patch: { lot: 'K1' }, clientKey: k1 });
    expect(phCodeOf(late)).toBe('VERSION_CONFLICT');
    expect((await rowOf(rowId)).edited).toMatchObject({ lot: 'K2' });
    // the latest key replays as the same answer
    const again = dataOf(await act(w.pic, reviewActions.rowUpdate, { ...place(w), rowId, version: first.version, patch: { lot: 'K2' }, clientKey: k2 }));
    expect(again).toMatchObject({ replayed: true, version: second.version });
    expect((await rowOf(rowId)).edited).toMatchObject({ lot: 'K2' });
  });

  it('a stale version is refused by every other line write too', async () => {
    const w = await world();
    const { rowId, batchId } = await clean(w, { lineTotal: 9000, unclear: ['lot'] });
    const v0 = (await rowOf(rowId)).version;
    dataOf(await update(w, w.pic, rowId, { lot: 'A' }));
    const p = place(w);
    const flags = ['MATH_MISMATCH'];
    for (const [name, call] of [
      ['row.clearMatch', act(w.pic, reviewActions.rowClearMatch, { ...p, rowId, version: v0 })],
      ['row.review', act(w.pic, reviewActions.rowReview, { ...p, rowId, version: v0, note: 'seen', shown: flags })],
      ['row.fillFromBarcode', act(w.pic, reviewActions.rowFillFromBarcode, { ...p, rowId, version: v0 })],
      ['row.remove', act(w.pic, reviewActions.rowRemove, { ...p, rowId, version: v0 })],
      ['header.update', act(w.pic, reviewActions.headerUpdate, { ...p, batchId, version: 99, patch: { tax: 0 } })],
    ] as const) expect(phCodeOf((await call) as never), name).toBe('VERSION_CONFLICT');
    expect((await rowOf(rowId)).edited).toEqual({ lot: 'A' });
  });

  it('the same clientKey and patch replays; another patch under the key is a mismatch; two at once make one change', async () => {
    const w = await world();
    const { rowId } = await clean(w);
    const k = key();
    const first = dataOf(await vact(w.pic, reviewActions.rowUpdate, { ...place(w), rowId, patch: { lot: 'R1' }, clientKey: k }));
    const again = dataOf(await vact(w.pic, reviewActions.rowUpdate, { ...place(w), rowId, patch: { lot: 'R1' }, clientKey: k }));
    expect(first.replayed).toBe(false);
    expect(again).toMatchObject({ replayed: true, version: first.version });
    expect(phCodeOf(await vact(w.pic, reviewActions.rowUpdate, { ...place(w), rowId, patch: { lot: 'R2' }, clientKey: k }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await vact(w.manager, reviewActions.rowUpdate, { ...place(w), rowId, patch: { lot: 'R1' }, clientKey: k }))).toBe('CLIENT_KEY_MISMATCH');
    const parallel = key();
    const before = (await rowOf(rowId)).version;
    const both = await Promise.all([
      vact(w.pic, reviewActions.rowUpdate, { ...place(w), rowId, patch: { lot: 'P1' }, clientKey: parallel }),
      vact(w.pic, reviewActions.rowUpdate, { ...place(w), rowId, patch: { lot: 'P1' }, clientKey: parallel }),
    ]);
    expect(both.map(codeOf)).toEqual(['OK', 'OK']);
    expect((await rowOf(rowId)).version).toBe(before + 1);
  });

  it('a removed line is not editable', async () => {
    const w = await world();
    const { rowId } = await clean(w);
    expect(codeOf(await vact(w.pic, reviewActions.rowRemove, { ...place(w), rowId }))).toBe('OK');
    expect(phCodeOf(await update(w, w.pic, rowId, { lot: 'X' }))).toBe('ROW_REMOVED');
  });
});

describe('acknowledging what a reviewer saw', () => {
  it('a note clears the unclear-cell flag, and an edit that raises another flag reopens it', async () => {
    const w = await world();
    const { rowId, batchId } = await clean(w, { unclear: ['lot'] });
    expect((await readRow(w, batchId, rowId)).openFlags).toEqual(['MODEL_UNCLEAR']);
    expect(codeOf(await vact(w.pic, reviewActions.rowReview, { ...place(w), rowId, note: 'Checked the lot on the box' }))).toBe('OK');
    expect((await readRow(w, batchId, rowId)).openFlags).toEqual([]);
    // an expiry in the past is a flag the note never saw
    expect(dataOf(await update(w, w.pic, rowId, { expiry: '01/2020' })).flags).toEqual(['EXPIRED']);
    // it can be acknowledged too, and then it is covered, until the date changes to another past date and back
    await vact(w.pic, reviewActions.rowReview, { ...place(w), rowId, note: 'Old stock, goes to quarantine' });
    expect((await readRow(w, batchId, rowId)).openFlags).toEqual([]);
    await update(w, w.pic, rowId, { expiry: '2028-03' });
    expect((await rowOf(rowId)).acknowledged).toMatchObject({ flags: ['MODEL_UNCLEAR'] });
    expect(dataOf(await update(w, w.pic, rowId, { expiry: '01/2020' })).flags).toEqual(['EXPIRED']);
  });

  it('a note does not clear MISSING or AMBIGUOUS_MATCH', async () => {
    const w = await world();
    const { rowId, batchId } = await clean(w, { lot: null });
    await vact(w.pic, reviewActions.rowReview, { ...place(w), rowId, note: 'looked' });
    expect((await readRow(w, batchId, rowId)).openFlags).toEqual(['MISSING']);
  });

  it('a mismatch reason is bound to the exact difference: another edit that changes it reopens the flag', async () => {
    const w = await world();
    const { rowId, batchId } = await clean(w, { lineTotal: 9000 });
    expect((await readRow(w, batchId, rowId)).openFlags).toEqual(['MATH_MISMATCH']);
    // a note alone does not accept a mismatch
    await vact(w.pic, reviewActions.rowReview, { ...place(w), rowId, note: 'looked' });
    expect((await readRow(w, batchId, rowId)).openFlags).toEqual(['MATH_MISMATCH']);
    await vact(w.pic, reviewActions.rowReview, { ...place(w), rowId, note: 'looked', mismatchReason: 'The supplier gave a 10% discount' });
    const reasoned = await readRow(w, batchId, rowId);
    expect(reasoned.openFlags).toEqual([]);
    expect(reasoned.acknowledged.mismatch).toEqual({ difference: '-1000' });
    dataOf(await update(w, w.pic, rowId, { lineTotal: 8000 }));
    const reopened = await readRow(w, batchId, rowId);
    expect(reopened.openFlags).toEqual(['MATH_MISMATCH']);
    expect(reopened.acknowledged.mismatch).toBeNull();
    // back to the accepted difference: the old reason is gone, it does not come back by itself
    dataOf(await update(w, w.pic, rowId, { lineTotal: 9000 }));
    expect((await readRow(w, batchId, rowId)).openFlags).toEqual(['MATH_MISMATCH']);
  });

  it('the header difference is accepted with a reason for that difference only', async () => {
    const w = await world();
    const { batchId } = await clean(w);
    expect(phCodeOf(await vact(w.pic, reviewActions.headerAcknowledge, { ...place(w), batchId, reason: 'fine' }))).toBe('NO_DIFFERENCE');
    dataOf(await vact(w.pic, reviewActions.headerUpdate, { ...place(w), batchId, patch: { total: '12,000' } }));
    let read = dataOf(await get(w, w.owner, batchId));
    expect(read.header.status).toBe('MISMATCH');
    expect(read.approval.reasons).toContainEqual({ code: 'HEADER_MISMATCH' });
    dataOf(await vact(w.pic, reviewActions.headerAcknowledge, { ...place(w), batchId, reason: 'A line was torn off the copy' }));
    read = dataOf(await get(w, w.owner, batchId));
    expect(read.header.acknowledged).toMatchObject({ difference: '2000' });
    expect(read.approval.reasons).toEqual([]);
    expect(read.approval.ok).toBe(true);
    dataOf(await vact(w.pic, reviewActions.headerUpdate, { ...place(w), batchId, patch: { total: 13000 } }));
    read = dataOf(await get(w, w.owner, batchId));
    expect(read.header.acknowledged).toBeNull();
    expect(read.approval.reasons).toContainEqual({ code: 'HEADER_MISMATCH' });
  });
});

describe('an acknowledgement is only for what the person saw (review I2)', () => {
  it('a line review with other flags than the line raises now is refused: ACK_STALE, nothing stored', async () => {
    const w = await world();
    const { rowId, batchId } = await clean(w, { unclear: ['lot'] });
    const version = async () => (await rowOf(rowId)).version;
    const call = async (shown: string[]) => act(w.pic, reviewActions.rowReview, { ...place(w), rowId, version: await version(), note: 'looked', shown });
    expect(phCodeOf(await call([]))).toBe('ACK_STALE');
    expect(phCodeOf(await call(['MODEL_UNCLEAR', 'EXPIRED']))).toBe('ACK_STALE');
    expect((await rowOf(rowId)).reviewed).toBe(false);
    // the flags changed under the reviewer without a version change (a rematch, a barcode read, an edit in another tab)
    await prisma().phIntakeRow.update({ where: { id: rowId }, data: { edited: { expiry: '2020-01' } } });
    expect(phCodeOf(await call(['MODEL_UNCLEAR']))).toBe('ACK_STALE');
    expect((await rowOf(rowId)).reviewed).toBe(false);
    expect(codeOf(await call(['EXPIRED', 'MODEL_UNCLEAR']))).toBe('OK');
    const stored = await rowOf(rowId);
    expect(stored.acknowledged).toMatchObject({ flags: ['EXPIRED', 'MODEL_UNCLEAR'] });
    expect((await readRow(w, batchId, rowId)).openFlags).toEqual([]);
  });

  it('what the client sends only decides a refusal: the stored acknowledgement is what the server derived', async () => {
    const w = await world();
    const { rowId } = await clean(w, { unclear: ['lot'] });
    const result = await act(w.pic, reviewActions.rowReview, { ...place(w), rowId, version: (await rowOf(rowId)).version, note: 'looked', shown: ['MODEL_UNCLEAR', 'MODEL_UNCLEAR'], acknowledged: { flags: ['MISSING'], mismatch: { reason: 'x', difference: '1' } } });
    expect(codeOf(result)).toBe('OK');
    expect((await rowOf(rowId)).acknowledged).toEqual({ flags: ['MODEL_UNCLEAR'], mismatch: null });
  });

  it('a header acknowledgement names the exact difference and currency it saw', async () => {
    const w = await world();
    const { batchId } = await clean(w);
    dataOf(await act(w.pic, reviewActions.headerUpdate, { ...place(w), batchId, version: 1, patch: { total: '12,000' } }));
    const send = async (shown: object) => act(w.pic, reviewActions.headerAcknowledge, { ...place(w), batchId, version: (await prisma().phIntakeBatch.findUniqueOrThrow({ where: { id: batchId } })).version, reason: 'A line was torn off', shown });
    expect(phCodeOf(await send({ difference: '1000', currency: 'IQD' }))).toBe('ACK_STALE');
    expect(phCodeOf(await send({ difference: '2000', currency: 'USD' }))).toBe('ACK_STALE');
    expect(phCodeOf(await send({ difference: '2000', currency: null }))).toBe('ACK_STALE');
    expect(dataOf(await get(w, w.owner, batchId)).header.acknowledged).toBeNull();
    expect(codeOf(await send({ difference: '2000', currency: 'IQD' }))).toBe('OK');
    expect((await prisma().phIntakeBatch.findUniqueOrThrow({ where: { id: batchId } })).header).toMatchObject({ acknowledged: { difference: '2000', currency: 'IQD' } });
  });

  it('the acknowledgement is bound to the currency: changing it brings the mismatch back, for the header and for a line', async () => {
    const w = await world();
    const { batchId, rowId } = await clean(w, { lineTotal: 9000 });
    dataOf(await vact(w.pic, reviewActions.rowReview, { ...place(w), rowId, note: 'looked', mismatchReason: 'ok' }));
    expect((await readRow(w, batchId, rowId)).openFlags).toEqual([]);
    dataOf(await vact(w.pic, reviewActions.headerAcknowledge, { ...place(w), batchId, reason: 'The invoice total is off' }));
    let read = dataOf(await get(w, w.owner, batchId));
    expect(read.approval.ok).toBe(true);
    dataOf(await vact(w.pic, reviewActions.headerUpdate, { ...place(w), batchId, patch: { currency: 'USD' } }));
    read = dataOf(await get(w, w.owner, batchId));
    expect(read.header.acknowledged).toBeNull();
    expect(read.approval.reasons).toContainEqual({ code: 'HEADER_MISMATCH' });
    expect((await readRow(w, batchId, rowId)).openFlags).toEqual(['MATH_MISMATCH']);
  });
});

describe('header edits', () => {
  it('go to header.edited over the extraction, validate the supplier, and keep the model’s reading', async () => {
    const w = await world();
    const { batchId } = await clean(w);
    const supplier = await prisma().phSupplier.create({ data: { restaurantId: w.a.id, name: 'Acme Pharma', nameKey: 'acme pharma', clientKey: key(), defaultCurrency: 'IQD', createdById: w.owner.userId }, select: { id: true } });
    const gone = await prisma().phSupplier.create({ data: { restaurantId: w.a.id, name: 'Old Co', nameKey: 'old co', clientKey: key(), defaultCurrency: 'IQD', active: false, createdById: w.owner.userId }, select: { id: true } });
    const other = await pharmacy('B');
    const foreign = await prisma().phSupplier.create({ data: { restaurantId: other.id, name: 'Foreign', nameKey: 'foreign', clientKey: key(), defaultCurrency: 'IQD', createdById: w.owner.userId }, select: { id: true } });
    const ok = dataOf(await vact(w.pic, reviewActions.headerUpdate, { ...place(w), batchId, patch: { invoiceNumber: 'INV-77', invoiceDate: '21/10/2026', currency: 'USD', total: '100.50', supplierId: supplier.id } }));
    expect(ok.version).toBe(2);
    const stored = await prisma().phIntakeBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(stored.supplierId).toBe(supplier.id);
    expect(stored.header).toMatchObject({ extracted: HEADER.extracted, edited: { invoiceNumber: 'INV-77', invoiceDate: '2026-10-21', currency: 'USD', total: 10050 } });
    const read = dataOf(await get(w, w.owner, batchId));
    expect(read.header.values).toMatchObject({ invoiceNumber: 'INV-77', currency: 'USD', total: 10050 });
    expect(read.header.extracted).toMatchObject({ invoiceNumber: 'INV-1', currency: 'IQD' });
    expect(codeOf(await vact(w.pic, reviewActions.headerUpdate, { ...place(w), batchId, patch: { supplierId: gone.id } }))).toBe('CONFLICT');
    expect(codeOf(await vact(w.pic, reviewActions.headerUpdate, { ...place(w), batchId, patch: { supplierId: foreign.id } }))).toBe('NOT_FOUND');
    expect(phCodeOf(await vact(w.pic, reviewActions.headerUpdate, { ...place(w), batchId, patch: { invoiceDate: '03/2028' } }))).toBe('INVALID_DATE');
    expect(phCodeOf(await vact(w.pic, reviewActions.headerUpdate, { ...place(w), batchId, patch: { total: 'lots' } }))).toBe('INVALID_MONEY');
    const stale = await vact(w.pic, reviewActions.headerUpdate, { ...place(w), batchId, version: 1, patch: { tax: 5 } });
    expect(phCodeOf(stale)).toBe('VERSION_CONFLICT');
  });

  it('removing a line changes the header check, and the header sum ignores removed lines', async () => {
    const w = await world();
    const { batchId, fileId, rowId } = await clean(w);
    const extra = await row(w, fileId, { lot: 'L2' });
    await matchRows(prisma(), { restaurantId: w.a.id }, batchId, NOW);
    expect(dataOf(await get(w, w.owner, batchId)).header.status).toBe('MISMATCH');
    dataOf(await vact(w.pic, reviewActions.rowRemove, { ...place(w), rowId: extra }));
    const read = dataOf(await get(w, w.owner, batchId));
    expect(read.header.status).toBe('OK');
    expect(read.rows.find((r) => r.id === rowId)!.removed).toBe(false);
    expect(read.rows.find((r) => r.id === extra)).toMatchObject({ removed: true, flags: [], openFlags: [] });
    expect(read.approval.ok).toBe(true);
  });
});

describe('reading a lot and expiry from a barcode', () => {
  const gs1 = GS1;

  it('fills an empty lot and expiry, marks them as read from the barcode, and recomputes', async () => {
    const w = await world();
    const { rowId, batchId } = await clean(w, { lot: null, expiry: null, gs1 });
    expect((await readRow(w, batchId, rowId)).openFlags).toEqual(['MISSING']);
    const result = dataOf(await vact(w.pic, reviewActions.rowFillFromBarcode, { ...place(w), rowId }));
    expect(result).toMatchObject({ filled: ['expiry', 'lot'], flags: [] });
    expect((await rowOf(rowId)).edited).toMatchObject({ lot: 'A1', expiry: '2028-03-31', fieldSources: { lot: 'barcode', expiry: 'barcode' } });
  });

  it('never replaces a printed or typed value', async () => {
    const w = await world();
    const { rowId } = await clean(w, { lot: 'PRINTED', expiry: null, gs1 });
    const result = dataOf(await vact(w.pic, reviewActions.rowFillFromBarcode, { ...place(w), rowId }));
    expect(result.filled).toEqual(['expiry']);
    expect((await rowOf(rowId)).edited).toMatchObject({ expiry: '2028-03-31', fieldSources: { expiry: 'barcode' } });
    expect((await rowOf(rowId)).edited).not.toHaveProperty('lot');
    const b = await batch(w);
    const full = await row(w, b.fileId, { gs1 });
    expect(dataOf(await vact(w.pic, reviewActions.rowFillFromBarcode, { ...place(w), rowId: full })).filled).toEqual([]);
    expect((await rowOf(full)).edited).toEqual({});
  });

  it('reads a typed GS1 barcode, and refuses when there is nothing to read', async () => {
    const w = await world();
    const { rowId } = await clean(w, { lot: null, expiry: null });
    expect(phCodeOf(await vact(w.pic, reviewActions.rowFillFromBarcode, { ...place(w), rowId }))).toBe('NOTHING_TO_FILL');
    dataOf(await update(w, w.pic, rowId, { barcodeText: `(01)${GTIN14}(17)280331(10)B2` }));
    expect(dataOf(await vact(w.pic, reviewActions.rowFillFromBarcode, { ...place(w), rowId })).filled).toEqual(['expiry', 'lot']);
    expect((await rowOf(rowId)).edited).toMatchObject({ lot: 'B2' });
  });

  it('a value the person types afterwards is no longer marked as read from the barcode', async () => {
    const w = await world();
    const { rowId } = await clean(w, { lot: null, expiry: null, gs1 });
    dataOf(await vact(w.pic, reviewActions.rowFillFromBarcode, { ...place(w), rowId }));
    dataOf(await update(w, w.pic, rowId, { lot: 'TYPED' }));
    expect((await rowOf(rowId)).edited).toMatchObject({ lot: 'TYPED', fieldSources: { expiry: 'barcode' } });
    expect(((await rowOf(rowId)).edited as { fieldSources: object }).fieldSources).not.toHaveProperty('lot');
  });
});

describe('adding and removing lines', () => {
  it('a person adds a line the model dropped: empty, manual, MISSING, and editable like any other', async () => {
    const w = await world();
    const { batchId, fileId, rowId: first } = await clean(w);
    const added = dataOf(await act(w.pic, reviewActions.rowAdd, { ...place(w), fileId }));
    const stored = await rowOf(added.rowId);
    expect(stored.lineNo).toBe(added.lineNo);
    expect(added.lineNo).toBe((await rowOf(first)).lineNo + 1);
    expect(stored).toMatchObject({ extracted: {}, edited: { source: 'manual' }, flags: ['MISSING'], matchState: 'UNMATCHED' });
    dataOf(await update(w, w.pic, added.rowId, { name: 'Panadol', strength: '500 mg', form: 'tablet', pack: '10 strip', quantity: 4, unitCost: 1000, lineTotal: 4000, lot: 'M1', expiry: '2029-01' }));
    dataOf(await act(w.pic, reviewActions.rematchBatch, { ...place(w), batchId }));
    const read = (await readRow(w, batchId, added.rowId))!;
    expect(read).toMatchObject({ manual: true, matchState: 'MATCHED', openFlags: [] });
    expect(read.line).toMatchObject({ name: 'Panadol', quantity: 4 });
    expect(await rowOf(added.rowId)).toMatchObject({ extracted: {} });
  });

  it('removing keeps the row (soft), ignores it in approval, and a second removal changes nothing', async () => {
    const w = await world();
    const { batchId, fileId } = await clean(w);
    const noisy = await row(w, fileId, { lot: null });
    await matchRows(prisma(), { restaurantId: w.a.id }, batchId, NOW);
    expect(dataOf(await get(w, w.owner, batchId)).approval.ok).toBe(false);
    dataOf(await vact(w.pic, reviewActions.rowRemove, { ...place(w), rowId: noisy }));
    expect(await rowOf(noisy)).toMatchObject({ edited: { removed: true }, extracted: expect.objectContaining({ name: 'Panadol' }) });
    expect(dataOf(await get(w, w.owner, batchId)).approval.ok).toBe(true);
    const v = (await rowOf(noisy)).version;
    expect(dataOf(await vact(w.pic, reviewActions.rowRemove, { ...place(w), rowId: noisy })).replayed).toBe(true);
    expect((await rowOf(noisy)).version).toBe(v);
  });

  it('a line is added only to a file of an open batch in the place’s branch', async () => {
    const w = await world();
    const there = await batch(w, { branch: 2 });
    expect(codeOf(await act(w.pic, reviewActions.rowAdd, { ...place(w), fileId: there.fileId }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.manager, reviewActions.rowAdd, { ...place(w), fileId: there.fileId }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.manager, reviewActions.rowAdd, { ...place(w, 2), fileId: there.fileId }))).toBe('OK');
    const done = await batch(w, { status: 'APPROVED' });
    expect(phCodeOf(await act(w.pic, reviewActions.rowAdd, { ...place(w), fileId: done.fileId }))).toBe('BATCH_NOT_OPEN');
  });
});

describe('adding a line needs a file that was read (review I4)', () => {
  it('a file that is not EXTRACTED takes no hand-added line: it is not found, as is a purged or foreign one', async () => {
    const w = await world();
    for (const status of ['UPLOADED', 'EXTRACTING', 'FAILED', 'REJECTED_QUALITY', 'PURGED'] as const) {
      const b = await batch(w);
      await prisma().phIntakeFile.update({
        where: { id: b.fileId },
        data: { status, ...(status === 'EXTRACTING' ? { extractingSince: NOW, attempts: 1 } : {}), ...(status === 'FAILED' ? { failureCode: 'AI_TIMEOUT' } : {}), ...(status === 'REJECTED_QUALITY' ? { failureCode: 'BLURRY' } : {}) },
      });
      const refused = await act(w.pic, reviewActions.rowAdd, { ...place(w), fileId: b.fileId });
      expect(codeOf(refused), status).toBe('NOT_FOUND');
      expect(await prisma().phIntakeRow.count({ where: { fileId: b.fileId } }), status).toBe(0);
    }
    const ok = await batch(w);
    expect(codeOf(await act(w.pic, reviewActions.rowAdd, { ...place(w), fileId: ok.fileId }))).toBe('OK');
  });
});

describe('who may review and what is closed', () => {
  type Ids = Awaited<ReturnType<typeof clean>>;
  /** Every write definition of the review, each with the line it needs and the call. */
  const edits: Array<[string, Record<string, unknown>, (w: World, who: Person, ids: Ids) => Promise<unknown>]> = [
    ['row.update', {}, (w, who, ids) => update(w, who, ids.rowId, { lot: 'Q' })],
    ['row.match', {}, (w, who, ids) => vact(who, reviewActions.rowMatch, { ...place(w), rowId: ids.rowId, productId: ids.p.id, unitId: ids.p.tablet })],
    ['row.clearMatch', {}, (w, who, ids) => vact(who, reviewActions.rowClearMatch, { ...place(w), rowId: ids.rowId })],
    ['row.review', {}, (w, who, ids) => vact(who, reviewActions.rowReview, { ...place(w), rowId: ids.rowId, note: 'seen' })],
    ['row.fillFromBarcode', { lot: null, expiry: null, gs1: GS1 }, (w, who, ids) => vact(who, reviewActions.rowFillFromBarcode, { ...place(w), rowId: ids.rowId })],
    ['row.add', {}, (w, who, ids) => act(who, reviewActions.rowAdd, { ...place(w), fileId: ids.fileId })],
    ['row.remove', {}, (w, who, ids) => vact(who, reviewActions.rowRemove, { ...place(w), rowId: ids.rowId })],
    ['header.update', {}, (w, who, ids) => vact(who, reviewActions.headerUpdate, { ...place(w), batchId: ids.batchId, patch: { tax: 0 } })],
    ['header.acknowledge', { unitCost: 900, lineTotal: 9000 }, (w, who, ids) => vact(who, reviewActions.headerAcknowledge, { ...place(w), batchId: ids.batchId, reason: 'seen' })],
    ['rematch', {}, (w, who, ids) => act(who, reviewActions.rematchBatch, { ...place(w), batchId: ids.batchId })],
  ];

  it('editing needs ai.use AND purchase.manage: owner, manager and pharmacist in charge may; stock keeper, accountant, pharmacist and cashier may not (every write definition)', async () => {
    expect(edits.map(([name]) => name).sort()).toEqual(
      ['header.acknowledge', 'header.update', 'rematch', 'row.add', 'row.clearMatch', 'row.fillFromBarcode', 'row.match', 'row.remove', 'row.review', 'row.update'],
    );
    for (const [name, over, run] of edits) {
      const w = await world();
      for (const who of [w.stock, w.accountant, w.pharmacist, w.cashier]) {
        const ids = await clean(w, over);
        const before = await prisma().phIntakeRow.findMany({ orderBy: { id: 'asc' } });
        expect(codeOf((await run(w, who, ids)) as never), `${name} as a role without both`).toBe('FORBIDDEN');
        expect(await prisma().phIntakeRow.findMany({ orderBy: { id: 'asc' } }), `${name} changed nothing`).toEqual(before);
      }
      for (const who of [w.owner, w.manager, w.pic]) {
        const ids = await clean(w, over);
        expect(codeOf((await run(w, who, ids)) as never), `${name} as a role with both`).toBe('OK');
      }
      await resetWorld();
    }
  });

  it('a support grant holder cannot edit or read', async () => {
    const w = await world();
    const ids = await clean(w);
    const support = await person('support', { superAdmin: true });
    await grant(support, w.a.id);
    expect(codeOf(await update(w, support, ids.rowId, { lot: 'Q' }))).not.toBe('OK');
    expect(codeOf(await get(w, support, ids.batchId))).not.toBe('OK');
    expect((await rowOf(ids.rowId)).edited).toEqual({});
  });

  it('a batch of another branch or business is not found; the place must be the batch’s branch', async () => {
    const w = await world();
    const there = await batch(w, { branch: 2 });
    const rowThere = await row(w, there.fileId);
    expect(codeOf(await update(w, w.pic, rowThere, { lot: 'Q' }, {}, 1))).toBe('NOT_FOUND');
    expect(codeOf(await update(w, w.manager, rowThere, { lot: 'Q' }, {}, 1))).toBe('NOT_FOUND');
    expect(codeOf(await update(w, w.manager, rowThere, { lot: 'Q' }, {}, 2))).toBe('OK');
    expect(codeOf(await get(w, w.pic, there.batchId, 1))).toBe('NOT_FOUND');
    expect(codeOf(await get(w, w.manager, there.batchId, 1))).toBe('NOT_FOUND');
    expect(codeOf(await get(w, w.manager, there.batchId, 2))).toBe('OK');
    const b = await pharmacy('B');
    const bOwner = await person('owner-b', { membership: [b.id, 'OWNER'] });
    const foreign = await vact(bOwner, reviewActions.rowUpdate, { restaurantId: b.id, branchId: b.branchId, rowId: rowThere, patch: { lot: 'Q' }, clientKey: key() });
    expect(codeOf(foreign)).toBe('NOT_FOUND');
    expect(codeOf(await ask(bOwner, reviewQueries.batchGet, { restaurantId: b.id, branchId: b.branchId, batchId: there.batchId }))).toBe('NOT_FOUND');
  });

  it('an approved or cancelled batch cannot be edited, matched, read from a barcode, added to, rematched or acknowledged: all ten writes', async () => {
    for (const status of ['APPROVED', 'CANCELLED'] as const) {
      const w = await world();
      const p = await product(w.a.id, 'Panadol', { strength: '500 mg', form: 'tablet' });
      const b = await batch(w, { status });
      const rowId = await row(w, b.fileId, { lot: null, expiry: null, gs1: GS1 });
      const there = place(w);
      const calls: Array<[string, Promise<unknown>]> = [
        ['row.update', update(w, w.pic, rowId, { lot: 'Q' })],
        ['row.match', vact(w.pic, reviewActions.rowMatch, { ...there, rowId, productId: p.id, unitId: p.tablet })],
        ['row.clearMatch', vact(w.pic, reviewActions.rowClearMatch, { ...there, rowId })],
        ['row.review', vact(w.pic, reviewActions.rowReview, { ...there, rowId, note: 'x' })],
        ['row.fillFromBarcode', vact(w.pic, reviewActions.rowFillFromBarcode, { ...there, rowId })],
        ['row.add', act(w.pic, reviewActions.rowAdd, { ...there, fileId: b.fileId })],
        ['row.remove', vact(w.pic, reviewActions.rowRemove, { ...there, rowId })],
        ['header.update', vact(w.pic, reviewActions.headerUpdate, { ...there, batchId: b.batchId, patch: { tax: 1 } })],
        ['header.acknowledge', vact(w.pic, reviewActions.headerAcknowledge, { ...there, batchId: b.batchId, reason: 'x' })],
        ['rematch', act(w.pic, reviewActions.rematchBatch, { ...there, batchId: b.batchId })],
      ];
      for (const [name, call] of calls) expect(phCodeOf((await call) as never), `${name} on ${status}`).toBe('BATCH_NOT_OPEN');
      expect(await rowOf(rowId)).toMatchObject({ edited: {}, matchState: 'UNMATCHED', reviewed: false });
      expect(await prisma().phIntakeRow.count({ where: { fileId: b.fileId } })).toBe(1);
      await resetWorld();
    }
  });
});

describe('the audit trail', () => {
  it('holds field names, flag codes, ids and statuses: never a value, a note or a reason', async () => {
    const w = await world();
    const { rowId, batchId, fileId } = await clean(w, { unclear: ['lot'] });
    dataOf(await update(w, w.pic, rowId, { name: 'SECRET-NAME-77', lot: 'SECRET-LOT-77', barcodeText: 'SECRET-BARCODE-77', unitCost: 4321 }));
    dataOf(await vact(w.pic, reviewActions.rowReview, { ...place(w), rowId, note: 'SECRET-NOTE-77', mismatchReason: 'SECRET-REASON-77' }));
    dataOf(await vact(w.pic, reviewActions.headerUpdate, { ...place(w), batchId, patch: { invoiceNumber: 'SECRET-INV-77', total: 12345 } }));
    dataOf(await vact(w.pic, reviewActions.headerAcknowledge, { ...place(w), batchId, reason: 'SECRET-HEADER-REASON-77' }));
    const added = dataOf(await act(w.pic, reviewActions.rowAdd, { ...place(w), fileId }));
    dataOf(await update(w, w.pic, added.rowId, { name: 'SECRET-ADDED-77' }));
    dataOf(await vact(w.pic, reviewActions.rowRemove, { ...place(w), rowId: added.rowId }));
    dataOf(await act(w.pic, reviewActions.rematchBatch, { ...place(w), batchId }));
    const entries = await prisma().auditLog.findMany({ where: { action: { startsWith: 'ph.intake.' } }, orderBy: { occurredAt: 'asc' } });
    const actions = new Set(entries.map((e) => e.action));
    for (const name of ['ph.intake.row.update', 'ph.intake.row.review', 'ph.intake.header.update', 'ph.intake.header.acknowledge', 'ph.intake.row.add', 'ph.intake.row.remove', 'ph.intake.rematch']) expect(actions.has(name), name).toBe(true);
    const text = JSON.stringify(entries.map((e) => e.changes));
    expect(text).not.toMatch(/SECRET/);
    expect(text).not.toContain('Panadol');
    // the actual numbers and strings of the fixture: unit cost 4321, header total 12345, line total 10000, the line difference, the header difference (12345 - 10000), the model's invoice number
    for (const value of ['4321', '12345', '10000', '33210', '2345', 'INV-1', 'IQD', 'USD']) expect(text, value).not.toContain(value);
    const acknowledged = entries.find((e) => e.action === 'ph.intake.header.acknowledge')!;
    expect(JSON.stringify(acknowledged.changes)).not.toMatch(/difference|currency|amount/i);
    expect(acknowledged.changes).toMatchObject({ acknowledged: { before: false, after: true } });
    const updated = entries.find((e) => e.action === 'ph.intake.row.update' && JSON.stringify(e.changes).includes('unitCost'))!;
    expect(updated.changes).toMatchObject({ fields: { after: ['barcodeText', 'lot', 'name', 'unitCost'] }, flags: { before: expect.any(Array), after: expect.any(Array) } });
  });
});

describe('unit removal and intake matches (review I5)', () => {
  const ladder = (levels: number) => [
    { level: 0, label: 'tablet', baseQty: 1, sellable: true },
    { level: 1, label: 'strip', baseQty: 10, sellable: true },
    { level: 2, label: 'box', baseQty: 30, sellable: true },
  ].slice(0, levels);
  const input = (restaurantId: string, levels: number, over: Record<string, unknown> = {}) => ({ restaurantId, tradeName: 'Panadol', strength: '500 mg', form: 'tablet', manufacturer: 'GSK', rxLevel: 'OTC', levels: ladder(levels), barcodes: [], branchSettings: [], ...over });

  it('clears the matches that point at a removed pack in an open batch and recomputes their flags', async () => {
    const w = await world();
    const created = dataOf(await act(w.owner, productActions.create, input(w.a.id, 3)));
    const units = await prisma().phProductUnit.findMany({ where: { productId: created.id }, orderBy: { level: 'asc' } });
    const box = units[2]!;
    const b = await batch(w);
    const rowId = await row(w, b.fileId);
    expect(codeOf(await vact(w.pic, reviewActions.rowMatch, { ...place(w), rowId, productId: created.id, unitId: box.id }))).toBe('OK');
    expect((await readRow(w, b.batchId, rowId)).openFlags).toEqual([]);
    const done = await batch(w, { status: 'APPROVED' });
    const history = await row(w, done.fileId);
    await prisma().phIntakeRow.update({ where: { id: history }, data: { matchState: 'CHOSEN', matchedProductId: created.id, matchedUnitId: units[1]!.id } });

    // removing the box: the open batch's line goes back to unmatched
    dataOf(await act(w.owner, productActions.update, { ...input(w.a.id, 2), productId: created.id, expectedVersion: created.version }));
    expect(await prisma().phProductUnit.count({ where: { productId: created.id } })).toBe(2);
    expect(await rowOf(rowId)).toMatchObject({ matchState: 'UNMATCHED', matchedProductId: null, matchedUnitId: null });
    expect((await readRow(w, b.batchId, rowId)).openFlags).toEqual(['MISSING']);
  });

  it('a cancelled batch does not hold a pack: its matches are cleared and the pack goes (review minor)', async () => {
    const w = await world();
    const created = dataOf(await act(w.owner, productActions.create, input(w.a.id, 3)));
    const units = await prisma().phProductUnit.findMany({ where: { productId: created.id }, orderBy: { level: 'asc' } });
    const gone = await batch(w, { status: 'CANCELLED' });
    const history = await row(w, gone.fileId);
    await prisma().phIntakeRow.update({ where: { id: history }, data: { matchState: 'CHOSEN', matchedProductId: created.id, matchedUnitId: units[2]!.id } });
    dataOf(await act(w.owner, productActions.update, { ...input(w.a.id, 2), productId: created.id, expectedVersion: created.version }));
    expect(await prisma().phProductUnit.count({ where: { productId: created.id } })).toBe(2);
    expect(await rowOf(history)).toMatchObject({ matchState: 'UNMATCHED', matchedProductId: null, matchedUnitId: null });
  });

  it('the refusal says an approved invoice line is the reason, and a status change racing the removal cannot slip a line past it', async () => {
    const w = await world();
    const created = dataOf(await act(w.owner, productActions.create, input(w.a.id, 3)));
    const units = await prisma().phProductUnit.findMany({ where: { productId: created.id }, orderBy: { level: 'asc' } });
    const done = await batch(w, { status: 'APPROVED' });
    const history = await row(w, done.fileId);
    await prisma().phIntakeRow.update({ where: { id: history }, data: { matchState: 'CHOSEN', matchedProductId: created.id, matchedUnitId: units[2]!.id } });
    const refused = await act(w.owner, productActions.update, { ...input(w.a.id, 2), productId: created.id, expectedVersion: created.version });
    expect(phCodeOf(refused)).toBe('UNIT_IN_USE');
    expect(refused.ok ? '' : refused.error.message).toMatch(/approved invoice/i);
    expect(await prisma().phProductUnit.count({ where: { productId: created.id } })).toBe(3);
  });

  it('refuses to remove a pack an approved batch still points at, and removes nothing', async () => {
    const w = await world();
    const created = dataOf(await act(w.owner, productActions.create, input(w.a.id, 3)));
    const units = await prisma().phProductUnit.findMany({ where: { productId: created.id }, orderBy: { level: 'asc' } });
    const done = await batch(w, { status: 'APPROVED' });
    const history = await row(w, done.fileId);
    await prisma().phIntakeRow.update({ where: { id: history }, data: { matchState: 'CHOSEN', matchedProductId: created.id, matchedUnitId: units[2]!.id } });
    const refused = await act(w.owner, productActions.update, { ...input(w.a.id, 2), productId: created.id, expectedVersion: created.version });
    expect(phCodeOf(refused)).toBe('UNIT_IN_USE');
    expect(await prisma().phProductUnit.count({ where: { productId: created.id } })).toBe(3);
    expect(await rowOf(history)).toMatchObject({ matchedUnitId: units[2]!.id });
  });
});

describe('reading batches', () => {
  it('lists newest first by keyset, stable when a batch changes status between pages', async () => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push((await batch(w, { createdAt: new Date(NOW.getTime() - i * 60_000) })).batchId);
    const page = async (cursor?: string | null, status?: 'OPEN' | 'CANCELLED') => dataOf(await ask(w.pic, reviewQueries.batchList, { ...place(w), take: 2, ...(cursor ? { cursor } : {}), ...(status ? { status } : {}) }));
    const first = await page(undefined, 'OPEN');
    expect(first.items.map((b) => b.id)).toEqual([ids[0], ids[1]]);
    // the last batch of the page leaves the filter, and a new, newer batch appears
    await prisma().phIntakeBatch.update({ where: { id: ids[1]! }, data: { status: 'CANCELLED', cancelledAt: NOW } });
    await batch(w, { createdAt: new Date(NOW.getTime() + 60_000) });
    const second = await page(first.nextCursor, 'OPEN');
    expect(second.items.map((b) => b.id)).toEqual([ids[2], ids[3]]);
    const third = await page(second.nextCursor, 'OPEN');
    expect(third.items.map((b) => b.id)).toEqual([ids[4]]);
    expect(third.nextCursor).toBeNull();
    expect(codeOf(await ask(w.pic, reviewQueries.batchList, { ...place(w), cursor: '!!!' }))).toBe('INVALID');
    expect(codeOf(await ask(w.pic, reviewQueries.batchList, { ...place(w), take: 51 }))).toBe('INVALID');
  });

  it('the list carries the counts a screen shows: files, lines read, files that need attention, who made it', async () => {
    const w = await world();
    const b = await batch(w);
    await row(w, b.fileId);
    await row(w, b.fileId);
    const extra = (status: 'FAILED' | 'REJECTED_QUALITY' | 'UPLOADED', n: number) =>
      prisma().phIntakeFile.create({
        data: { restaurantId: w.a.id, batchId: b.batchId, sha256: createHash('sha256').update(`counts-${n}-${b.batchId}`).digest('hex'), storageKey: null, mediaType: 'image/png', bytes: 10, pages: 1, uploadedById: w.owner.userId, status, ...(status === 'FAILED' ? { failureCode: 'AI_TIMEOUT' } : status === 'REJECTED_QUALITY' ? { failureCode: 'BLURRY' } : {}), expiresAt: new Date(NOW.getTime() + 86_400_000) },
      });
    await extra('FAILED', 1);
    await extra('REJECTED_QUALITY', 2);
    await extra('UPLOADED', 3);
    const item = dataOf(await ask(w.pic, reviewQueries.batchList, { ...place(w) })).items.find((i) => i.id === b.batchId)!;
    expect(item).toMatchObject({ fileCount: 4, rowCount: 2, attentionCount: 2, createdById: w.owner.userId });
    expect(dataOf(await get(w, w.owner, b.batchId)).batch.createdById).toBe(w.owner.userId);
  });

  it('a file still EXTRACTING past the server lease reads as stale; a fresh one, and one in any other state, does not', async () => {
    const w = await world();
    const b = await batch(w);
    const make = (n: number, status: 'EXTRACTING' | 'UPLOADED', since: Date | null) =>
      prisma().phIntakeFile.create({
        data: { restaurantId: w.a.id, batchId: b.batchId, sha256: createHash('sha256').update(`stale-${n}-${b.batchId}`).digest('hex'), storageKey: null, mediaType: 'image/png', bytes: 10, pages: 1, uploadedById: w.owner.userId, status, extractingSince: since, expiresAt: new Date(NOW.getTime() + 86_400_000) },
        select: { id: true },
      });
    const dead = await make(1, 'EXTRACTING', new Date(NOW.getTime() - LEASE_MS - 1000));
    const live = await make(2, 'EXTRACTING', new Date(NOW.getTime() - LEASE_MS + 60_000));
    const idle = await make(3, 'UPLOADED', null);
    const files = dataOf(await get(w, w.owner, b.batchId)).files;
    const staleOf = (id: string) => files.find((f) => f.id === id)?.stale;
    expect([staleOf(dead.id), staleOf(live.id), staleOf(idle.id), staleOf(b.fileId)]).toEqual([true, false, false, false]);
  });

  it('branch-limited roles see their own branch’s batches only; the manager sees both', async () => {
    const w = await world();
    const one = await batch(w);
    const two = await batch(w, { branch: 2 });
    const list = async (who: Person, branch?: 1 | 2) => dataOf(await ask(who, reviewQueries.batchList, { restaurantId: w.a.id, ...(branch ? { branchId: branch === 1 ? w.b1 : w.b2 } : {}) })).items.map((b) => b.id);
    // a role limited to one branch sees that branch with or without naming it; the manager sees both branches, or the one named
    expect(await list(w.pic)).toEqual([one.batchId]);
    expect(await list(w.pic, 1)).toEqual([one.batchId]);
    expect((await list(w.manager)).sort()).toEqual([one.batchId, two.batchId].sort());
    expect(await list(w.manager, 1)).toEqual([one.batchId]);
    expect(await list(w.manager, 2)).toEqual([two.batchId]);
    expect(codeOf(await ask(w.pic, reviewQueries.batchList, { restaurantId: w.a.id, branchId: w.b2 }))).not.toBe('OK');
    expect(codeOf(await ask(w.cashier, reviewQueries.batchList, { ...place(w) }))).toBe('FORBIDDEN');
  });

  it('shows what the lines are now: flags recomputed at read time, match names, candidates and the verdict', async () => {
    const w = await world();
    const { batchId, rowId, p } = await clean(w, { lot: null });
    await product(w.a.id, 'Panadol', { strength: '1000 mg', form: 'tablet' });
    await prisma().phIntakeRow.update({ where: { id: rowId }, data: { flags: [], candidates: [{ productId: p.id, score: 1000 }] } });
    const read = dataOf(await get(w, w.pic, batchId));
    const r = read.rows[0]!;
    expect(r.flags).toEqual(['MISSING']);
    expect(r.openFlags).toEqual(['MISSING']);
    expect(r.match).toMatchObject({ productId: p.id, name: 'Panadol', unitLabel: 'strip' });
    expect(r.candidates).toEqual([expect.objectContaining({ productId: p.id, name: 'Panadol', strength: '500 mg', score: 1000 })]);
    expect(read.approval).toMatchObject({ ok: false, reasons: [{ code: 'OPEN_FLAG', rowIndex: 0, flag: 'MISSING' }] });
    expect(read.files[0]).not.toHaveProperty('storageKey');
    expect(read.files[0]).toMatchObject({ status: 'EXTRACTED', pages: 1 });
    expect(read.totals).toEqual([{ currency: 'IQD', lineTotalMinor: '10000' }]);
  });

  it('a file still waiting to be read, or being read, blocks the approval verdict with FILES_STILL_PROCESSING', async () => {
    const w = await world();
    const { batchId, fileId } = await clean(w);
    expect(dataOf(await get(w, w.pic, batchId)).approval).toMatchObject({ ok: true, reasons: [] });
    const extra = async (status: 'UPLOADED' | 'EXTRACTING' | 'EXTRACTED' | 'FAILED') =>
      prisma().phIntakeFile.create({
        data: {
          restaurantId: w.a.id,
          batchId,
          sha256: createHash('sha256').update(`extra-${(seq += 1)}`).digest('hex'),
          storageKey: null,
          mediaType: 'image/png',
          bytes: 10,
          pages: 1,
          status,
          ...(status === 'EXTRACTING' ? { extractingSince: NOW, attempts: 1 } : {}),
          ...(status === 'FAILED' ? { failureCode: 'AI_TIMEOUT' } : {}),
          expiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
          uploadedById: w.owner.userId,
        },
        select: { id: true },
      });
    void fileId;
    for (const status of ['UPLOADED', 'EXTRACTING'] as const) {
      const made = await extra(status);
      const read = dataOf(await get(w, w.pic, batchId));
      expect(read.approval.ok, status).toBe(false);
      expect(read.approval.reasons, status).toContainEqual(expect.objectContaining({ code: 'FILES_STILL_PROCESSING' }));
      await prisma().phIntakeFile.delete({ where: { id: made.id } });
    }
    // a file that is read, or failed (the lines are typed by hand), does not block
    await extra('EXTRACTED');
    await extra('FAILED');
    expect(dataOf(await get(w, w.pic, batchId)).approval).toMatchObject({ ok: true, reasons: [] });
  });

  it('adds up line totals per currency in BigInt, beyond a safe integer', async () => {
    const w = await world();
    const { batchId, fileId } = await clean(w, { lineTotal: 9_000_000_000_000_000 });
    await row(w, fileId, { lot: 'L2', lineTotal: 9_000_000_000_000_000 });
    const read = dataOf(await get(w, w.owner, batchId));
    expect(read.totals).toEqual([{ currency: 'IQD', lineTotalMinor: '18000000000000000' }]);
  });

  it('shows money only with cost.view: the key is absent otherwise', async () => {
    const w = await world();
    const { batchId, rowId } = await clean(w, { lineTotal: 9000 });
    await vact(w.pic, reviewActions.rowReview, { ...place(w), rowId, note: 'looked', mismatchReason: 'discount' });
    for (const who of [w.owner, w.pic]) {
      const read = dataOf(await get(w, who, batchId));
      expect(read.rows[0]!.line).toHaveProperty('unitCost', 1000);
      expect(read.header.values).toHaveProperty('total', 10000);
      expect(read.header).toHaveProperty('arithmetic');
      expect(read.totals).toBeDefined();
    }
    // Every role that may read intake also holds cost.view, so the gate is proven on the service with the key switched off.
    const scoped = scopedClient(prisma(), { restaurantId: w.a.id, allBranches: true });
    const read = await getBatch(scoped, batchId, w.b1, false, NOW);
    const text = JSON.stringify(read);
    expect(read.rows[0]!.line).not.toHaveProperty('unitCost');
    expect(read.rows[0]!.line).not.toHaveProperty('lineTotal');
    expect(read.rows[0]!.extracted).not.toHaveProperty('unitCost');
    expect(read.header.values).not.toHaveProperty('total');
    expect(read.header.extracted).not.toHaveProperty('tax');
    expect(read.header).not.toHaveProperty('arithmetic');
    expect(read).not.toHaveProperty('totals');
    expect(text).not.toContain('10000');
    expect(text).not.toContain('-1000');
    expect(read.rows[0]!.acknowledged.mismatch).toEqual({});
    expect(read.rows[0]!.flags).toBeDefined();
    expect((await listBatches(scoped, { take: 50, branchId: w.b1 }, false)).items[0]).not.toHaveProperty('totalMinor');
    expect(dataOf(await ask(w.owner, reviewQueries.batchList, { ...place(w) })).items[0]).toHaveProperty('totalMinor', '10000');
  });
});

// The unit rule and the batch scan (review fixes I1, I5) -------------------------------------------------------------------

describe('the pack unit is never taken silently (review I1)', () => {
  const stateOf = async (w: World, over: Record<string, unknown>) => {
    await product(w.a.id, 'Panadol', { strength: '500 mg', form: 'tablet' });
    const b = await batch(w);
    const id = await row(w, b.fileId, over);
    await matchRows(prisma(), { restaurantId: w.a.id }, b.batchId, NOW);
    return rowOf(id);
  };

  it('a product with several units and a pack text that names one is matched with that unit', async () => {
    const w = await world();
    const made = await stateOf(w, { pack: '10 strip' });
    expect(made).toMatchObject({ matchState: 'MATCHED' });
    const strip = await prisma().phProductUnit.findFirstOrThrow({ where: { productId: made.matchedProductId!, label: 'strip' } });
    expect(made.matchedUnitId).toBe(strip.id);
  });

  it('a product with several units and a pack text that names none is AMBIGUOUS, with no unit chosen', async () => {
    for (const pack of ['', '30', 'box']) {
      await resetWorld();
      const w = await world();
      const made = await stateOf(w, { pack });
      expect(made, `pack "${pack}"`).toMatchObject({ matchState: 'AMBIGUOUS', matchedUnitId: null });
    }
  });

  it('the batch read gives the units of the matched product, for the unit select', async () => {
    const w = await world();
    const { batchId, rowId } = await clean(w);
    const read = await readRow(w, batchId, rowId);
    expect(read.match?.units?.map((u) => u.label).sort()).toEqual(['strip', 'tablet']);
  });
});

describe('one scan for the whole batch (review I5)', () => {
  const scan = (w: World, who: Person, batchId: string, barcode: string, branch: 1 | 2 = 1) =>
    act(who, reviewActions.intakeScan, { ...place(w, branch), batchId, barcode, clientKey: key() });

  it('puts the product on the first open line that looks like it, with the unit of the code', async () => {
    const w = await world();
    const p = await product(w.a.id, 'Brufen', { strength: '400 mg', form: 'tablet', barcode: EAN13 });
    const b = await batch(w);
    const other = await row(w, b.fileId, { name: 'Something unrelated', pack: '' });
    const target = await row(w, b.fileId, { name: 'Brufen 400', strength: '', form: '', pack: '' });
    const out = dataOf(await scan(w, w.pic, b.batchId, EAN13));
    expect(out).toMatchObject({ rowId: target, how: 'open', productName: 'Brufen' });
    expect(await rowOf(target)).toMatchObject({ matchState: 'CHOSEN', matchedProductId: p.id, matchedUnitId: p.strip });
    expect(await rowOf(other)).toMatchObject({ matchedProductId: null });
  });

  it('a scan of the same product again lands on the line that already holds it and changes nothing else', async () => {
    const w = await world();
    const p = await product(w.a.id, 'Brufen', { barcode: EAN13 });
    const b = await batch(w);
    const target = await row(w, b.fileId, { name: 'Brufen', pack: '' });
    await scan(w, w.pic, b.batchId, EAN13);
    const again = dataOf(await scan(w, w.pic, b.batchId, EAN13));
    expect(again).toMatchObject({ rowId: target, how: 'same', filled: [] });
    expect(await rowOf(target)).toMatchObject({ matchedProductId: p.id });
  });

  it('a GS1 code fills an empty lot and expiry, marked barcode, and never replaces a value the line has', async () => {
    const w = await world();
    await product(w.a.id, 'Brufen', { barcode: EAN13 });
    const b = await batch(w);
    const empty = await row(w, b.fileId, { name: 'Brufen', pack: '', lot: null, expiry: null });
    const gs1 = `(01)${GTIN14}(17)280331(10)A1`;
    const out = dataOf(await scan(w, w.pic, b.batchId, gs1));
    expect(out.filled).toEqual(['expiry', 'lot']);
    expect((await rowOf(empty)).edited).toMatchObject({ lot: 'A1', fieldSources: { lot: 'barcode', expiry: 'barcode' } });
    const kept = await row(w, b.fileId, { name: 'Brufen', pack: '', lot: 'KEEP', expiry: '2029-01' });
    await prisma().phIntakeRow.update({ where: { id: empty }, data: { matchState: 'UNMATCHED', matchedProductId: null, matchedUnitId: null } });
    await scan(w, w.pic, b.batchId, gs1);
    expect((await rowOf(kept)).edited).toEqual({});
  });

  it('no line for the product: NO_LINE_FOR_BARCODE with the product name, nothing written', async () => {
    const w = await world();
    await product(w.a.id, 'Brufen', { barcode: EAN13 });
    const b = await batch(w);
    const line = await row(w, b.fileId, { name: 'Completely different', pack: '' });
    const before = await rowOf(line);
    const out = await scan(w, w.pic, b.batchId, EAN13);
    expect(codeOf(out)).toBe('NOT_FOUND');
    expect(phCodeOf(out)).toBe('NO_LINE_FOR_BARCODE');
    expect(JSON.stringify(out)).toContain('Brufen');
    expect(await rowOf(line)).toMatchObject({ version: before.version });
  });

  it('an unknown code is BARCODE_UNKNOWN; a code on two products is BARCODE_AMBIGUOUS', async () => {
    const w = await world();
    const b = await batch(w);
    await row(w, b.fileId, { name: 'Anything' });
    expect(phCodeOf(await scan(w, w.pic, b.batchId, EAN13))).toBe('BARCODE_UNKNOWN');
    const one = await product(w.a.id, 'One');
    const two = await product(w.a.id, 'Two');
    for (const x of [one, two]) await prisma().phBarcode.create({ data: { restaurantId: w.a.id, productId: x.id, unitId: x.strip, code: EAN13, shared: true } });
    expect(phCodeOf(await scan(w, w.pic, b.batchId, EAN13))).toBe('BARCODE_AMBIGUOUS');
  });

  it('is refused for a batch that is not open, for the other branch, and for a role without purchase.manage', async () => {
    const w = await world();
    await product(w.a.id, 'Brufen', { barcode: EAN13 });
    const closed = await batch(w, { status: 'CANCELLED' });
    await row(w, closed.fileId, { name: 'Brufen' });
    expect(codeOf(await scan(w, w.pic, closed.batchId, EAN13))).not.toBe('OK');
    const open = await batch(w);
    await row(w, open.fileId, { name: 'Brufen' });
    expect(codeOf(await scan(w, w.pic, open.batchId, EAN13, 2))).not.toBe('OK');
    expect(codeOf(await scan(w, w.cashier, open.batchId, EAN13))).not.toBe('OK');
  });
});
