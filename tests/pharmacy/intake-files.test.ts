import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhRole } from '@/server/domain/pharmacy/permissions';
import * as intakeActions from '@/server/pharmacy/actions/intake';
import { purgeExpiredIntakeFiles } from '@/server/pharmacy/intake/files';
import { withIntakeStorage } from '@/server/pharmacy/intake/storage';
import * as intakeQueries from '@/server/pharmacy/queries/intake';
import { DAY, grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { memoryIntakeStorage, pageImage, pdfWithPages } from './intake-helpers';
import { act, ask, codeOf, dataOf, phCodeOf } from './stock-helpers';

let keySeq = 0;
const key = () => `intake-key-${(keySeq += 1)}-aaaa`;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const MB = 1024 * 1024;

let storage: ReturnType<typeof memoryIntakeStorage>;
let restore: () => void;

async function world(storageMb = 50) {
  const a = await pharmacy('A', { branches: 2 });
  await prisma().appPlan.create({
    data: { applicationId: 'pharmacy', code: 'standard', name: { en: 'Standard' }, limits: { branches: 5, users: 20, storageMb, aiMonthlyBudgetMinor: 1000 } },
  });
  const [b1, b2] = a.branchIds as [string, string];
  const staff = async (label: string, role: PhRole, branches = [b1]) => person(label, { staff: [a.id, role, branches] });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const pic = await staff('pic', 'PHARMACIST_IN_CHARGE');
  const manager = await staff('manager', 'BRANCH_MANAGER', [b1, b2]);
  const cashier = await staff('cashier', 'CASHIER');
  const pharmacist = await staff('pharmacist', 'PHARMACIST');
  const stock = await staff('stock', 'STOCK');
  const accountant = await staff('accountant', 'ACCOUNTANT');
  const supplier = await prisma().phSupplier.create({
    data: { restaurantId: a.id, name: 'Al-Noor', nameKey: 'al-noor', defaultCurrency: 'USD', clientKey: `sup-${(keySeq += 1)}-aaaa`, createdById: owner.userId },
    select: { id: true },
  });
  return { a, b1, b2, owner, pic, manager, cashier, pharmacist, stock, accountant, supplierId: supplier.id };
}
type World = Awaited<ReturnType<typeof world>>;

const place = (w: World, branch: 1 | 2 = 1) => ({ restaurantId: w.a.id, branchId: branch === 1 ? w.b1 : w.b2 });

async function newBatch(w: World, who: Person = w.owner, branch: 1 | 2 = 1, over: Record<string, unknown> = {}) {
  return dataOf(await act(who, intakeActions.createBatch, { ...place(w, branch), clientKey: key(), ...over }));
}

const upload = (w: World, who: Person, batchId: string, bytes: Uint8Array, over: Record<string, unknown> = {}, branch: 1 | 2 = 1) =>
  act(who, intakeActions.addFile, {
    ...place(w, branch),
    batchId,
    clientKey: key(),
    mediaType: bytes[0] === 0x25 ? 'application/pdf' : bytes[0] === 0x89 ? 'image/png' : 'image/jpeg',
    base64: Buffer.from(bytes).toString('base64'),
    ...over,
  });

const uploaded = async (w: World, who: Person, batchId: string, bytes: Uint8Array, branch: 1 | 2 = 1) => dataOf(await upload(w, who, batchId, bytes, {}, branch));

let page = 0;
const goodPage = () => pageImage({ width: 1000, height: 1400, seed: (page += 1) + 100 });
const pdf = (pages = 1, tag = '') => pdfWithPages(pages, tag || `t${(page += 1)}`);
const padded = (bytes: Buffer, size: number) => Buffer.concat([bytes, Buffer.alloc(size - bytes.length, 0x20)]);

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
afterEach(() => {
  restore();
  vi.unstubAllEnvs();
  vi.setSystemTime(NOW);
});

describe('creating an intake batch', () => {
  it('stores an OPEN batch in the validated branch and audits ids only', async () => {
    const w = await world();
    const made = dataOf(await act(w.pic, intakeActions.createBatch, { ...place(w), clientKey: key(), supplierId: w.supplierId }));
    expect(made).toMatchObject({ status: 'OPEN', branchId: w.b1, supplierId: w.supplierId, replayed: false });
    const row = await prisma().phIntakeBatch.findUniqueOrThrow({ where: { id: made.id } });
    expect(row).toMatchObject({ restaurantId: w.a.id, branchId: w.b1, supplierId: w.supplierId, status: 'OPEN', createdById: w.pic.userId, receiptId: null });
    expect(row.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    const audit = await prisma().auditLog.findMany({ where: { action: 'ph.intake.batch.create', entityId: made.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.changes).toMatchObject({ status: { after: 'OPEN' }, branchId: { after: w.b1 } });
    expect(JSON.stringify(audit[0]!.changes)).not.toContain('Al-Noor');
  });

  it('works without a supplier', async () => {
    const w = await world();
    const made = await newBatch(w, w.pic);
    expect(made.supplierId).toBeNull();
  });

  it('replays the same key and payload as the same batch, once', async () => {
    const w = await world();
    const clientKey = key();
    const first = dataOf(await act(w.pic, intakeActions.createBatch, { ...place(w), clientKey }));
    const again = dataOf(await act(w.pic, intakeActions.createBatch, { ...place(w), clientKey }));
    expect(again).toMatchObject({ id: first.id, replayed: true });
    expect(await prisma().phIntakeBatch.count({ where: { restaurantId: w.a.id } })).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'ph.intake.batch.create' } })).toBe(1);
  });

  it('refuses the same key with another payload, branch or person as CLIENT_KEY_MISMATCH', async () => {
    const w = await world();
    const clientKey = key();
    await act(w.manager, intakeActions.createBatch, { ...place(w), clientKey });
    expect(phCodeOf(await act(w.manager, intakeActions.createBatch, { ...place(w), clientKey, supplierId: w.supplierId }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.manager, intakeActions.createBatch, { ...place(w, 2), clientKey }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.owner, intakeActions.createBatch, { ...place(w), clientKey }))).toBe('CLIENT_KEY_MISMATCH');
    expect(await prisma().phIntakeBatch.count()).toBe(1);
  });

  it('makes one batch when two creates with one key run at once', async () => {
    const w = await world();
    const clientKey = key();
    const results = await Promise.all([act(w.pic, intakeActions.createBatch, { ...place(w), clientKey }), act(w.pic, intakeActions.createBatch, { ...place(w), clientKey })]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await prisma().phIntakeBatch.count({ where: { restaurantId: w.a.id } })).toBe(1);
  });

  it('treats another business’s supplier as missing', async () => {
    const w = await world();
    const b = await pharmacy('B');
    const theirs = await prisma().phSupplier.create({
      data: { restaurantId: b.id, name: 'Theirs', nameKey: 'theirs', defaultCurrency: 'IQD', clientKey: key(), createdById: w.owner.userId },
      select: { id: true },
    });
    expect(codeOf(await act(w.pic, intakeActions.createBatch, { ...place(w), clientKey: key(), supplierId: theirs.id }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.pic, intakeActions.createBatch, { ...place(w), clientKey: key(), supplierId: 'nonexistent' }))).toBe('NOT_FOUND');
    expect(await prisma().phIntakeBatch.count()).toBe(0);
  });
});

