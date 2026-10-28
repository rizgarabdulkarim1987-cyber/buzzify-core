import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
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

type Biz = Awaited<ReturnType<typeof pharmacy>>;
type World = Awaited<ReturnType<typeof world>>;
type Data = Record<string, unknown>;

let seq = 0;
const next = () => (seq += 1);
const hex = (n: number) => n.toString(16).padStart(64, '0');

/** A business with a product and its base unit, a supplier, a draft receipt, and an open intake batch. */
async function world(name = 'A') {
  const biz = await pharmacy(name);
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
  const supplier = await prisma().phSupplier.create({
    data: { restaurantId: biz.id, name: `Supplier ${name}`, nameKey: `supplier ${name}`, defaultCurrency: 'IQD', clientKey: `sup-${next()}`, createdById: 'u1' },
    select: { id: true },
  });
  const w0 = { biz, productId: product.id, unitId: unit.id, supplierId: supplier.id };
  const batch = await batchOf(w0, {});
  const file = await fileOf({ biz }, batch.id, {});
  return { ...w0, batchId: batch.id, fileId: file.id };
}

const batchOf = (w: { biz: Biz }, over: Data) =>
  prisma().phIntakeBatch.create({
    data: { restaurantId: w.biz.id, branchId: w.biz.branchId, clientKey: `ib-${next()}`, payloadHash: `h-${next()}`, createdById: 'u1', ...over } as never,
    select: { id: true },
  });

const fileOf = (w: { biz: Biz }, batchId: string, over: Data) =>
  prisma().phIntakeFile.create({
    data: {
      restaurantId: w.biz.id,
      batchId,
      sha256: hex(next()),
      mediaType: 'image/jpeg',
      bytes: 1000,
      pages: 1,
      expiresAt: new Date('2026-11-30T00:00:00.000Z'),
      uploadedById: 'u1',
      ...over,
    } as never,
    select: { id: true },
  });

const rowOf = (w: World, fileId: string, over: Data) =>
  prisma().phIntakeRow.create({
    data: { restaurantId: w.biz.id, fileId, lineNo: next(), page: 1, extracted: { name: 'Panadol' }, ...over } as never,
    select: { id: true },
  });

const receiptOf = (w: { biz: Biz }) =>
  prisma().phReceipt.create({
    data: { restaurantId: w.biz.id, branchId: w.biz.branchId, clientKey: `rc-${next()}`, receivedOn: new Date('2026-10-30T00:00:00.000Z'), createdById: 'u1' },
    select: { id: true },
  });

const usageOf = (w: { biz: Biz }, over: Data = {}) =>
  prisma().phAiUsageMonth.create({ data: { restaurantId: w.biz.id, month: '2026-10', ...over } as never, select: { id: true } });

const callOf = (w: { biz: Biz }, over: Data = {}) =>
  prisma().phAiCall.create({ data: { restaurantId: w.biz.id, purpose: 'invoice', model: 'm1', status: 'OK', ...over } as never, select: { id: true } });

