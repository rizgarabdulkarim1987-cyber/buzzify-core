import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScanner, productByBarcode } from '@/server/domain/pos/scan';
import { loadTillCatalog } from '@/server/pos/till-catalog';
import { posSetProductBarcode } from '@/server/studio/actions/pos';
import { codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let manager: Person;
let cashier: Person;
let bManager: Person;
let kebab: string;
let tea: string;
let bProduct: string;

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

async function menuWith(restaurantId: string, slug: string, slugs: string[]) {
  const menu = await prisma().menu.create({ data: { restaurantId, name: slug, slug, currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' } });
  await prisma().posSettings.upsert({ where: { restaurantId }, create: { restaurantId, catalogMenuId: menu.id }, update: { catalogMenuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: `c-${slug}`, sortOrder: 1, translations: names('أكل', 'Food') } });
  const ids: string[] = [];
  for (const [index, s] of slugs.entries()) ids.push((await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: s, sortOrder: index, basePrice: 5000, translations: names(s) } })).id);
  return ids;
}

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Barcode A');
  b = await restaurant('Barcode B');
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
  [kebab, tea] = await menuWith(a.id, 'menu-a', ['kebab', 'tea']);
  [bProduct] = await menuWith(b.id, 'menu-b', ['kebab-b']);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('posSetProductBarcode', () => {
  it('keeps leading zeros and reaches the till catalog', async () => {
    expect(codeOf(await run(manager, posSetProductBarcode, { productId: kebab, barcode: '00123' }))).toBe('OK');
    const catalog = await loadTillCatalog(prisma(), a.id);
    expect(catalog?.products.find((p) => p.id === kebab)?.barcode).toBe('00123');
    expect(catalog?.products.find((p) => p.id === tea)?.barcode).toBeNull();
  });

  it('clears a barcode with an empty value, and trims spaces', async () => {
    await run(manager, posSetProductBarcode, { productId: kebab, barcode: '  777  ' });
    expect((await loadTillCatalog(prisma(), a.id))?.products.find((p) => p.id === kebab)?.barcode).toBe('777');
    await run(manager, posSetProductBarcode, { productId: kebab, barcode: '' });
    expect((await loadTillCatalog(prisma(), a.id))?.products.find((p) => p.id === kebab)?.barcode).toBeNull();
  });

  it('refuses a code another product of the restaurant already has, but allows the same product again', async () => {
    await run(manager, posSetProductBarcode, { productId: kebab, barcode: '555' });
    const refused = await run(manager, posSetProductBarcode, { productId: tea, barcode: '555' });
    expect(codeOf(refused)).toBe('CONFLICT');
    expect(failureOf(refused).message).toBe('This barcode belongs to another product');
    expect(codeOf(await run(manager, posSetProductBarcode, { productId: kebab, barcode: '555' }))).toBe('OK');
  });

  it('lets two restaurants use the same code', async () => {
    await run(manager, posSetProductBarcode, { productId: kebab, barcode: '555' });
    expect(codeOf(await run(bManager, posSetProductBarcode, { productId: bProduct, barcode: '555' }))).toBe('OK');
  });

  it('does not touch the product of another restaurant, and is not for the cashier', async () => {
    expect(codeOf(await run(manager, posSetProductBarcode, { productId: bProduct, barcode: '9' }))).toBe('NOT_FOUND');
    expect(codeOf(await run(cashier, posSetProductBarcode, { productId: kebab, barcode: '9' }))).toBe('FORBIDDEN');
  });

  it('keeps the sold-out switch and section of a product that already had settings', async () => {
    await prisma().posProductSetting.create({ data: { productId: kebab, restaurantId: a.id, soldOutOverride: true } });
    dataOf(await run(manager, posSetProductBarcode, { productId: kebab, barcode: '42' }));
    const row = await prisma().posProductSetting.findFirstOrThrow({ where: { productId: kebab } });
    expect(row).toMatchObject({ soldOutOverride: true, barcode: '42' });
  });
});

describe('createScanner', () => {
  function typer() {
    const codes: string[] = [];
    let now = 0;
    const scanner = createScanner((code) => codes.push(code), () => now);
    const key = (k: string, gap: number, targetIsField = false) => {
      now += gap;
      scanner.key({ key: k, targetIsField });
    };
    return { codes, key };
  }

  it('says which keys it consumed, so the page can stop Enter from pressing the focused button', () => {
    let now = 0;
    const scanner = createScanner(() => undefined, () => now);
    const press = (key: string, gap: number, targetIsField = false) => {
      now += gap;
      return scanner.key({ key, targetIsField });
    };
    expect(press('4', 10)).toBe(false); // the first character cannot be told from a person typing
    expect(press('0', 10)).toBe(true); // a second one inside the gap is a burst
    expect(press('0', 10)).toBe(true);
    expect(press('6', 10)).toBe(true);
    expect(press('Enter', 10)).toBe(true);
    expect(press('Enter', 10)).toBe(false); // a lone Enter is the cashier's
    press('4', 10);
    press('0', 10);
    expect(press('Enter', 10)).toBe(false); // too short to be a scan
    expect(press('Enter', 10, true)).toBe(false);
  });

  it('reads a fast burst ended by Enter as a scan', () => {
    const { codes, key } = typer();
    for (const k of ['4', '0', '0', '6']) key(k, 10);
    key('Enter', 10);
    expect(codes).toEqual(['4006']);
  });

  it('keeps leading zeros', () => {
    const { codes, key } = typer();
    for (const k of ['0', '0', '1', '2', '3']) key(k, 5);
    key('Enter', 5);
    expect(codes).toEqual(['00123']);
  });

  it('ignores slow typing and short bursts', () => {
    const { codes, key } = typer();
    for (const k of ['4', '0', '0', '6']) key(k, 300);
    key('Enter', 300);
    for (const k of ['1', '2']) key(k, 5);
    key('Enter', 5);
    expect(codes).toEqual([]);
  });

  it('ignores a burst typed into a field', () => {
    const { codes, key } = typer();
    for (const k of ['4', '0', '0', '6']) key(k, 5, true);
    key('Enter', 5, true);
    expect(codes).toEqual([]);
  });

  it('starts a new code after a pause', () => {
    const { codes, key } = typer();
    for (const k of ['9', '9']) key(k, 5);
    for (const k of ['1', '2', '3', '4']) key(k, i(k));
    key('Enter', 5);
    expect(codes).toEqual(['1234']);
    function i(k: string) {
      return k === '1' ? 500 : 5;
    }
  });
});

describe('productByBarcode', () => {
  const products = [
    { id: 'a', barcode: '00123' },
    { id: 'b', barcode: null },
    { id: 'c', barcode: '777' },
  ];

  it('matches the exact code', () => {
    expect(productByBarcode(products, '00123')).toBe('a');
    expect(productByBarcode(products, '777')).toBe('c');
  });

  it('does not match a code without its zeros, or an unknown one', () => {
    expect(productByBarcode(products, '123')).toBeNull();
    expect(productByBarcode(products, '999')).toBeNull();
  });
});

describe('posSetProductBarcode, simultaneous saves', () => {
  it('lets two first saves of one product both succeed', async () => {
    const results = await Promise.all([
      run(manager, posSetProductBarcode, { productId: kebab, barcode: '7001' }),
      run(manager, posSetProductBarcode, { productId: kebab, barcode: '7002' }),
    ]);
    expect(results.map(codeOf)).toEqual(['OK', 'OK']);
    expect(await prisma().posProductSetting.count({ where: { productId: kebab } })).toBe(1);
  });

  it('gives the barcode refusal, never a raw error, when two products take one code at once', async () => {
    const results = await Promise.all([
      run(manager, posSetProductBarcode, { productId: kebab, barcode: '5551' }),
      run(manager, posSetProductBarcode, { productId: tea, barcode: '5551' }),
    ]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    expect(await prisma().posProductSetting.count({ where: { restaurantId: a.id, barcode: '5551' } })).toBe(1);
  });
});