describe('who may use intake', () => {
  it('lets the pharmacist in charge, a branch manager and the owner in, and nobody else', async () => {
    const w = await world();
    for (const who of [w.pic, w.manager, w.owner]) expect((await act(who, intakeActions.createBatch, { ...place(w), clientKey: key() })).ok, who.email).toBe(true);
    // PHARMACIST has ai.use but not purchase.manage; STOCK and ACCOUNTANT have purchase.manage but not ai.use; CASHIER neither.
    for (const who of [w.cashier, w.pharmacist, w.stock, w.accountant]) expect(codeOf(await act(who, intakeActions.createBatch, { ...place(w), clientKey: key() })), who.email).toBe('FORBIDDEN');
    expect(await prisma().phIntakeBatch.count()).toBe(3);
  });

  it('applies the same matrix to uploading a file', async () => {
    const w = await world();
    const batch = await newBatch(w, w.pic);
    for (const who of [w.cashier, w.pharmacist, w.stock, w.accountant]) {
      expect(codeOf(await upload(w, who, batch.id, await goodPage())), who.email).toBe('FORBIDDEN');
    }
    expect(await prisma().phIntakeFile.count()).toBe(0);
    expect(storage.objects.size).toBe(0);
    expect((await upload(w, w.pic, batch.id, await goodPage())).ok).toBe(true);
    expect((await upload(w, w.manager, batch.id, await goodPage())).ok).toBe(true);
  });

  it('refuses a support grant holder', async () => {
    const w = await world();
    const support = await person('support', { superAdmin: true });
    await grant(support, w.a.id);
    expect((await act(support, intakeActions.createBatch, { ...place(w), clientKey: key() })).ok).toBe(false);
    const batch = await newBatch(w);
    expect((await upload(w, support, batch.id, await goodPage())).ok).toBe(false);
    expect((await ask(support, intakeQueries.fileUrl, { ...place(w), fileId: 'whatever' })).ok).toBe(false);
  });
});

