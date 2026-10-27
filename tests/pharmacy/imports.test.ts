import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import * as importActions from '@/server/pharmacy/actions/imports';
import * as priceActions from '@/server/pharmacy/actions/prices';
import * as productActions from '@/server/pharmacy/actions/products';
import { exportProducts, PH_EXPORT_MAX_ROWS } from '@/server/pharmacy/exports';
import { setFirstPrices } from '@/server/pharmacy/prices';
import { createProduct, createProducts, ListEntryError, productInput } from '@/server/pharmacy/products';
import * as exportQueries from '@/server/pharmacy/queries/exports';
import { readSheet } from '@/server/sheets/read';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { phScopedClient } from '@/server/studio/framework/access';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { asPh, DAY, grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';

const META = { ip: '203.0.113.23', userAgent: 'vitest' };

const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
const phCodeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.fields?.phCode);
const actorOf = async (who: Person): Promise<Actor> => (await loadActor(prisma(), who.userId)) as Actor;
const act = async <I, O>(who: Person, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), await actorOf(who), def, input, META);
const ask = async <I, O>(who: Person, def: QueryDef<I, O>, input: unknown) => runQuery(prisma(), await actorOf(who), def, input);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected OK, got ${result.error.code}: ${result.error.message} ${JSON.stringify(result.error.fields)}`);
  return result.data;
};

/** An EAN-13 with a correct check digit, from a 12-digit body. */
function ean13(n: number): string {
  const body = `629${String(n).padStart(9, '0')}`;
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

const HEAD = ['Trade name', 'Strength', 'Form', 'Manufacturer', 'Rx', 'Pack', 'Units per pack', 'Barcode', 'Price', 'Min qty'];
type Row = string[];
/** A clean row: OTC, a box of 20 tablets, a valid barcode, 1,250 IQD. */
const drug = (n: number, over: Partial<Record<'name' | 'rx' | 'pack' | 'per' | 'barcode' | 'price' | 'min', string>> = {}): Row => [
  over.name ?? `Drug ${n}`,
  '500 mg',
  'tablet',
  'ACME',
  over.rx ?? 'OTC',
  over.pack ?? 'box',
  over.per ?? '20',
  over.barcode ?? ean13(n),
  over.price ?? '1,250',
  over.min ?? '',
];
const cell = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
const csvBytes = (rows: Row[], head: Row = HEAD) => Buffer.from([head, ...rows].map((r) => r.map(cell).join(',')).join('\n'), 'utf8');
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const csvFile = (rows: Row[], fileName = 'list.csv') => ({ fileName, fileBase64: b64(csvBytes(rows)) });

async function xlsxBytes(rows: Row[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRows([HEAD, ...rows]);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

type Preview = {
  batchId: string;
  batchHash: string;
  suggestedMapping: Record<string, string | null>;
  summary: { ok: number; warnings: number; errors: number; duplicates: number; rows: number };
  firstRowsWithIssues: { rowNumber: number; status: string; issues: { code: string; field: string; severity: string }[] }[];
};
type Applied = { created: number; alreadyApplied: boolean; prices: number; skipped: number; excluded: number };

const preview = async (who: Person, place: { restaurantId: string; branchId?: string }, file: object, extra: object = {}) =>
  act(who, importActions.preview, { ...place, ...file, ...extra }) as Promise<ActionResult<Preview>>;
const apply = async (who: Person, place: { restaurantId: string; branchId?: string }, input: object) =>
  act(who, importActions.apply, { ...place, ...input }) as Promise<ActionResult<Applied>>;
const exported = async (who: Person, place: { restaurantId: string; branchId?: string }, format: 'csv' | 'xlsx' = 'csv') =>
  ask(who, exportQueries.products, { ...place, format }) as Promise<ActionResult<{ fileName: string; contentType: string; base64: string; rows: number }>>;

/** An export read back as a sheet. */
async function sheetOf(result: ActionResult<{ base64: string }>) {
  const bytes = new Uint8Array(Buffer.from(dataOf(result).base64, 'base64'));
  return { bytes, sheet: await readSheet(bytes, { maxRows: 100_000 }) };
}

const panadol = (restaurantId: string, over: Record<string, unknown> = {}) => ({
  restaurantId,
  tradeName: 'Panadol',
  strength: '500 mg',
  form: 'tablet',
  manufacturer: 'GSK',
  rxLevel: 'OTC',
  levels: [
    { level: 0, label: 'tablet', baseQty: 1, sellable: true },
    { level: 1, label: 'box', baseQty: 20, sellable: true },
  ],
  barcodes: [],
  branchSettings: [],
  ...over,
});

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

describe('pharmacy product import', () => {
  it('preview stores rows and issues and changes no product', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const bytes = csvBytes([drug(1), drug(2, { price: '0' }), drug(3, { rx: 'maybe' })]);

    const result = dataOf(await preview(owner, { restaurantId: a.id }, { fileName: 'list.csv', fileBase64: b64(bytes) }));
    expect(result.summary).toMatchObject({ ok: 1, warnings: 1, errors: 1, duplicates: 0, rows: 3 });
    expect(result.suggestedMapping).toMatchObject({ 'Trade name': 'tradeName', Rx: 'rxLevel', Pack: 'packLabel', 'Units per pack': 'unitsPerPack', Price: 'salePrice' });
    expect(result.batchHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.firstRowsWithIssues.map((r) => [r.rowNumber, r.status, r.issues.map((i) => i.code)])).toEqual([
      [3, 'warning', ['ZERO_PRICE']],
      [4, 'error', ['UNKNOWN_RX_LEVEL']],
    ]);

    const batch = await prisma().phImportBatch.findUniqueOrThrow({ where: { id: result.batchId } });
    expect(batch).toMatchObject({ restaurantId: a.id, status: 'PREVIEWED', createdById: owner.userId });
    expect(batch.fileSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    const rows = await prisma().phImportRow.findMany({ where: { batchId: batch.id }, orderBy: { rowNumber: 'asc' } });
    expect(rows.map((r) => [r.rowNumber, r.status, r.restaurantId])).toEqual([
      [2, 'OK', a.id],
      [3, 'WARNING', a.id],
      [4, 'ERROR', a.id],
    ]);
    expect(rows[0]!.raw).toEqual(drug(1));
    expect(rows[2]!.issues).toEqual([expect.objectContaining({ code: 'UNKNOWN_RX_LEVEL', field: 'rxLevel', severity: 'error' })]);
    expect(rows[0]!.parsed).toMatchObject({ values: { tradeName: 'Drug 1', unitsPerPack: 20, salePrice: { amount: '1250', currency: 'IQD' } } });

    // Nothing in the catalog changed.
    expect(await prisma().phProduct.count()).toBe(0);
    expect(await prisma().phPrice.count()).toBe(0);
    // One audit row with counts, never a row's contents.
    const audits = await prisma().auditLog.findMany({ where: { action: 'ph.import.preview' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ restaurantId: a.id, entityType: 'PhImportBatch', entityId: batch.id });
    expect(audits[0]!.changes).toMatchObject({ rows: { after: 3 }, ok: { after: 1 }, warnings: { after: 1 }, errors: { after: 1 } });
    expect(JSON.stringify(audits[0]!.changes)).not.toMatch(/Drug|ACME|629/);
  });

  it('apply creates exactly the ok rows and audits one summary entry', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    // Already in the catalog: the import skips it, never updates it.
    const existing = dataOf(await act(owner, productActions.create, panadol(a.id)));
    const rows = [
      drug(1, { min: '15' }),
      drug(2),
      drug(3, { price: '0' }),
      drug(4, { name: 'Panadol', barcode: '' }).map((c, i) => (i === 3 ? 'GSK' : c)),
    ];
    const pre = dataOf(await preview(owner, { restaurantId: a.id }, csvFile(rows)));
    expect(pre.summary).toMatchObject({ ok: 2, warnings: 1, duplicates: 1, errors: 0 });

    const done = dataOf(await apply(owner, { restaurantId: a.id }, { batchId: pre.batchId, batchHash: pre.batchHash, acceptWarnings: false }));
    expect(done).toMatchObject({ created: 2, alreadyApplied: false, prices: 2, skipped: 2, excluded: 0 });

    const products = await prisma().phProduct.findMany({ orderBy: { tradeName: 'asc' }, include: { units: { orderBy: { level: 'asc' } }, barcodes: true } });
    expect(products.map((p) => p.tradeName)).toEqual(['Drug 1', 'Drug 2', 'Panadol']);
    const one = products[0]!;
    // Through the product service: the same identity, search text, ladder and barcode rules as a product made by hand.
    expect(one.identityKey).toBe('drug 1|500mg|tablet|acme|20 box');
    expect(one.searchText).toBe(searchTextOf({ tradeName: 'Drug 1', genericName: '', activeIngredient: '', strength: '500 mg', form: 'tablet', manufacturer: 'ACME' }));
    expect(one).toMatchObject({ restaurantId: a.id, rxLevel: 'OTC', active: true, version: 1 });
    expect(one.units.map((u) => [u.level, u.label, u.baseQty, u.sellable])).toEqual([
      [0, 'tablet', 1, true],
      [1, 'box', 20, true],
    ]);
    expect(one.barcodes.map((b) => [b.code, b.unitId])).toEqual([[ean13(1), one.units[1]!.id]]);
    // The sale price is a business-wide price of the pack, from now, through the price service.
    const prices = await prisma().phPrice.findMany({ where: { productId: one.id } });
    expect(prices.map((p) => [p.unitId, p.branchId, p.currency, p.amountMinor, p.validFrom.toISOString(), p.validTo, p.changedById])).toEqual([
      [one.units[1]!.id, null, 'IQD', 1250n, NOW.toISOString(), null, owner.userId],
    ]);
    // Min qty: the business has one branch, so it is that branch's.
    const settings = await prisma().phProductBranch.findMany({ where: { productId: one.id } });
    expect(settings.map((s) => [s.branchId, s.minQty, s.reorderQty])).toEqual([[a.branchId, 15, 0]]);
    // The catalog's own product was not touched.
    expect(await prisma().phProduct.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ version: 1 });

    const batch = await prisma().phImportBatch.findUniqueOrThrow({ where: { id: pre.batchId } });
    expect(batch.status).toBe('COMMITTED');
    const audits = await prisma().auditLog.findMany({ where: { action: 'ph.import.apply' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ restaurantId: a.id, actorId: owner.userId, entityType: 'PhImportBatch', entityId: pre.batchId });
    expect(audits[0]!.changes).toMatchObject({ status: { before: 'PREVIEWED', after: 'COMMITTED' }, created: { after: 2 }, prices: { after: 2 }, skipped: { after: 2 } });
    expect(JSON.stringify(audits[0]!.changes)).not.toMatch(/Drug|ACME|629/);
    // No product audit row per imported product: the one summary entry covers the batch.
    expect(await prisma().auditLog.count({ where: { action: 'ph.product.create' } })).toBe(1);

    // Warning rows go in only when accepted.
    const second = dataOf(await preview(owner, { restaurantId: a.id }, csvFile([drug(5), drug(6, { price: '0' })], 'second.csv')));
    const accepted = dataOf(await apply(owner, { restaurantId: a.id }, { batchId: second.batchId, batchHash: second.batchHash, acceptWarnings: true }));
    expect(accepted).toMatchObject({ created: 2, skipped: 0 });
    expect(await prisma().phProduct.count({ where: { tradeName: { in: ['Drug 5', 'Drug 6'] } } })).toBe(2);
  });

  it('apply of the same batch twice creates the products once', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const pre = dataOf(await preview(owner, { restaurantId: a.id }, csvFile([drug(1), drug(2)])));
    const input = { batchId: pre.batchId, batchHash: pre.batchHash, acceptWarnings: false };

    expect(dataOf(await apply(owner, { restaurantId: a.id }, input))).toMatchObject({ created: 2, alreadyApplied: false });
    expect(dataOf(await apply(owner, { restaurantId: a.id }, input))).toMatchObject({ created: 0, alreadyApplied: true });
    expect(await prisma().phProduct.count()).toBe(2);
    expect(await prisma().auditLog.count({ where: { action: 'ph.import.apply' } })).toBe(1);

    // At the same time: the claim lets one apply through; the others wait for it and answer alreadyApplied.
    const again = dataOf(await preview(owner, { restaurantId: a.id }, csvFile([drug(3), drug(4), drug(5)], 'again.csv')));
    const results = await Promise.all(
      Array.from({ length: 4 }, () => apply(owner, { restaurantId: a.id }, { batchId: again.batchId, batchHash: again.batchHash, acceptWarnings: false })),
    );
    const answers = results.map((r) => dataOf(r));
    expect(answers.filter((r) => !r.alreadyApplied).map((r) => r.created)).toEqual([3]);
    expect(answers.filter((r) => r.alreadyApplied)).toHaveLength(3);
    expect(await prisma().phProduct.count()).toBe(5);
    expect(await prisma().auditLog.count({ where: { action: 'ph.import.apply' } })).toBe(2);
  });

  it('a changed batchHash is refused', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const pre = dataOf(await preview(owner, { restaurantId: a.id }, csvFile([drug(1), drug(2)])));

    const wrong = await apply(owner, { restaurantId: a.id }, { batchId: pre.batchId, batchHash: 'f'.repeat(64), acceptWarnings: false });
    expect(wrong).toMatchObject({ ok: false, error: { code: 'CONFLICT', fields: { phCode: 'BATCH_STALE' } } });

    // A stored row changed after the preview: the hash recomputed from the rows no longer matches.
    const row = await prisma().phImportRow.findFirstOrThrow({ where: { batchId: pre.batchId, rowNumber: 2 } });
    const parsed = row.parsed as { values: Record<string, unknown> };
    await prisma().phImportRow.update({ where: { id: row.id }, data: { parsed: { ...parsed, values: { ...parsed.values, tradeName: 'Other' } } } });
    const tampered = await apply(owner, { restaurantId: a.id }, { batchId: pre.batchId, batchHash: pre.batchHash, acceptWarnings: false });
    expect(phCodeOf(tampered)).toBe('BATCH_STALE');

    expect(await prisma().phProduct.count()).toBe(0);
    expect((await prisma().phImportBatch.findUniqueOrThrow({ where: { id: pre.batchId } })).status).toBe('PREVIEWED');

    // Another business's batch is not found, whatever the hash.
    const b = await pharmacy('B');
    const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
    expect(codeOf(await apply(ownerB, { restaurantId: b.id }, { batchId: pre.batchId, batchHash: pre.batchHash, acceptWarnings: false }))).toBe('NOT_FOUND');
  });

  it('a batch with error rows cannot be applied unless they are excluded', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const pre = dataOf(await preview(owner, { restaurantId: a.id }, csvFile([drug(1), drug(2, { per: 'many' }), drug(3), drug(4, { rx: '' })])));
    expect(pre.summary).toMatchObject({ ok: 2, errors: 2 });
    const base = { batchId: pre.batchId, batchHash: pre.batchHash, acceptWarnings: false };

    const refused = await apply(owner, { restaurantId: a.id }, base);
    expect(refused).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { phCode: 'IMPORT_HAS_ERRORS', rows: '3, 5' } } });
    // Excluding one of the two is not enough.
    expect(phCodeOf(await apply(owner, { restaurantId: a.id }, { ...base, excludeRowNumbers: [3] }))).toBe('IMPORT_HAS_ERRORS');
    expect(await prisma().phProduct.count()).toBe(0);

    const done = dataOf(await apply(owner, { restaurantId: a.id }, { ...base, excludeRowNumbers: [3, 5] }));
    expect(done).toMatchObject({ created: 2, excluded: 2 });
    expect((await prisma().phProduct.findMany({ orderBy: { tradeName: 'asc' } })).map((p) => p.tradeName)).toEqual(['Drug 1', 'Drug 3']);
  });

  it('the same file uploaded again is flagged DUPLICATE_IMPORT', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const file = csvFile([drug(1)]);
    const first = dataOf(await preview(owner, { restaurantId: a.id }, file));
    const firstBatch = await prisma().phImportBatch.findUniqueOrThrow({ where: { id: first.batchId } });

    vi.setSystemTime(new Date(NOW.getTime() + DAY));
    // Another name, the same bytes.
    const again = await preview(owner, { restaurantId: a.id }, { ...file, fileName: 'renamed.csv' });
    expect(again).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', fields: { phCode: 'DUPLICATE_IMPORT', batchId: first.batchId, previewedAt: firstBatch.createdAt.toISOString() } },
    });
    expect(await prisma().phImportBatch.count()).toBe(1);

    // Previewing it again needs a reason, which the audit keeps.
    expect(codeOf(await preview(owner, { restaurantId: a.id }, file, { overrideReason: 'no' }))).toBe('INVALID');
    const forced = dataOf(await preview(owner, { restaurantId: a.id }, file, { overrideReason: 'Supplier sent the list again' }));
    expect(forced.batchId).not.toBe(first.batchId);
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.import.preview', entityId: forced.batchId } });
    expect(audit.changes).toMatchObject({ overrideReason: { after: 'Supplier sent the list again' }, duplicateOf: { after: first.batchId } });

    // Another business may import the same file.
    const b = await pharmacy('B');
    const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
    expect(codeOf(await preview(ownerB, { restaurantId: b.id }, file))).toBe('OK');
  });

  it('a file with the wrong bytes behind an .xlsx name is refused', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const place = { restaurantId: a.id };

    const textAsXlsx = await preview(owner, place, { fileName: 'list.xlsx', fileBase64: b64(csvBytes([drug(1)])) });
    expect(textAsXlsx).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { phCode: 'FILE_TYPE_MISMATCH' } } });
    const xlsx = await xlsxBytes([drug(1)]);
    expect(phCodeOf(await preview(owner, place, { fileName: 'list.csv', fileBase64: b64(xlsx) }))).toBe('FILE_TYPE_MISMATCH');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(phCodeOf(await preview(owner, place, { fileName: 'list.csv', fileBase64: b64(png) }))).toBe('FILE_TYPE_MISMATCH');
    expect(phCodeOf(await preview(owner, place, { fileName: 'list.txt', fileBase64: b64(csvBytes([drug(1)])) }))).toBe('FILE_TYPE');
    expect(codeOf(await preview(owner, place, { fileName: 'list.csv', fileBase64: 'not base64!' }))).toBe('INVALID');
    expect(await prisma().phImportBatch.count()).toBe(0);

    // The real thing passes.
    const ok = dataOf(await preview(owner, place, { fileName: 'list.xlsx', fileBase64: b64(xlsx) }));
    expect(ok.summary).toMatchObject({ ok: 1, rows: 1 });
  });

  it('10,001 rows are refused with TOO_MANY_ROWS', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const many = Array.from({ length: 10_001 }, (_, i) => drug(i + 1));

    const csv = await preview(owner, { restaurantId: a.id }, csvFile(many));
    expect(csv).toMatchObject({ ok: false, error: { code: 'INVALID', message: 'Use at most 10,000 rows', fields: { phCode: 'TOO_MANY_ROWS' } } });
    const xlsx = await preview(owner, { restaurantId: a.id }, { fileName: 'many.xlsx', fileBase64: b64(await xlsxBytes(many)) });
    expect(phCodeOf(xlsx)).toBe('TOO_MANY_ROWS');
    expect(await prisma().phImportBatch.count()).toBe(0);

    // Over 5 MB is refused before it is read.
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0x61);
    expect(await preview(owner, { restaurantId: a.id }, { fileName: 'big.csv', fileBase64: b64(big) })).toMatchObject({
      ok: false,
      error: { code: 'INVALID', message: 'Use a file of at most 5 MB' },
    });
  }, 60_000);

  it('5,000 rows preview in at most 10 seconds on the test database', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    // A catalog to compare against, so the existing-product and barcode lookups do real work.
    dataOf(await act(owner, productActions.create, panadol(a.id, { barcodes: [{ code: ean13(17), level: 1 }] })));
    const file = csvFile(Array.from({ length: 5_000 }, (_, i) => drug(i + 1)));

    const started = performance.now();
    const result = dataOf(await preview(owner, { restaurantId: a.id }, file));
    const elapsed = performance.now() - started;
    expect(result.summary).toMatchObject({ rows: 5_000, ok: 4_999, errors: 1 });
    expect(await prisma().phImportRow.count({ where: { batchId: result.batchId } })).toBe(5_000);
    expect(elapsed).toBeLessThan(10_000);
  }, 60_000);

  it('a cashier cannot preview an import', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [a.branchId]] });
    const file = csvFile([drug(1)]);

    expect(codeOf(await preview(cashier, { restaurantId: a.id }, file))).toBe('FORBIDDEN');
    expect(await prisma().phImportBatch.count()).toBe(0);

    // Nor apply one the owner previewed; a support actor runs no import either.
    const pre = dataOf(await preview(owner, { restaurantId: a.id }, file));
    expect(codeOf(await apply(cashier, { restaurantId: a.id }, { batchId: pre.batchId, batchHash: pre.batchHash, acceptWarnings: false }))).toBe('FORBIDDEN');
    const support = await person('support', { superAdmin: true });
    await grant(support, a.id, { scopes: ['catalog.read'] });
    expect(codeOf(await preview(support, { restaurantId: a.id }, csvFile([drug(2)])))).toBe('FORBIDDEN');
    expect(await prisma().phProduct.count()).toBe(0);
  });

  it('a failure halfway through apply leaves no product from that batch', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const pre = dataOf(await preview(owner, { restaurantId: a.id }, csvFile(Array.from({ length: 1_200 }, (_, i) => drug(i + 1)))));

    // After the preview, someone saves row 1,101's product by hand. The first 1,000 rows (one chunk, with their barcodes
    // and prices) are written before the second chunk meets it and is refused.
    const twin = panadol(a.id, { tradeName: 'Drug 1100', strength: '500 mg', manufacturer: 'ACME' });
    dataOf(await act(owner, productActions.create, twin));
    const input = { batchId: pre.batchId, batchHash: pre.batchHash, acceptWarnings: false };
    const failed = await apply(owner, { restaurantId: a.id }, input);
    expect(failed).toMatchObject({ ok: false, error: { code: 'CONFLICT', fields: { phCode: 'DUPLICATE_PRODUCT', rowNumber: '1101' } } });

    // All or nothing: no product, unit, barcode or price of the batch, and the claim on the batch rolled back too.
    expect((await prisma().phProduct.findMany()).map((p) => p.tradeName)).toEqual(['Drug 1100']);
    expect(await prisma().phProductUnit.count()).toBe(2);
    expect(await prisma().phBarcode.count()).toBe(0);
    expect(await prisma().phPrice.count()).toBe(0);
    expect((await prisma().phImportBatch.findUniqueOrThrow({ where: { id: pre.batchId } })).status).toBe('PREVIEWED');
    expect(await prisma().auditLog.count({ where: { action: 'ph.import.apply' } })).toBe(0);

    // Because the claim rolled back, the batch can still be applied, leaving that row out.
    expect(dataOf(await apply(owner, { restaurantId: a.id }, { ...input, excludeRowNumbers: [1101] }))).toMatchObject({ created: 1_199, excluded: 1 });
  }, 60_000);

  it('the list path writes the rows the single save writes and refuses what it refuses', async () => {
    const a = await pharmacy('A');
    const b = await pharmacy('B');
    const ownerA = await person('ownerA', { membership: [a.id, 'OWNER'] });
    const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
    const ladder = [
      { level: 0, label: 'tablet', baseQty: 1, sellable: true },
      { level: 1, label: 'strip', baseQty: 10, sellable: false },
      { level: 2, label: 'box', baseQty: 30, sellable: true },
    ];
    const fields = (restaurantId: string, branchId: string) => ({
      tradeName: 'Panadol Extra',
      genericName: 'Paracetamol',
      activeIngredient: 'Paracetamol, caffeine',
      strength: '500 mg / 65 mg',
      form: 'tablet',
      manufacturer: 'GSK',
      rxLevel: 'RX' as const,
      levels: ladder,
      barcodes: [
        { code: ean13(1), level: 2 },
        { code: ' ٠٠١٢٣٤ ', level: 1 },
      ],
      branchSettings: [{ branchId, minQty: 5, reorderQty: 9 }],
      restaurantId,
    });

    // A: the single save and the single price, through their actions.
    const single = dataOf(await act(ownerA, productActions.create, fields(a.id, a.branchId)));
    const boxA = await prisma().phProductUnit.findFirstOrThrow({ where: { productId: single.id, level: 2 } });
    dataOf(await act(ownerA, priceActions.set, { restaurantId: a.id, productId: single.id, unitId: boxA.id, currency: 'IQD', amount: '1,250', validFrom: NOW, reason: 'import x' }));
    // B: the list forms, in one transaction on B's scoped client.
    const phB = (await asPh(ownerB.userId, b.id))!;
    const scopedB = phScopedClient(prisma(), phB);
    const [listed] = await scopedB.$transaction(async (tx) => {
      const written = await createProducts(tx, b.id, [productInput.parse(fields(b.id, b.branchId))]);
      await setFirstPrices(tx, phB, [{ productId: written[0]!.id, unitId: written[0]!.unitIds[2]!, currency: 'IQD', amount: '1250', validFrom: NOW, reason: 'import x' }]);
      return written;
    });

    const rowsOf = async (productId: string) => {
      const product = await prisma().phProduct.findUniqueOrThrow({ where: { id: productId }, include: { units: { orderBy: { level: 'asc' } } } });
      const levelOf = new Map(product.units.map((u) => [u.id, u.level]));
      const { units, ...row } = product;
      const same = Object.fromEntries(Object.entries(row).filter(([key]) => !['id', 'restaurantId', 'createdAt', 'updatedAt'].includes(key)));
      return {
        product: same,
        units: units.map((u) => [u.level, u.label, u.baseQty, u.sellable]),
        barcodes: (await prisma().phBarcode.findMany({ where: { productId }, orderBy: { code: 'asc' } })).map((x) => [x.code, x.shared, levelOf.get(x.unitId)]),
        settings: (await prisma().phProductBranch.findMany({ where: { productId } })).map((s) => [s.minQty, s.reorderQty]),
        prices: (await prisma().phPrice.findMany({ where: { productId } })).map((p) => [levelOf.get(p.unitId), p.branchId, p.currency, p.amountMinor, p.validFrom.toISOString(), p.validTo, p.reason]),
      };
    };
    expect(await rowsOf(listed!.id)).toEqual(await rowsOf(single.id));

    // The same refusals, from the same checks: a bad ladder, a product already in the catalog, a barcode held by another.
    const phA = (await asPh(ownerA.userId, a.id))!;
    const scopedA = phScopedClient(prisma(), phA);
    const refusalOf = async (work: (tx: Parameters<Parameters<typeof scopedA.$transaction>[0]>[0]) => Promise<unknown>) => {
      try {
        await scopedA.$transaction(work);
      } catch (error) {
        const refusal = error instanceof ListEntryError ? error.refusal : error;
        return { code: (refusal as { code?: unknown }).code, message: (refusal as Error).message, fields: (refusal as { fields?: unknown }).fields };
      }
      throw new Error('expected a refusal');
    };
    const bad = [
      { ...fields(a.id, a.branchId), tradeName: 'Ladder', barcodes: [], levels: [{ level: 0, label: 'tablet', baseQty: 2, sellable: true }] },
      { ...fields(a.id, a.branchId), barcodes: [] },
      { ...fields(a.id, a.branchId), tradeName: 'Other', barcodes: [{ code: ean13(1), level: 0 }] },
    ].map((input) => productInput.parse(input));
    for (const input of bad) {
      const one = await refusalOf((tx) => createProduct(tx, a.id, input));
      const list = await refusalOf((tx) => createProducts(tx, a.id, [input]));
      expect(list).toEqual(one);
      expect(one.code).not.toBeUndefined();
    }
  });

  it('min qty is written only when exactly one branch is in scope', async () => {
    const a = await pharmacy('A', { branches: 2 });
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });

    // All branches: the minimum is not the person's to spread, so it is left out and each row says so.
    const wide = dataOf(await preview(owner, { restaurantId: a.id }, csvFile([drug(1, { min: '10' })])));
    expect(wide.firstRowsWithIssues[0]!.issues).toEqual([expect.objectContaining({ code: 'MIN_QTY_IGNORED', field: 'minQty', severity: 'info' })]);
    expect(wide.summary).toMatchObject({ ok: 1 });
    dataOf(await apply(owner, { restaurantId: a.id }, { batchId: wide.batchId, batchHash: wide.batchHash, acceptWarnings: false }));
    expect(await prisma().phProductBranch.count()).toBe(0);

    // The chosen branch: written there.
    const one = dataOf(await preview(owner, { restaurantId: a.id, branchId: a.branchIds[1] }, csvFile([drug(2, { min: '12' })], 'b.csv')));
    dataOf(await apply(owner, { restaurantId: a.id, branchId: a.branchIds[1] }, { batchId: one.batchId, batchHash: one.batchHash, acceptWarnings: false }));
    expect((await prisma().phProductBranch.findMany()).map((s) => [s.branchId, s.minQty])).toEqual([[a.branchIds[1], 12]]);

    // A stock keeper of one branch, who may not change prices: min qty goes to their branch, the price is left out.
    const stock = await person('stock', { staff: [a.id, 'STOCK', [a.branchIds[0]]] });
    const theirs = dataOf(await preview(stock, { restaurantId: a.id }, csvFile([drug(3, { min: '7' })], 'c.csv')));
    expect(theirs.firstRowsWithIssues[0]!.issues.map((i) => i.code)).toEqual(['PRICE_IGNORED']);
    expect(dataOf(await apply(stock, { restaurantId: a.id }, { batchId: theirs.batchId, batchHash: theirs.batchHash, acceptWarnings: false }))).toMatchObject({
      created: 1,
      prices: 0,
    });
    const product = await prisma().phProduct.findFirstOrThrow({ where: { tradeName: 'Drug 3' } });
    expect((await prisma().phProductBranch.findMany({ where: { productId: product.id } })).map((s) => [s.branchId, s.minQty])).toEqual([[a.branchIds[0], 7]]);
    expect(await prisma().phPrice.count({ where: { productId: product.id } })).toBe(0);
  });

  it('applies 1,000 rows in one transaction', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const pre = dataOf(await preview(owner, { restaurantId: a.id }, csvFile(Array.from({ length: 1_000 }, (_, i) => drug(i + 1)))));
    const done = dataOf(await apply(owner, { restaurantId: a.id }, { batchId: pre.batchId, batchHash: pre.batchHash, acceptWarnings: false }));
    expect(done).toMatchObject({ created: 1_000, prices: 1_000 });
    expect(await prisma().phProduct.count()).toBe(1_000);
    expect(await prisma().phBarcode.count()).toBe(1_000);
  }, 120_000);
});

describe('pharmacy product export', () => {
  it('export works for a readOnly pharmacy and is refused for an archived one', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    dataOf(await act(owner, productActions.create, panadol(a.id)));
    // The subscription lapsed: past its grace, inside the retention window.
    await prisma().subscription.updateMany({ where: { restaurantId: a.id }, data: { currentPeriodEnd: new Date(NOW.getTime() - 8 * DAY) } });

    const result = await exported(owner, { restaurantId: a.id });
    const { sheet } = await sheetOf(result);
    expect(sheet.rows.map((r) => r[0])).toEqual(['Panadol']);
    expect(dataOf(result)).toMatchObject({ fileName: expect.stringMatching(/\.csv$/), contentType: 'text/csv', rows: 1 });
    // Reading and exporting only: an import is refused while read-only.
    expect(codeOf(await preview(owner, { restaurantId: a.id }, csvFile([drug(1)])))).toBe('FORBIDDEN');

    // Past the retention window: archived, and closed to exports too.
    await prisma().subscription.updateMany({ where: { restaurantId: a.id }, data: { currentPeriodEnd: new Date(NOW.getTime() - 98 * DAY) } });
    expect(codeOf(await exported(owner, { restaurantId: a.id }))).toBe('FORBIDDEN');
  });

  it('export omits cost for a cashier', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [a.branchId]] });
    dataOf(await act(owner, productActions.create, panadol(a.id)));

    const forCashier = (await sheetOf(await exported(cashier, { restaurantId: a.id }))).sheet;
    expect(forCashier.headers).not.toContain('lastPurchaseCost');
    expect(forCashier.headers.some((h) => /cost/i.test(h))).toBe(false);
    const forOwner = (await sheetOf(await exported(owner, { restaurantId: a.id }))).sheet;
    expect(forOwner.headers).toEqual(expect.arrayContaining(['lastPurchaseCost', 'costCurrency']));

    // A support actor reads it through the audited query framework, without cost either.
    const support = await person('support', { superAdmin: true });
    await grant(support, a.id, { scopes: ['catalog.read'] });
    const forSupport = (await sheetOf(await exported(support, { restaurantId: a.id }))).sheet;
    expect(forSupport.headers.some((h) => /cost/i.test(h))).toBe(false);
    expect(await prisma().auditLog.count({ where: { action: 'support.read', restaurantId: a.id } })).toBe(1);
  });

  it('export writes what a re-import reads, escapes formulas and opens Arabic in Excel', async () => {
    const a = await pharmacy('A', { branches: 2 });
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const manager = await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [a.branchIds[0]]] });
    const created = dataOf(
      await act(
        owner,
        productActions.create,
        panadol(a.id, {
          tradeName: '=HYPERLINK("http://x")',
          genericName: 'باراسيتامول',
          manufacturer: '@SUM(A1)',
          strength: '-5',
          form: '+tab',
          barcodes: [{ code: ean13(9), level: 1 }],
          branchSettings: [
            { branchId: a.branchIds[0], minQty: 30, reorderQty: 0 },
            { branchId: a.branchIds[1], minQty: 40, reorderQty: 0 },
          ],
        }),
      ),
    );
    const unit = await prisma().phProductUnit.findFirstOrThrow({ where: { productId: created.id, level: 1 } });
    await prisma().phPrice.create({
      data: { restaurantId: a.id, productId: created.id, unitId: unit.id, currency: 'IQD', amountMinor: 1500n, validFrom: new Date(NOW.getTime() - DAY), reason: 'set', changedById: owner.userId },
    });

    const { bytes, sheet } = await sheetOf(await exported(owner, { restaurantId: a.id }));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const row = Object.fromEntries(sheet.headers.map((h, i) => [h, sheet.rows[0]![i]]));
    expect(row).toMatchObject({
      tradeName: `'=HYPERLINK("http://x")`,
      genericName: 'باراسيتامول',
      manufacturer: "'@SUM(A1)",
      strength: "'-5",
      form: "'+tab",
      rxLevel: 'OTC',
      packLabel: 'box',
      unitsPerPack: '20',
      barcode: ean13(9),
      salePrice: '1500',
      currency: 'IQD',
      active: 'yes',
    });
    // Two branches in view: one min qty column each, named by branch.
    expect(row['minQty A branch 1']).toBe('30');
    expect(row['minQty A branch 2']).toBe('40');

    // A manager of one branch sees only that branch's minimum.
    const forManager = (await sheetOf(await exported(manager, { restaurantId: a.id }))).sheet;
    expect(forManager.headers).toContain('minQty');
    expect(forManager.headers.filter((h) => h.startsWith('minQty'))).toEqual(['minQty']);
    expect(forManager.rows[0]![forManager.headers.indexOf('minQty')]).toBe('30');

    // The XLSX carries the same cells.
    const xlsx = await sheetOf(await exported(owner, { restaurantId: a.id }, 'xlsx'));
    expect(xlsx.sheet.rows[0]![xlsx.sheet.headers.indexOf('tradeName')]).toBe(`'=HYPERLINK("http://x")`);

    // The headers are the import's own columns, so the file maps itself.
    const { suggestMapping } = await import('@/server/domain/pharmacy/import-products');
    expect(suggestMapping(forManager.headers)).toMatchObject({ tradeName: 'tradeName', rxLevel: 'rxLevel', packLabel: 'packLabel', unitsPerPack: 'unitsPerPack', barcode: 'barcode', salePrice: 'salePrice', minQty: 'minQty' });
  });

  it('an export above the most rows is refused with a clear code', async () => {
    expect(PH_EXPORT_MAX_ROWS).toBe(50_000);
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    for (const name of ['One', 'Two', 'Three']) dataOf(await act(owner, productActions.create, panadol(a.id, { tradeName: name })));
    const ph = (await asPh(owner.userId, a.id))!;
    await expect(exportProducts(phScopedClient(prisma(), ph), ph, { format: 'csv', active: 'all' }, { maxRows: 2 })).rejects.toMatchObject({
      code: 'INVALID',
      fields: { phCode: 'EXPORT_TOO_LARGE' },
    });
    await expect(exportProducts(phScopedClient(prisma(), ph), ph, { format: 'csv', active: 'all' }, { maxRows: 3 })).resolves.toMatchObject({ rows: 3 });
  });
});

/** Measurements for the report (PH_IMPORT_PERF=1): apply of 1,000 and 10,000 rows in one transaction. */
describe.runIf(process.env.PH_IMPORT_PERF === '1')('pharmacy import timing', () => {
  for (const size of [1_000, 10_000]) {
    it(`applies ${size} rows`, async () => {
      const a = await pharmacy('A');
      const owner = await person('owner', { membership: [a.id, 'OWNER'] });
      const file = csvFile(Array.from({ length: size }, (_, i) => drug(i + 1)));
      const t0 = performance.now();
      const pre = dataOf(await preview(owner, { restaurantId: a.id }, file));
      const t1 = performance.now();
      const done = dataOf(await apply(owner, { restaurantId: a.id }, { batchId: pre.batchId, batchHash: pre.batchHash, acceptWarnings: false }));
      const t2 = performance.now();
      console.log(`[perf] ${size} rows: preview ${Math.round(t1 - t0)} ms, apply ${Math.round(t2 - t1)} ms`);
      expect(done.created).toBe(size);
    }, 600_000);
  }
});