describe('the intake batch', () => {
  it('starts open with an empty header, and one clientKey is one batch per business', async () => {
    const w = await world();
    const made = await prisma().phIntakeBatch.findUniqueOrThrow({ where: { id: w.batchId } });
    expect(made.status).toBe('OPEN');
    expect(made.header).toEqual({});
    expect(made.version).toBe(1);
    const dup = await prisma().phIntakeBatch.findUniqueOrThrow({ where: { id: w.batchId } });
    await expect(batchOf(w, { clientKey: dup.clientKey })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('is approved only with a receipt and an approval time', async () => {
    const w = await world();
    const receipt = await receiptOf(w);
    await expect(batchOf(w, { status: 'APPROVED' })).rejects.toThrow(/PhIntakeBatch_approved_needs_receipt/);
    await expect(batchOf(w, { status: 'APPROVED', receiptId: receipt.id })).rejects.toThrow(/PhIntakeBatch_approved_needs_receipt/);
    await expect(batchOf(w, { status: 'APPROVED', approvedAt: new Date() })).rejects.toThrow(/PhIntakeBatch_approved_needs_receipt/);
    await expect(batchOf(w, { status: 'APPROVED', receiptId: receipt.id, approvedAt: new Date(), approvedById: 'u1' })).resolves.toHaveProperty('id');
    // an open or cancelled batch may carry neither
    await expect(batchOf(w, { status: 'CANCELLED', cancelledAt: new Date() })).resolves.toHaveProperty('id');
  });

  it('is the only batch of its receipt', async () => {
    const w = await world();
    const receipt = await receiptOf(w);
    await batchOf(w, { receiptId: receipt.id });
    await expect(batchOf(w, { receiptId: receipt.id })).rejects.toMatchObject({ code: 'P2002' });
    // batches without a receipt are many
    await expect(batchOf(w, {})).resolves.toHaveProperty('id');
  });

  it('refuses a supplier, a receipt or a branch of another business', async () => {
    const a = await world('A');
    const b = await world('B');
    await expect(batchOf(a, { supplierId: b.supplierId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(batchOf(a, { receiptId: (await receiptOf(b)).id })).rejects.toMatchObject({ code: 'P2003' });
    await expect(batchOf(a, { branchId: b.biz.branchId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(batchOf(a, { supplierId: a.supplierId })).resolves.toHaveProperty('id');
  });
});

describe('the intake file', () => {
  it('has a sha256 of 64 lower-case hex characters', async () => {
    const w = await world();
    await expect(fileOf(w, w.batchId, { sha256: 'a'.repeat(63) })).rejects.toThrow(/PhIntakeFile_sha256_format/);
    await expect(fileOf(w, w.batchId, { sha256: 'a'.repeat(65) })).rejects.toThrow(/PhIntakeFile_sha256_format/);
    await expect(fileOf(w, w.batchId, { sha256: 'G'.repeat(64) })).rejects.toThrow(/PhIntakeFile_sha256_format/);
    await expect(fileOf(w, w.batchId, { sha256: 'A'.repeat(64) })).rejects.toThrow(/PhIntakeFile_sha256_format/);
    await expect(fileOf(w, w.batchId, { sha256: 'a'.repeat(64) })).resolves.toHaveProperty('id');
  });

  it('is one of the four media types', async () => {
    const w = await world();
    for (const mediaType of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
      await expect(fileOf(w, w.batchId, { mediaType }), mediaType).resolves.toHaveProperty('id');
    }
    for (const mediaType of ['image/gif', 'text/html', 'application/zip', '']) {
      await expect(fileOf(w, w.batchId, { mediaType }), mediaType).rejects.toThrow(/PhIntakeFile_mediaType_allowed/);
    }
  });

  it('is 1 byte to 8 MiB', async () => {
    const w = await world();
    await expect(fileOf(w, w.batchId, { bytes: 0 })).rejects.toThrow(/PhIntakeFile_bytes_range/);
    await expect(fileOf(w, w.batchId, { bytes: 8_388_609 })).rejects.toThrow(/PhIntakeFile_bytes_range/);
    await expect(fileOf(w, w.batchId, { bytes: 1 })).resolves.toHaveProperty('id');
    await expect(fileOf(w, w.batchId, { bytes: 8_388_608 })).resolves.toHaveProperty('id');
  });

  it('is 1 to 10 pages', async () => {
    const w = await world();
    await expect(fileOf(w, w.batchId, { pages: 0 })).rejects.toThrow(/PhIntakeFile_pages_range/);
    await expect(fileOf(w, w.batchId, { pages: 11 })).rejects.toThrow(/PhIntakeFile_pages_range/);
    await expect(fileOf(w, w.batchId, { pages: 1 })).resolves.toHaveProperty('id');
    await expect(fileOf(w, w.batchId, { pages: 10 })).resolves.toHaveProperty('id');
  });

  it('has a count of attempts that is not negative', async () => {
    const w = await world();
    await expect(fileOf(w, w.batchId, { attempts: -1 })).rejects.toThrow(/PhIntakeFile_attempts_not_negative/);
    await expect(fileOf(w, w.batchId, { attempts: 0 })).resolves.toHaveProperty('id');
  });

  it('is purged only once its storage key is gone', async () => {
    const w = await world();
    await expect(fileOf(w, w.batchId, { status: 'PURGED', storageKey: 'k/1' })).rejects.toThrow(/PhIntakeFile_purged_no_key/);
    await expect(fileOf(w, w.batchId, { status: 'PURGED', storageKey: null })).resolves.toHaveProperty('id');
    await expect(fileOf(w, w.batchId, { status: 'EXTRACTED', storageKey: 'k/2' })).resolves.toHaveProperty('id');
    await expect(prisma().phIntakeFile.update({ where: { id: w.fileId }, data: { storageKey: 'k/3' } })).resolves.toHaveProperty('storageKey', 'k/3');
    await expect(prisma().phIntakeFile.update({ where: { id: w.fileId }, data: { status: 'PURGED' } })).rejects.toThrow(/PhIntakeFile_purged_no_key/);
    await expect(prisma().phIntakeFile.update({ where: { id: w.fileId }, data: { status: 'PURGED', storageKey: null } })).resolves.toHaveProperty('status', 'PURGED');
  });

  it('has a failure code only when it failed or was rejected for quality', async () => {
    const w = await world();
    for (const status of ['UPLOADED', 'EXTRACTING', 'EXTRACTED', 'PURGED']) {
      await expect(fileOf(w, w.batchId, { status, failureCode: 'X' }), status).rejects.toThrow(/PhIntakeFile_failureCode_when_failed/);
    }
    for (const status of ['FAILED', 'REJECTED_QUALITY']) {
      await expect(fileOf(w, w.batchId, { status, failureCode: 'X' }), status).resolves.toHaveProperty('id');
    }
    await expect(fileOf(w, w.batchId, { status: 'FAILED' })).resolves.toHaveProperty('id');
  });

  it('is one per sha256 per business: the same bytes in another business are another file', async () => {
    const a = await world('A');
    const b = await world('B');
    const sha256 = 'c'.repeat(64);
    await fileOf(a, a.batchId, { sha256 });
    await expect(fileOf(a, a.batchId, { sha256 })).rejects.toMatchObject({ code: 'P2002' });
    // even in another batch of the same business
    await expect(fileOf(a, (await batchOf(a, {})).id, { sha256 })).rejects.toMatchObject({ code: 'P2002' });
    await expect(fileOf(b, b.batchId, { sha256 })).resolves.toHaveProperty('id');
  });

  it('refuses a batch of another business', async () => {
    const a = await world('A');
    const b = await world('B');
    await expect(fileOf(a, b.batchId, {})).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the intake row', () => {
  it('is numbered once per file, from 1, on a page from 1', async () => {
    const w = await world();
    await expect(rowOf(w, w.fileId, { lineNo: 0 })).rejects.toThrow(/PhIntakeRow_lineNo_positive/);
    await expect(rowOf(w, w.fileId, { lineNo: 1 })).resolves.toHaveProperty('id');
    await expect(rowOf(w, w.fileId, { lineNo: 1 })).rejects.toMatchObject({ code: 'P2002' });
    await expect(rowOf(w, w.fileId, { page: 0 })).rejects.toThrow(/PhIntakeRow_page_positive/);
    await expect(rowOf(w, w.fileId, { page: 1 })).resolves.toHaveProperty('id');
    // another file may reuse a number
    const other = await fileOf(w, w.batchId, {});
    await expect(rowOf(w, other.id, { lineNo: 1 })).resolves.toHaveProperty('id');
  });

  it('matches a product and a unit together, or neither', async () => {
    const w = await world();
    await expect(rowOf(w, w.fileId, { matchedProductId: w.productId })).rejects.toThrow(/PhIntakeRow_match_together/);
    await expect(rowOf(w, w.fileId, { matchedUnitId: w.unitId })).rejects.toThrow(/PhIntakeRow_match_together/);
    await expect(rowOf(w, w.fileId, { matchedProductId: w.productId, matchedUnitId: w.unitId })).resolves.toHaveProperty('id');
    const bare = await rowOf(w, w.fileId, {});
    const stored = await prisma().phIntakeRow.findUniqueOrThrow({ where: { id: bare.id } });
    expect(stored.edited).toEqual({});
    expect(stored.flags).toEqual([]);
    expect(stored.reviewed).toBe(false);
    expect(stored.note).toBeNull();
  });

  it('keeps a note of 500 characters at most', async () => {
    const w = await world();
    await expect(rowOf(w, w.fileId, { note: 'x'.repeat(501) })).rejects.toThrow(/PhIntakeRow_note_length/);
    await expect(rowOf(w, w.fileId, { note: 'x'.repeat(500) })).resolves.toHaveProperty('id');
  });

  it('refuses a file, a product or a unit of another business', async () => {
    const a = await world('A');
    const b = await world('B');
    await expect(rowOf(a, b.fileId, {})).rejects.toMatchObject({ code: 'P2003' });
    await expect(rowOf(a, a.fileId, { matchedProductId: b.productId, matchedUnitId: b.unitId })).rejects.toMatchObject({ code: 'P2003' });
    // a unit of another product
    await expect(rowOf(a, a.fileId, { matchedProductId: a.productId, matchedUnitId: b.unitId })).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the monthly AI usage', () => {
  it('is a month as YYYY-MM', async () => {
    const w = await world();
    for (const month of ['2026-1', '26-10', '2026-13', '2026-00', '2026/10', '2026-10-01', '']) {
      await expect(usageOf(w, { month }), month).rejects.toThrow(/PhAiUsageMonth_month_format/);
    }
    await expect(usageOf(w, { month: '2026-12' })).resolves.toHaveProperty('id');
  });

  it('is one row per business and month, starting at zero', async () => {
    const a = await world('A');
    const b = await world('B');
    const made = await usageOf(a);
    const row = await prisma().phAiUsageMonth.findUniqueOrThrow({ where: { id: made.id } });
    expect([row.spentMicroUsd, row.reservedMicroUsd, row.inputTokens, row.outputTokens]).toEqual([0n, 0n, 0n, 0n]);
    expect(row.calls).toBe(0);
    await expect(usageOf(a)).rejects.toMatchObject({ code: 'P2002' });
    await expect(usageOf(b)).resolves.toHaveProperty('id');
  });

  it('never goes below zero', async () => {
    const w = await world();
    for (const field of ['spentMicroUsd', 'reservedMicroUsd', 'inputTokens', 'outputTokens']) {
      await expect(usageOf(w, { month: '2026-09', [field]: -1n }), field).rejects.toThrow(/PhAiUsageMonth_not_negative/);
    }
    await expect(usageOf(w, { month: '2026-09', calls: -1 })).rejects.toThrow(/PhAiUsageMonth_not_negative/);
    const ok = await usageOf(w, { month: '2026-08', spentMicroUsd: 0n, reservedMicroUsd: 0n, calls: 0 });
    await expect(prisma().phAiUsageMonth.update({ where: { id: ok.id }, data: { reservedMicroUsd: { decrement: 1n } } })).rejects.toThrow(/PhAiUsageMonth_not_negative/);
    await expect(prisma().phAiUsageMonth.update({ where: { id: ok.id }, data: { spentMicroUsd: { increment: 5n } } })).resolves.toHaveProperty('spentMicroUsd', 5n);
  });
});

describe('the AI call log', () => {
  it('records metadata only and is one of four statuses', async () => {
    const w = await world();
    for (const status of ['OK', 'ERROR', 'BUDGET', 'TIMEOUT']) {
      await expect(callOf(w, { status }), status).resolves.toHaveProperty('id');
    }
    await expect(callOf(w, { status: 'PENDING' })).rejects.toThrow(/PhAiCall_status_allowed/);
    await expect(callOf(w, { status: '' })).rejects.toThrow(/PhAiCall_status_allowed/);
    // the model has no column for a prompt, an answer or an image
    expect(new Set(Object.keys(Prisma.PhAiCallScalarFieldEnum))).toEqual(
      new Set(['id', 'restaurantId', 'purpose', 'model', 'inputTokens', 'outputTokens', 'ms', 'status', 'costMicroUsd', 'fileId', 'createdAt']),
    );
  });

  it('costs nothing or more, and its counts are not negative', async () => {
    const w = await world();
    await expect(callOf(w, { costMicroUsd: -1n })).rejects.toThrow(/PhAiCall_not_negative/);
    await expect(callOf(w, { inputTokens: -1 })).rejects.toThrow(/PhAiCall_not_negative/);
    await expect(callOf(w, { outputTokens: -1 })).rejects.toThrow(/PhAiCall_not_negative/);
    await expect(callOf(w, { ms: -1 })).rejects.toThrow(/PhAiCall_not_negative/);
    await expect(callOf(w, { costMicroUsd: 0n, inputTokens: 0, outputTokens: 0, ms: 0 })).resolves.toHaveProperty('id');
  });

  it('keeps its file id after the file is gone (plain text, no foreign key)', async () => {
    const w = await world();
    await expect(callOf(w, { fileId: 'a-file-that-was-purged' })).resolves.toHaveProperty('id');
  });

  it('is append-only: no UPDATE, no DELETE', async () => {
    const w = await world();
    const made = await callOf(w);
    await expect(prisma().phAiCall.update({ where: { id: made.id }, data: { costMicroUsd: 1n } })).rejects.toThrow(/PhAiCall is append-only: UPDATE refused/);
    await expect(prisma().phAiCall.delete({ where: { id: made.id } })).rejects.toThrow(/PhAiCall is append-only: DELETE refused/);
    await expect(prisma().phAiCall.deleteMany({})).rejects.toThrow(/append-only/);
    expect(await prisma().phAiCall.count()).toBe(1);
  });
});

describe('removing a whole business', () => {
  it('removes its intake rows and AI log too, append-only table included, and nothing of another business', async () => {
    const a = await world('A');
    const b = await world('B');
    for (const w of [a, b]) {
      await rowOf(w, w.fileId, {});
      await usageOf(w);
      await callOf(w);
    }
    await prisma().subscription.deleteMany({ where: { restaurantId: a.biz.id } });
    await prisma().restaurant.delete({ where: { id: a.biz.id } });
    const where = { restaurantId: a.biz.id };
    expect(await prisma().phIntakeBatch.count({ where })).toBe(0);
    expect(await prisma().phIntakeFile.count({ where })).toBe(0);
    expect(await prisma().phIntakeRow.count({ where })).toBe(0);
    expect(await prisma().phAiUsageMonth.count({ where })).toBe(0);
    expect(await prisma().phAiCall.count({ where })).toBe(0);
    expect(await prisma().phIntakeRow.count({ where: { restaurantId: b.biz.id } })).toBe(1);
    expect(await prisma().phAiCall.count({ where: { restaurantId: b.biz.id } })).toBe(1);
  });
});

describe('the tenant registries', () => {
  const RESTAURANT_MODELS = ['PhIntakeBatch', 'PhIntakeFile', 'PhIntakeRow', 'PhAiUsageMonth', 'PhAiCall'];

  it('scopes every intake model by restaurant', () => {
    for (const model of RESTAURANT_MODELS) expect(RESTAURANT_SCOPED_MODELS as readonly string[], model).toContain(model);
  });

  it('confines the batch to the branches of the caller, and nothing else of this phase', () => {
    expect(PHARMACY_BRANCH_SCOPED_MODELS).toContain('PhIntakeBatch');
    // files and rows are reached through their batch; usage and calls are business-wide
    for (const model of RESTAURANT_MODELS.filter((m) => m !== 'PhIntakeBatch')) {
      expect(PHARMACY_BRANCH_SCOPED_MODELS, model).not.toContain(model);
    }
  });
});