describe('uploading a file', () => {
  it('stores the object privately under intake/<restaurantId>/<fileId> and the row, and audits ids and counts only', async () => {
    const w = await world();
    const batch = await newBatch(w, w.pic);
    const bytes = await goodPage();
    const done = dataOf(await upload(w, w.pic, batch.id, bytes));
    expect(done).toMatchObject({ batchId: batch.id, status: 'UPLOADED', duplicate: false, mediaType: 'image/jpeg', pages: 1, bytes: bytes.length, reasons: [] });
    expect(JSON.stringify(done)).not.toContain('intake/');
    const row = await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: done.fileId } });
    expect(row).toMatchObject({ restaurantId: w.a.id, batchId: batch.id, sha256: sha(bytes), storageKey: `intake/${w.a.id}/${done.fileId}`, mediaType: 'image/jpeg', bytes: bytes.length, pages: 1, status: 'UPLOADED', failureCode: null, uploadedById: w.pic.userId });
    expect(row.expiresAt.getTime()).toBe(NOW.getTime() + 30 * DAY);
    expect(row.quality).toMatchObject({ width: 1000, height: 1400 });
    expect([...storage.objects.keys()]).toEqual([row.storageKey]);
    expect(storage.objects.get(row.storageKey!)).toMatchObject({ mediaType: 'image/jpeg' });
    expect(Buffer.from(storage.objects.get(row.storageKey!)!.bytes).equals(bytes)).toBe(true);
    const audit = await prisma().auditLog.findMany({ where: { action: 'ph.intake.file.add', entityId: done.fileId } });
    expect(audit).toHaveLength(1);
    const text = JSON.stringify(audit[0]!.changes);
    expect(audit[0]!.changes).toMatchObject({ status: { after: 'UPLOADED' }, batchId: { after: batch.id }, bytes: { after: bytes.length }, pages: { after: 1 } });
    expect(text).not.toContain(Buffer.from(bytes).toString('base64').slice(0, 40));
    expect(text).not.toContain(row.sha256);
    expect(text).not.toContain('intake/');
  });

  it('accepts PNG, WebP and a PDF with its page count', async () => {
    const w = await world();
    const batch = await newBatch(w);
    const png = dataOf(await upload(w, w.owner, batch.id, await pageImage({ width: 1000, height: 1400, seed: 901, format: 'png' })));
    const webp = dataOf(await upload(w, w.owner, batch.id, await pageImage({ width: 1000, height: 1400, seed: 902, format: 'webp' }), { mediaType: 'image/webp' }));
    const doc = dataOf(await upload(w, w.owner, batch.id, pdf(3)));
    expect([png.mediaType, webp.mediaType, doc.mediaType]).toEqual(['image/png', 'image/webp', 'application/pdf']);
    expect([png.status, webp.status, doc.status]).toEqual(['UPLOADED', 'UPLOADED', 'UPLOADED']);
    expect(doc.pages).toBe(3);
  });

  it('never trusts the header: bytes that are not the declared type are refused as TYPE_MISMATCH', async () => {
    const w = await world();
    const batch = await newBatch(w);
    const png = await pageImage({ width: 1000, height: 1400, seed: 5, format: 'png' });
    expect(phCodeOf(await upload(w, w.owner, batch.id, png, { mediaType: 'image/jpeg' }))).toBe('TYPE_MISMATCH');
    expect(phCodeOf(await upload(w, w.owner, batch.id, Buffer.from('MZ not a pdf at all'), { mediaType: 'application/pdf' }))).toBe('TYPE_MISMATCH');
    expect(phCodeOf(await upload(w, w.owner, batch.id, Buffer.from('<html><script>alert(1)</script></html>'), { mediaType: 'image/png' }))).toBe('TYPE_MISMATCH');
    expect(phCodeOf(await upload(w, w.owner, batch.id, png, { mediaType: 'image/gif' }))).toBe('UNSUPPORTED_TYPE');
    expect(await prisma().phIntakeFile.count()).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  it('refuses an empty upload and one byte over 8 MB, and accepts exactly 8 MB', async () => {
    const w = await world();
    const batch = await newBatch(w);
    // An empty upload never gets past the input schema (it needs some base64 text).
    expect(codeOf(await upload(w, w.owner, batch.id, Buffer.alloc(0)))).toBe('INVALID');
    expect(phCodeOf(await upload(w, w.owner, batch.id, padded(pdf(1, 'big'), 8 * MB + 1)))).toBe('TOO_LARGE');
    expect(phCodeOf(await upload(w, w.owner, batch.id, padded(pdf(1, 'exact'), 8 * MB)))).toBe('OK');
    expect(await prisma().phIntakeFile.count()).toBe(1);
  });

  it('refuses a PDF whose pages cannot be counted (PDF_UNREADABLE) and one over 10 pages', async () => {
    const w = await world();
    const batch = await newBatch(w);
    expect(phCodeOf(await upload(w, w.owner, batch.id, Buffer.from('%PDF-1.4\nno page objects here\n%%EOF'), { mediaType: 'application/pdf' }))).toBe('PDF_UNREADABLE');
    expect(phCodeOf(await upload(w, w.owner, batch.id, Buffer.from('%PDF-1.5\n1 0 obj << /Type /ObjStm /N 3 >> endobj\n/Type /Page\n%%EOF'), { mediaType: 'application/pdf' }))).toBe('PDF_UNREADABLE');
    expect(phCodeOf(await upload(w, w.owner, batch.id, pdf(11)))).toBe('TOO_MANY_PAGES');
    expect((await upload(w, w.owner, batch.id, pdf(10))).ok).toBe(true);
  });

  it('refuses an image that cannot be decoded', async () => {
    const w = await world();
    const batch = await newBatch(w);
    expect(phCodeOf(await upload(w, w.owner, batch.id, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('garbage that is not a jpeg')])))).toBe('IMAGE_UNREADABLE');
    expect(await prisma().phIntakeFile.count()).toBe(0);
  });

  it('holds at most 20 files in a batch', async () => {
    const w = await world();
    const batch = await newBatch(w);
    for (let i = 0; i < 20; i += 1) dataOf(await upload(w, w.owner, batch.id, pdf(1, `n${i}`)));
    expect(phCodeOf(await upload(w, w.owner, batch.id, pdf(1, 'twenty-one')))).toBe('TOO_MANY_FILES');
    expect(await prisma().phIntakeFile.count({ where: { batchId: batch.id } })).toBe(20);
    // A different batch still takes files.
    expect((await upload(w, w.owner, (await newBatch(w)).id, pdf(1, 'other'))).ok).toBe(true);
  });

  it('counts stored bytes of the business against the plan’s storage, and refuses past it', async () => {
    const w = await world(1);
    const batch = await newBatch(w);
    expect((await upload(w, w.owner, batch.id, padded(pdf(1, 'a'), 600 * 1024))).ok).toBe(true);
    expect(phCodeOf(await upload(w, w.owner, batch.id, padded(pdf(1, 'b'), 600 * 1024)))).toBe('STORAGE_LIMIT');
    expect((await upload(w, w.owner, batch.id, padded(pdf(1, 'c'), 400 * 1024))).ok).toBe(true);
    expect(storage.objects.size).toBe(2);
  });

  it('refuses everything when the plan has no storage (0 means none)', async () => {
    const w = await world(0);
    const batch = await newBatch(w);
    expect(phCodeOf(await upload(w, w.owner, batch.id, pdf()))).toBe('STORAGE_LIMIT');
    expect(await prisma().phIntakeFile.count()).toBe(0);
  });

  it('does not count purged or rejected files as stored', async () => {
    const w = await world(1);
    const batch = await newBatch(w);
    const blurry = await sharp(await pageImage({ width: 1000, height: 1400, seed: 33 })).blur(5).jpeg({ quality: 92 }).toBuffer();
    const rejected = dataOf(await upload(w, w.owner, batch.id, blurry));
    expect(rejected.status).toBe('REJECTED_QUALITY');
    expect((await upload(w, w.owner, batch.id, padded(pdf(1, 'a'), 900 * 1024))).ok).toBe(true);
  });

  it('puts nothing in the batch of another branch, another business, or one that is not open', async () => {
    const w = await world();
    const batch2 = await newBatch(w, w.owner, 2);
    // The pharmacist in charge works in branch 1 only.
    expect(codeOf(await upload(w, w.pic, batch2.id, await goodPage(), {}, 1))).toBe('NOT_FOUND');
    // The owner sees every branch but the batch belongs to branch 2: a place of branch 1 does not reach it.
    expect(codeOf(await upload(w, w.owner, batch2.id, await goodPage(), {}, 1))).toBe('NOT_FOUND');
    expect(codeOf(await upload(w, w.owner, 'nonexistent', await goodPage()))).toBe('NOT_FOUND');
    const other = await pharmacy('Other');
    const outsider = await person('outsider', { membership: [other.id, 'OWNER'] });
    expect(codeOf(await act(outsider, intakeActions.addFile, { restaurantId: other.id, branchId: other.branchId, batchId: batch2.id, clientKey: key(), mediaType: 'application/pdf', base64: pdf().toString('base64') }))).toBe('NOT_FOUND');
    const mine = await newBatch(w);
    await prisma().phIntakeBatch.update({ where: { id: mine.id }, data: { status: 'CANCELLED', cancelledAt: NOW } });
    expect(phCodeOf(await upload(w, w.owner, mine.id, await goodPage()))).toBe('BATCH_NOT_OPEN');
    expect(await prisma().phIntakeFile.count()).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  it('survives two uploads of different files at once', async () => {
    const w = await world();
    const batch = await newBatch(w);
    const results = await Promise.all([upload(w, w.owner, batch.id, pdf(1, 'p1')), upload(w, w.owner, batch.id, pdf(1, 'p2'))]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await prisma().phIntakeFile.count({ where: { batchId: batch.id } })).toBe(2);
  });
});

