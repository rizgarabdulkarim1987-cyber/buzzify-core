import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTillCatalog } from '@/server/pos/till-catalog';
import { ensureCatalogMenu, posCreateCategory, posCreateProduct, posImportApply, posImportDiscard, posImportPreview } from '@/server/studio/actions/pos';
import { codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let dir: string;
let a: { id: string };
let b: { id: string };
let manager: Person;
let cashier: Person;
let bOwner: Person;
let menuId: string;

const FILE = 'category,name_ar,name_ckb,name_en,price\nمشروبات,شاي,چا,Tea,"1,500"\nمشروبات,قهوة,قاوە,Coffee,٢٥٠٠\nمأكولات,برغر,,Burger,8500\n';

const preview = (who: Person, csv: string, fileName = 'menu.csv') => run(who, posImportPreview, { fileName, csv });

beforeAll(() => {
  useTestDatabase();
  dir = mkdtempSync(join(tmpdir(), 'buzzify-pos-import-'));
  vi.stubEnv('MEDIA_LOCAL_DIR', dir);
  vi.stubEnv('MEDIA_PUBLIC_URL', '/api/dev-media');
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Import A');
  b = await restaurant('Import B');
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  bOwner = await person('bowner', { membership: [b.id, 'OWNER'] });
  menuId = dataOf(await run(manager, ensureCatalogMenu, {})).menuId;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('importing a product list', () => {
  it('previews, applies, and the till catalog shows the new categories and products', async () => {
    const { importJobId, preview: shown } = dataOf(await preview(manager, FILE));
    expect(shown.summary).toMatchObject({ new: 3, changed: 0, invalid: 0 });
    expect(await prisma().product.count({ where: { menuId } })).toBe(0);

    dataOf(await run(manager, posImportApply, { importJobId }));
    const catalog = (await loadTillCatalog(prisma(), a.id))!;
    expect(catalog.categories.map((category) => category.names.ar)).toEqual(['مشروبات', 'مأكولات']);
    expect(catalog.products.map((product) => [product.names.ar, product.names.ckb, product.names.en, product.price])).toEqual([
      ['شاي', 'چا', 'Tea', 1500],
      ['قهوة', 'قاوە', 'Coffee', 2500],
      ['برغر', undefined, 'Burger', 8500],
    ]);
  });

  it('writes the Studio’s own import audit, by the person at the till', async () => {
    const { importJobId } = dataOf(await preview(manager, FILE));
    dataOf(await run(manager, posImportApply, { importJobId }));
    const row = await prisma().auditLog.findFirstOrThrow({ where: { action: 'menu.imported' } });
    expect(row).toMatchObject({ actorId: manager.userId, restaurantId: a.id, menuId });
  });

  it('reuses a category the menu already has, and a second import of the same file changes nothing', async () => {
    const existing = dataOf(await run(manager, posCreateCategory, { names: { ar: 'مشروبات' } })).categoryId;
    dataOf(await run(manager, posImportApply, { importJobId: dataOf(await preview(manager, FILE)).importJobId }));
    expect(await prisma().category.count({ where: { menuId } })).toBe(2);
    expect((await prisma().product.findMany({ where: { menuId, categoryId: existing } })).map((product) => product.basePrice).sort()).toEqual([1500, 2500]);

    const again = dataOf(await preview(manager, FILE)).preview;
    expect(again.summary).toMatchObject({ new: 0, changed: 0, unchanged: 3, invalid: 0 });
  });

  it('matches an Arabic-only product by its name, so the second import does not add it twice', async () => {
    const arabicOnly = 'category,name_ar,price\nمشروبات,شاي,1000\n';
    dataOf(await run(manager, posImportApply, { importJobId: dataOf(await preview(manager, arabicOnly)).importJobId }));
    const again = dataOf(await preview(manager, 'category,name_ar,price\nمشروبات,شاي,1200\n')).preview;
    expect(again.summary).toMatchObject({ new: 0, changed: 1 });
  });

  it('never hides the products the file does not name', async () => {
    const category = dataOf(await run(manager, posCreateCategory, { names: { ar: 'مشروبات' } })).categoryId;
    const kept = dataOf(await run(manager, posCreateProduct, { categoryId: category, names: { ar: 'عصير', en: 'Juice' }, price: 3000 })).productId;
    dataOf(await run(manager, posImportApply, { importJobId: dataOf(await preview(manager, FILE)).importJobId }));
    expect((await prisma().product.findUniqueOrThrow({ where: { id: kept } })).isHidden).toBe(false);
  });

  it('refuses 2,001 rows and writes nothing', async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => `Food,Item ${i},${1000 + i}`).join('\n');
    const failure = failureOf(await preview(manager, `category,name_en,price\n${rows}`));
    expect(failure).toMatchObject({ code: 'INVALID', message: 'Use at most 2,000 rows' });
    expect(await prisma().importJob.count({ where: { menuId } })).toBe(0);
    expect(await prisma().product.count({ where: { menuId } })).toBe(0);
  });

  it('refuses a file with a bad row, naming the lines, and writes nothing', async () => {
    const failure = failureOf(await preview(manager, 'category,name_en,price\nA,Tea,1000\nA,Bad,12.5\n,NoCat,5\n'));
    expect(failure).toMatchObject({ code: 'INVALID', message: 'Some rows of this file are not right', fields: { rows: '3, 4' } });
    expect(await prisma().importJob.count({ where: { menuId } })).toBe(0);
  });

  it('refuses to apply twice: the job is APPLIED', async () => {
    const { importJobId } = dataOf(await preview(manager, FILE));
    dataOf(await run(manager, posImportApply, { importJobId }));
    expect(codeOf(await run(manager, posImportApply, { importJobId }))).toBe('CONFLICT');
    expect(await prisma().product.count({ where: { menuId } })).toBe(3);
  });

  it('refuses to apply when the menu changed since the preview', async () => {
    const { importJobId } = dataOf(await preview(manager, FILE));
    dataOf(await run(manager, posCreateCategory, { names: { ar: 'أخرى' } }));
    expect(codeOf(await run(manager, posImportApply, { importJobId }))).toBe('CONFLICT');
    expect(await prisma().product.count({ where: { menuId } })).toBe(0);
  });

  it('sets a preview aside without writing', async () => {
    const { importJobId } = dataOf(await preview(manager, FILE));
    dataOf(await run(manager, posImportDiscard, { importJobId }));
    expect(codeOf(await run(manager, posImportApply, { importJobId }))).toBe('CONFLICT');
    expect(await prisma().product.count({ where: { menuId } })).toBe(0);
  });
});

describe('who may import, and where', () => {
  it('refuses a cashier', async () => {
    expect(codeOf(await preview(cashier, FILE))).toBe('FORBIDDEN');
  });

  it('cannot apply or discard another restaurant’s import', async () => {
    const { importJobId } = dataOf(await preview(manager, FILE));
    dataOf(await run(bOwner, ensureCatalogMenu, {}));
    expect(codeOf(await run(bOwner, posImportApply, { importJobId }))).toBe('NOT_FOUND');
    expect(codeOf(await run(bOwner, posImportDiscard, { importJobId }))).toBe('NOT_FOUND');
    expect(await prisma().product.count()).toBe(0);
  });

  it('is refused until the product list exists', async () => {
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { catalogMenuId: null } });
    expect(codeOf(await preview(manager, FILE))).toBe('NOT_FOUND');
  });
});
