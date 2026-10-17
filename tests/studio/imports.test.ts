import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { getCatalog, getTenant } from '@/server/data/public-menu';
import { getStorage } from '@/server/storage/storage';
import * as content from '@/server/studio/actions/content';
import * as imports from '@/server/studio/actions/imports';
import * as prices from '@/server/studio/actions/prices';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as importQueries from '@/server/studio/queries/imports';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData, seedAtelier } from '../helpers/db';

const prisma = () => getPrisma();
const META = { ip: '203.0.113.7', userAgent: 'vitest' };
const HEADER = 'category_slug,category_en,product_slug,name_en,price,available';

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};

let dir: string;
let a: Awaited<ReturnType<typeof createMenuFixture>>;
let designer: Actor;

const run = <I, O>(def: ActionDef<I, O>, input: unknown, actor: Actor = designer) => runAction(prisma(), actor, def, input, META);

/** The file behind a development download link. */
async function downloaded(url: string): Promise<Uint8Array> {
  const key = decodeURIComponent(new URL(url, 'http://localhost').pathname.replace(/^\/api\/dev-media\//, ''));
  const file = await getStorage().get(key, 50_000_000);
  if (!file) throw new Error(`nothing stored at ${key}`);
  return file.bytes;
}

/** A sheet sent the way the browser sends it: a signed slot, then the file put into it. */
async function upload(menuId: string, sheet: string | Uint8Array, fileName = 'menu.csv'): Promise<string> {
  const bytes = typeof sheet === 'string' ? new TextEncoder().encode(sheet) : sheet;
  const slot = dataOf(await run(imports.requestUpload, { menuId, fileName, bytes: bytes.length }));
  await getStorage().put(slot.uploadKey, bytes, { contentType: 'application/octet-stream', cacheControl: 'no-store' });
  return slot.uploadKey;
}

async function parse(menuId: string, sheet: string | Uint8Array, options: { fileName?: string; hideMissing?: boolean } = {}) {
  const fileName = options.fileName ?? 'menu.csv';
  const uploadKey = await upload(menuId, sheet, fileName);
  return run(imports.parse, { menuId, uploadKey, fileName, hideMissing: options.hideMissing ?? false });
}

const menuRow = (id = a.menu.id) => prisma().menu.findUniqueOrThrow({ where: { id } });
const espresso = () => prisma().product.findUniqueOrThrow({ where: { id: a.product.id } });

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  dir = mkdtempSync(join(tmpdir(), 'buzzify-import-'));
  vi.stubEnv('MEDIA_LOCAL_DIR', dir);
  vi.stubEnv('MEDIA_PUBLIC_URL', '/api/dev-media');
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'imp-a');
  await prisma().user.create({ data: { id: 'designer-a', name: 'Alpha Designer', email: 'designer-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'designer-a', restaurantId: a.restaurant.id, role: 'DESIGNER' } });
  designer = (await loadActor(prisma(), 'designer-a')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
  rmSync(dir, { recursive: true, force: true });
});

describe('export and import', () => {
  it.each(['csv', 'xlsx'] as const)('exports the ATELIER draft as %s and imports it back with nothing changed', async (format) => {
    const { menuId, restaurantId } = await seedAtelier(prisma()).then(async () => {
      const menu = await prisma().menu.findUniqueOrThrow({ where: { slug: 'atelier' } });
      return { menuId: menu.id, restaurantId: menu.restaurantId };
    });
    await prisma().membership.create({ data: { userId: 'designer-a', restaurantId, role: 'DESIGNER' } });
    designer = (await loadActor(prisma(), 'designer-a')) as Actor;
    const before = await menuRow(menuId);

    const exported = dataOf(await run(imports.exportMenu, { menuId, format }));
    expect(new URL(exported.url, 'http://localhost').searchParams.get('name')).toBe(`atelier-menu.${format}`);
    const preview = dataOf(await parse(menuId, await downloaded(exported.url), { fileName: `atelier-menu.${format}`, hideMissing: true })).preview;
    expect(preview.summary).toMatchObject({ new: 0, changed: 0, invalid: 0, hidden: 0 });
    expect(preview.summary.unchanged).toBe(await prisma().product.count({ where: { menuId } }));
    expect(await prisma().auditLog.count({ where: { action: 'menu.exported', menuId } })).toBe(1);

    const job = await prisma().importJob.findFirstOrThrow({ where: { menuId } });
    dataOf(await run(imports.apply, { menuId, importJobId: job.id }));
    expect((await menuRow(menuId)).draftHash).toBe(before.draftHash);
  });

  it('applies an import in one transaction and shows guests nothing until publish', async () => {
    const sheet = [HEADER, `coffee,,imp-a-espresso,Espresso,3.50,yes`, `milk-drinks,Milk drinks,flat-white,Flat white,4.25,yes`].join('\n');
    const uploadKey = await upload(a.menu.id, sheet);
    const { importJobId, preview } = dataOf(await run(imports.parse, { menuId: a.menu.id, uploadKey, fileName: 'menu.csv', hideMissing: false }));
    expect(preview.summary).toEqual({ new: 1, changed: 1, unchanged: 0, invalid: 0, hidden: 0 });
    expect(preview.newCategories).toEqual([{ slug: 'milk-drinks', names: { en: 'Milk drinks' } }]);
    // The upload is gone once read; the preview is kept with the job.
    expect(await getStorage().head(uploadKey)).toBeNull();
    expect(await prisma().importJob.findUniqueOrThrow({ where: { id: importJobId } })).toMatchObject({ status: 'PARSED', rowCount: 2, fileName: 'menu.csv' });

    const result = dataOf(await run(imports.apply, { menuId: a.menu.id, importJobId }));
    expect(result).toMatchObject({ summary: { new: 1, changed: 1 }, liveSkipped: 0 });
    expect(await espresso()).toMatchObject({ basePrice: 350, version: 2 });
    const flatWhite = await prisma().product.findFirstOrThrow({ where: { menuId: a.menu.id, slug: 'flat-white' }, include: { category: true } });
    expect(flatWhite).toMatchObject({ basePrice: 425, translations: { en: { name: 'Flat white' } }, category: { slug: 'milk-drinks', translations: { en: { name: 'Milk drinks' } } } });
    expect(await prisma().importJob.findUniqueOrThrow({ where: { id: importJobId } })).toMatchObject({ status: 'APPLIED', appliedAt: expect.any(Date) });
    expect(await prisma().auditLog.findFirstOrThrow({ where: { action: 'menu.imported' } })).toMatchObject({ entityType: 'ImportJob', entityId: importJobId });

    // Guests still get the published menu.
    const catalog = await getCatalog((await getTenant('imp-a'))!);
    expect(catalog.products.map((product) => [product.id, product.basePrice])).toEqual([[a.product.id, 300]]);
    expect((await menuRow()).draftHash).not.toBe(a.menu.draftHash);
  });

  it('refuses to apply a preview after the draft changed', async () => {
    const { importJobId } = dataOf(await parse(a.menu.id, [HEADER, `coffee,,imp-a-espresso,Espresso,3.50,yes`].join('\n')));
    dataOf(await run(content.createCategory, { menuId: a.menu.id, names: { en: 'Tea' } }));
    expect(failureOf(await run(imports.apply, { menuId: a.menu.id, importJobId })).code).toBe('CONFLICT');
    expect((await espresso()).basePrice).toBe(300);
    expect((await prisma().importJob.findUniqueOrThrow({ where: { id: importJobId } })).status).toBe('PARSED');
  });

  it('refuses an editor opened before the import', async () => {
    const opened = (await espresso()).version;
    const { importJobId } = dataOf(await parse(a.menu.id, [HEADER, `coffee,,imp-a-espresso,Espresso,3.50,yes`].join('\n')));
    dataOf(await run(imports.apply, { menuId: a.menu.id, importJobId }));
    const stale = failureOf(await run(prices.set, { menuId: a.menu.id, target: { kind: 'product', id: a.product.id, version: opened }, price: 999 }));
    expect(stale).toMatchObject({ code: 'CONFLICT', fields: { changedBy: 'Alpha Designer' } });
    expect((await espresso()).basePrice).toBe(350);
  });

  it('applies the available column live only with content.availability', async () => {
    const sheet = [HEADER, `coffee,,imp-a-espresso,Espresso,3.00,no`].join('\n');
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { permissionPolicy: { DESIGNER: { grant: [], revoke: ['content.availability'] } } } });
    const limited = (await loadActor(prisma(), 'designer-a')) as Actor;
    const first = dataOf(await run(imports.parse, { menuId: a.menu.id, uploadKey: await upload(a.menu.id, sheet), fileName: 'menu.csv', hideMissing: false }, limited));
    expect(dataOf(await run(imports.apply, { menuId: a.menu.id, importJobId: first.importJobId }, limited))).toMatchObject({ liveSkipped: 1 });
    expect((await espresso()).isAvailable).toBe(true);

    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { permissionPolicy: {} } });
    const second = dataOf(await parse(a.menu.id, sheet));
    expect(dataOf(await run(imports.apply, { menuId: a.menu.id, importJobId: second.importJobId }))).toMatchObject({ liveSkipped: 0 });
    expect((await espresso()).isAvailable).toBe(false);
    // Live at once, without a publish.
    expect((await getCatalog((await getTenant('imp-a'))!)).products[0]!.isAvailable).toBe(false);
  });

  it('hides the products the sheet leaves out only when asked', async () => {
    const latte = await prisma().product.create({ data: { menuId: a.menu.id, categoryId: a.category.id, slug: 'latte', basePrice: 450, translations: { en: { name: 'Latte' } } } });
    const sheet = [HEADER, `coffee,,imp-a-espresso,Espresso,3.00,yes`].join('\n');
    const kept = dataOf(await parse(a.menu.id, sheet));
    expect(kept.preview.missing).toEqual([{ productId: latte.id, slug: 'latte', name: 'Latte' }]);
    dataOf(await run(imports.apply, { menuId: a.menu.id, importJobId: kept.importJobId }));
    expect((await prisma().product.findUniqueOrThrow({ where: { id: latte.id } })).isHidden).toBe(false);

    const hidden = dataOf(await parse(a.menu.id, sheet, { hideMissing: true }));
    expect(hidden.preview.summary.hidden).toBe(1);
    dataOf(await run(imports.apply, { menuId: a.menu.id, importJobId: hidden.importJobId }));
    expect((await prisma().product.findUniqueOrThrow({ where: { id: latte.id } })).isHidden).toBe(true);
  });

  it('names the columns a sheet gets wrong, and refuses to apply a sheet with invalid rows', async () => {
    const headers = failureOf(await parse(a.menu.id, 'category_slug,name_en,colour\ncoffee,Espresso,red\n'));
    expect(headers).toMatchObject({ code: 'INVALID', fields: { unknownColumns: 'colour', missingColumns: 'price' } });
    const encoding = failureOf(await parse(a.menu.id, new Uint8Array([...new TextEncoder().encode('category_slug,name_en,price\ncoffee,'), 0xe2, 0xe5, 0x2c, 0x33])));
    expect(encoding).toMatchObject({ code: 'INVALID', message: 'Save the sheet as CSV UTF-8 and upload it again' });

    const { importJobId, preview } = dataOf(await parse(a.menu.id, [HEADER, `coffee,,imp-a-espresso,Espresso,lots,yes`].join('\n')));
    expect(preview.rows[0]).toMatchObject({ rowNumber: 2, status: 'invalid', errors: [{ column: 'price', reason: 'NOT_A_NUMBER' }] });
    expect(failureOf(await run(imports.apply, { menuId: a.menu.id, importJobId })).code).toBe('INVALID');
  });

  it('refuses a file that is not a CSV or an Excel sheet, or is larger than 5 MB', async () => {
    expect(failureOf(await run(imports.requestUpload, { menuId: a.menu.id, fileName: 'menu.pdf', bytes: 100 })).code).toBe('INVALID');
    expect(failureOf(await run(imports.requestUpload, { menuId: a.menu.id, fileName: 'menu.csv', bytes: 5 * 1024 * 1024 + 1 })).code).toBe('INVALID');
  });

  it("refuses another menu's upload key", async () => {
    const other = await createMenuFixture(prisma(), 'imp-b');
    const key = `imports/${other.menu.id}/planted`;
    await getStorage().put(key, new TextEncoder().encode(HEADER), { contentType: 'text/csv', cacheControl: 'no-store' });
    expect(failureOf(await run(imports.parse, { menuId: a.menu.id, uploadKey: key, fileName: 'menu.csv', hideMissing: false })).code).toBe('NOT_FOUND');
    expect(await getStorage().head(key)).not.toBeNull();
  });

  it('discards a preview, which can then not be applied, and shows a job', async () => {
    const { importJobId } = dataOf(await parse(a.menu.id, [HEADER, `coffee,,imp-a-espresso,Espresso,3.50,yes`].join('\n')));
    expect(dataOf(await runQuery(prisma(), designer, importQueries.job, { menuId: a.menu.id, importJobId }))).toMatchObject({ status: 'PARSED', fileName: 'menu.csv' });
    dataOf(await run(imports.discard, { menuId: a.menu.id, importJobId }));
    expect(failureOf(await run(imports.apply, { menuId: a.menu.id, importJobId })).code).toBe('CONFLICT');
    expect((await espresso()).basePrice).toBe(300);
  });
});