describe('the same file twice (SHA-256)', () => {
  it('returns the existing file in the same batch: no second object, no second row, no second audit', async () => {
    const w = await world();
    const batch = await newBatch(w);
    const bytes = await goodPage();
    const first = await uploaded(w, w.owner, batch.id, bytes);
    const again = await uploaded(w, w.owner, batch.id, bytes);
    expect(again).toMatchObject({ fileId: first.fileId, batchId: batch.id, duplicate: true, status: 'UPLOADED' });
    expect(await prisma().phIntakeFile.count()).toBe(1);
    expect(storage.objects.size).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'ph.intake.file.add' } })).toBe(1);
  });

  it('returns the existing file for another batch of the same branch', async () => {
    const w = await world();
    const one = await newBatch(w);
    const two = await newBatch(w);
    const bytes = await goodPage();
    const first = await uploaded(w, w.owner, one.id, bytes);
    const again = await uploaded(w, w.owner, two.id, bytes);
    expect(again).toMatchObject({ fileId: first.fileId, batchId: one.id, duplicate: true });
    expect(await prisma().phIntakeFile.count()).toBe(1);
  });

  it('refuses a file that sits in another branch’s batch, without revealing which file', async () => {
    const w = await world();
    const one = await newBatch(w, w.owner, 1);
    const two = await newBatch(w, w.owner, 2);
    const bytes = await goodPage();
    const first = await uploaded(w, w.owner, one.id, bytes);
    const refused = await upload(w, w.owner, two.id, bytes, {}, 2);
    expect(phCodeOf(refused)).toBe('DUPLICATE_FILE');
    expect(JSON.stringify(refused)).not.toContain(first.fileId);
    expect(JSON.stringify(refused)).not.toContain(one.id);
    expect(await prisma().phIntakeFile.count()).toBe(1);
    expect(storage.objects.size).toBe(1);
    // The branch 1 pharmacist in charge learns the same thing about branch 2's file: nothing but the refusal.
    const theirs = await uploaded(w, w.owner, two.id, await goodPage(), 2);
    const probe = await upload(w, w.pic, (await newBatch(w, w.pic)).id, await sha256Bytes(theirs.fileId));
    expect(phCodeOf(probe)).toBe('DUPLICATE_FILE');
    expect(JSON.stringify(probe)).not.toContain(theirs.fileId);
  });

  it('rejects a poor photo once and answers a second upload of it with the first result', async () => {
    const w = await world();
    const batch = await newBatch(w);
    const blurry = await sharp(await pageImage({ width: 1000, height: 1400, seed: 44 })).blur(5).jpeg({ quality: 92 }).toBuffer();
    const first = dataOf(await upload(w, w.owner, batch.id, blurry));
    const again = dataOf(await upload(w, w.owner, batch.id, blurry));
    expect(again).toMatchObject({ fileId: first.fileId, duplicate: true, status: 'REJECTED_QUALITY' });
    expect(await prisma().phIntakeFile.count()).toBe(1);
  });

  it('keeps one row and one object when the same file is sent twice at once', async () => {
    const w = await world();
    const batch = await newBatch(w);
    const bytes = pdf(1, 'race');
    const results = await Promise.all([upload(w, w.owner, batch.id, bytes), upload(w, w.owner, batch.id, bytes)]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await prisma().phIntakeFile.count()).toBe(1);
    expect(storage.objects.size).toBe(1);
    expect(results.filter((r) => r.ok && r.data.duplicate)).toHaveLength(1);
  });
});

