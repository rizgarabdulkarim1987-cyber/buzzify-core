import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTenant } from '@/server/data/public-menu';
import { catalogMenuOf } from '@/server/pos/catalog-menu';
import { chooseCatalogMenu, ensureCatalogMenu } from '@/server/studio/actions/pos';
import { posCatalogMenu } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let owner: Person;
let manager: Person;
let cashier: Person;
let bOwner: Person;

const addMenu = (restaurantId: string, name: string, slug: string, currency = 'IQD') =>
  prisma().menu.create({ data: { restaurantId, name, slug, currency, locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Catalog A');
  b = await restaurant('Catalog B');
  owner = await person('owner', { membership: [a.id, 'OWNER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  bOwner = await person('bowner', { membership: [b.id, 'OWNER'] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('ensureCatalogMenu', () => {
  it('with no menu, creates one DRAFT menu in Iraqi dinar, once, and is idempotent', async () => {
    const first = dataOf(await run(owner, ensureCatalogMenu, {}));
    expect(first.created).toBe(true);
    const menu = await prisma().menu.findUniqueOrThrow({ where: { id: first.menuId } });
    expect(menu).toMatchObject({
      restaurantId: a.id,
      status: 'DRAFT',
      currency: 'IQD',
      defaultLocale: 'ar',
      timezone: 'Asia/Baghdad',
      numeralSystem: 'ARAB',
      liveRevisionId: null,
    });
    expect([...menu.locales].sort()).toEqual(['ar', 'ckb', 'en']);
    const second = dataOf(await run(owner, ensureCatalogMenu, {}));
    expect(second).toEqual({ menuId: first.menuId, created: false });
    expect(await prisma().menu.count({ where: { restaurantId: a.id } })).toBe(1);
    expect((await prisma().posSettings.findUniqueOrThrow({ where: { restaurantId: a.id } })).catalogMenuId).toBe(first.menuId);
  });

  it('makes a menu with no live revision whose slug resolves to nothing publicly', async () => {
    const { menuId } = dataOf(await run(owner, ensureCatalogMenu, {}));
    const menu = await prisma().menu.findUniqueOrThrow({ where: { id: menuId } });
    expect(menu.liveRevisionId).toBeNull();
    expect(await getTenant(menu.slug)).toBeNull();
  });

  it('adopts the only menu the restaurant already has, without creating another', async () => {
    const existing = await addMenu(a.id, 'Main', 'main-menu-a');
    expect(dataOf(await run(owner, ensureCatalogMenu, {}))).toEqual({ menuId: existing.id, created: false });
    expect(await prisma().menu.count({ where: { restaurantId: a.id } })).toBe(1);
  });

  it('refuses to choose for the owner when there are two menus', async () => {
    await addMenu(a.id, 'Main', 'main-menu-a');
    await addMenu(a.id, 'Lunch', 'lunch-menu-a');
    const error = failureOf(await run(owner, ensureCatalogMenu, {}));
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Choose which menu is the product list');
  });

  it('refuses to adopt a menu that is not in dinar', async () => {
    await addMenu(a.id, 'Dollars', 'dollar-menu-a', 'USD');
    expect(failureOf(await run(owner, ensureCatalogMenu, {})).message).toBe('The product list must be priced in Iraqi dinar');
  });

  it('writes an audit row for the menu it makes', async () => {
    const { menuId } = dataOf(await run(owner, ensureCatalogMenu, {}));
    const rows = await prisma().auditLog.findMany({ where: { entityId: menuId } });
    expect(rows.map((row) => row.action)).toContain('menu.created');
    expect(await prisma().auditLog.count({ where: { action: 'pos.catalog.chosen' } })).toBe(1);
  });

  it('needs catalog.manage: a manager may, a cashier may not', async () => {
    expect(codeOf(await run(manager, ensureCatalogMenu, {}))).toBe('OK');
    expect(codeOf(await run(cashier, ensureCatalogMenu, {}))).toBe('FORBIDDEN');
  });

  it('keeps each restaurant to its own', async () => {
    const mine = dataOf(await run(owner, ensureCatalogMenu, {}));
    const theirs = dataOf(await run(bOwner, ensureCatalogMenu, {}));
    expect(mine.menuId).not.toBe(theirs.menuId);
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: theirs.menuId } })).restaurantId).toBe(b.id);
  });
});

describe('chooseCatalogMenu', () => {
  it('chooses one of the restaurant’s dinar menus', async () => {
    await addMenu(a.id, 'Main', 'main-menu-a');
    const lunch = await addMenu(a.id, 'Lunch', 'lunch-menu-a');
    expect(dataOf(await run(owner, chooseCatalogMenu, { menuId: lunch.id }))).toEqual({ menuId: lunch.id });
    expect(await catalogMenuOf(prisma(), a.id)).toEqual({ id: lunch.id, currency: 'IQD' });
    expect(dataOf(await run(owner, ensureCatalogMenu, {}))).toEqual({ menuId: lunch.id, created: false });
  });

  it('refuses a USD menu', async () => {
    const usd = await addMenu(a.id, 'Dollars', 'dollar-menu-a', 'USD');
    expect(failureOf(await run(owner, chooseCatalogMenu, { menuId: usd.id })).message).toBe('The product list must be priced in Iraqi dinar');
  });

  it('cannot choose another restaurant’s menu, and says nothing of it', async () => {
    const theirs = await addMenu(b.id, 'Theirs', 'theirs-menu-b');
    expect(codeOf(await run(owner, chooseCatalogMenu, { menuId: theirs.id }))).toBe('NOT_FOUND');
    expect(await catalogMenuOf(prisma(), a.id)).toBeNull();
  });
});

describe('posCatalogMenu', () => {
  it('lists the restaurant’s menus and the chosen one', async () => {
    const main = await addMenu(a.id, 'Main', 'main-menu-a');
    await addMenu(b.id, 'Theirs', 'theirs-menu-b');
    const view = dataOf(await ask(owner, posCatalogMenu, {}));
    expect(view.chosenId).toBeNull();
    expect(view.menus.map((menu) => menu.id)).toEqual([main.id]);
    dataOf(await run(owner, chooseCatalogMenu, { menuId: main.id }));
    expect(dataOf(await ask(owner, posCatalogMenu, {})).chosenId).toBe(main.id);
  });
});