/** The bytes of a stored file, read back from the in-memory storage by file id. */
async function sha256Bytes(fileId: string): Promise<Buffer> {
  const row = await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: fileId }, select: { storageKey: true } });
  return Buffer.from(storage.objects.get(row.storageKey!)!.bytes);
}

describe('the quality gate', () => {
  it('rejects a blurred photo as REJECTED_QUALITY with the reasons, and stores no object at all', async () => {
    const w = await world();
    const batch = await newBatch(w, w.pic);
    const blurry = await sharp(await pageImage({ width: 1000, height: 1400, seed: 55 })).blur(5).jpeg({ quality: 92 }).toBuffer();
    const done = dataOf(await upload(w, w.pic, batch.id, blurry));
    expect(done).toMatchObject({ status: 'REJECTED_QUALITY', reasons: ['BLURRY'], duplicate: false });
    const row = await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: done.fileId } });
    expect(row).toMatchObject({ status: 'REJECTED_QUALITY', storageKey: null, failureCode: 'BLURRY', sha256: sha(blurry) });
    expect(row.quality).toMatchObject({ reasons: ['BLURRY'] });
    expect(row.quality).toHaveProperty('laplacianVariance');
    expect(storage.objects.size).toBe(0);
    expect(row.expiresAt.getTime()).toBe(NOW.getTime() + 30 * DAY);
  });

  it('joins several reasons in the failure code', async () => {
    const w = await world();
    const batch = await newBatch(w);
    const tiny = await pageImage({ width: 600, height: 800, seed: 66, ink: 20, paper: 30 });
    const done = dataOf(await upload(w, w.owner, batch.id, tiny));
    expect(done.status).toBe('REJECTED_QUALITY');
    expect(done.reasons).toEqual(expect.arrayContaining(['TOO_SMALL', 'TOO_DARK']));
    const row = await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: done.fileId } });
    expect(row.failureCode).toBe(done.reasons.join(','));
  });

  it('sends a PDF straight through without pixel metrics', async () => {
    const w = await world();
    const batch = await newBatch(w);
    const done = dataOf(await upload(w, w.owner, batch.id, pdf(2)));
    expect(done.status).toBe('UPLOADED');
    const row = await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: done.fileId } });
    expect(row.quality).toEqual({});
  });
});

describe('storage that is not set up', () => {
  it('answers INTAKE_STORAGE_NOT_CONFIGURED in production without the private bucket, and stores nothing', async () => {
    const w = await world();
    const batch = await newBatch(w);
    restore();
    vi.stubEnv('NODE_ENV', 'production');
    const result = await upload(w, w.owner, batch.id, await goodPage());
    expect(phCodeOf(result)).toBe('INTAKE_STORAGE_NOT_CONFIGURED');
    expect(await prisma().phIntakeFile.count()).toBe(0);
    restore = withIntakeStorage(storage);
  });
});

describe('seeing a stored file', () => {
  it('mints a signed URL of five minutes per request and never stores it', async () => {
    const w = await world();
    const batch = await newBatch(w, w.pic);
    const file = await uploaded(w, w.pic, batch.id, await goodPage());
    const before = await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: file.fileId } });
    const one = dataOf(await ask(w.pic, intakeQueries.fileUrl, { ...place(w), fileId: file.fileId }));
    const two = dataOf(await ask(w.pic, intakeQueries.fileUrl, { ...place(w), fileId: file.fileId }));
    expect(one.expiresInSeconds).toBe(300);
    expect(one.url).toContain(before.storageKey!);
    expect(storage.urls).toEqual([{ key: before.storageKey, ttlSeconds: 300 }, { key: before.storageKey, ttlSeconds: 300 }]);
    expect(two.url).toBeTruthy();
    const after = await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: file.fileId } });
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain('memory://');
  });

  it('lets a holder of purchase.manage see it (STOCK, ACCOUNTANT), and not a cashier or a pharmacist', async () => {
    const w = await world();
    const batch = await newBatch(w, w.pic);
    const file = await uploaded(w, w.pic, batch.id, await goodPage());
    for (const who of [w.stock, w.accountant, w.manager, w.owner]) expect((await ask(who, intakeQueries.fileUrl, { ...place(w), fileId: file.fileId })).ok, who.email).toBe(true);
    for (const who of [w.cashier, w.pharmacist]) expect(codeOf(await ask(who, intakeQueries.fileUrl, { ...place(w), fileId: file.fileId })), who.email).toBe('FORBIDDEN');
  });

  it('is NOT_FOUND for a file of another branch’s batch and of another business', async () => {
    const w = await world();
    const batch2 = await newBatch(w, w.owner, 2);
    const theirs = await uploaded(w, w.owner, batch2.id, await goodPage(), 2);
    expect(codeOf(await ask(w.pic, intakeQueries.fileUrl, { ...place(w, 1), fileId: theirs.fileId }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(w.pic, intakeQueries.fileUrl, { ...place(w, 1), fileId: 'nonexistent' }))).toBe('NOT_FOUND');
    const other = await pharmacy('Other');
    const outsider = await person('outsider', { membership: [other.id, 'OWNER'] });
    expect(codeOf(await ask(outsider, intakeQueries.fileUrl, { restaurantId: other.id, branchId: other.branchId, fileId: theirs.fileId }))).toBe('NOT_FOUND');
    expect(storage.urls).toEqual([]);
  });

  it('is NOT_FOUND once the bytes are gone (rejected for quality, or purged)', async () => {
    const w = await world();
    const batch = await newBatch(w);
    const blurry = await sharp(await pageImage({ width: 1000, height: 1400, seed: 77 })).blur(5).jpeg({ quality: 92 }).toBuffer();
    const rejected = dataOf(await upload(w, w.owner, batch.id, blurry));
    expect(codeOf(await ask(w.owner, intakeQueries.fileUrl, { ...place(w), fileId: rejected.fileId }))).toBe('NOT_FOUND');
  });
});

describe('purging expired files', () => {
  it('deletes the object, blanks the key, marks PURGED and frees the SHA slot, keeping rows', async () => {
    const w = await world();
    const batch = await newBatch(w);
    const bytes = await goodPage();
    const first = await uploaded(w, w.owner, batch.id, bytes);
    const row = await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: first.fileId } });
    await prisma().phIntakeRow.create({ data: { restaurantId: w.a.id, fileId: first.fileId, lineNo: 1, page: 1, extracted: { name: 'kept' } } });
    // Not yet expired: nothing happens.
    expect(await purgeExpiredIntakeFiles(prisma(), { now: new Date(NOW.getTime() + 29 * DAY), limit: 100, storage })).toMatchObject({ purged: 0 });
    expect(storage.objects.size).toBe(1);
    const result = await purgeExpiredIntakeFiles(prisma(), { now: new Date(NOW.getTime() + 31 * DAY), limit: 100, storage });
    expect(result).toEqual({ purged: 1, objectsDeleted: 1 });
    expect(storage.objects.size).toBe(0);
    const after = await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: first.fileId } });
    expect(after).toMatchObject({ status: 'PURGED', storageKey: null, failureCode: null, extractingSince: null });
    expect(after.sha256).toBe(sha(Buffer.from(`${row.sha256}:${first.fileId}`)));
    expect(await prisma().phIntakeRow.count({ where: { fileId: first.fileId } })).toBe(1);
    // The same bytes can be uploaded again: a new file, a new object.
    const second = await uploaded(w, w.owner, batch.id, bytes);
    expect(second.fileId).not.toBe(first.fileId);
    expect(second.duplicate).toBe(false);
    expect(storage.objects.size).toBe(1);
    // The new file expires on its own day; the first is not purged twice.
    expect(await purgeExpiredIntakeFiles(prisma(), { now: new Date(NOW.getTime() + 31 * DAY), limit: 100, storage })).toEqual({ purged: 1, objectsDeleted: 1 });
    expect(await purgeExpiredIntakeFiles(prisma(), { now: new Date(NOW.getTime() + 31 * DAY), limit: 100, storage })).toEqual({ purged: 0, objectsDeleted: 0 });
  });

  it('frees a rejected file’s slot too (no object to delete), and a file in the middle of extraction', async () => {
    const w = await world();
    const batch = await newBatch(w);
    const blurry = await sharp(await pageImage({ width: 1000, height: 1400, seed: 88 })).blur(5).jpeg({ quality: 92 }).toBuffer();
    const rejected = dataOf(await upload(w, w.owner, batch.id, blurry));
    const busy = await uploaded(w, w.owner, batch.id, pdf(1, 'busy'));
    await prisma().phIntakeFile.update({ where: { id: busy.fileId }, data: { status: 'EXTRACTING', extractingSince: NOW } });
    const result = await purgeExpiredIntakeFiles(prisma(), { now: new Date(NOW.getTime() + 31 * DAY), limit: 100, storage });
    expect(result).toEqual({ purged: 2, objectsDeleted: 1 });
    const files = await prisma().phIntakeFile.findMany({ where: { id: { in: [rejected.fileId, busy.fileId] } } });
    expect(files.every((f) => f.status === 'PURGED' && f.storageKey === null && f.extractingSince === null)).toBe(true);
  });

  it('works through every business, at most `limit` files per run', async () => {
    const w = await world();
    const b = await pharmacy('B');
    const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
    const batchA = await newBatch(w);
    const batchB = dataOf(await act(ownerB, intakeActions.createBatch, { restaurantId: b.id, branchId: b.branchId, clientKey: key() }));
    for (let i = 0; i < 2; i += 1) await uploaded(w, w.owner, batchA.id, pdf(1, `a${i}`));
    const theirs = await act(ownerB, intakeActions.addFile, { restaurantId: b.id, branchId: b.branchId, batchId: batchB.id, clientKey: key(), mediaType: 'application/pdf', base64: pdf(1, 'b0').toString('base64') });
    expect(theirs.ok).toBe(true);
    const later = new Date(NOW.getTime() + 31 * DAY);
    expect(await purgeExpiredIntakeFiles(prisma(), { now: later, limit: 2, storage })).toEqual({ purged: 2, objectsDeleted: 2 });
    expect(await purgeExpiredIntakeFiles(prisma(), { now: later, limit: 2, storage })).toEqual({ purged: 1, objectsDeleted: 1 });
    expect(await prisma().phIntakeFile.count({ where: { status: 'PURGED' } })).toBe(3);
  });
});
