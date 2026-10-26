import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTillCatalog } from '@/server/pos/till-catalog';
import {
  createKitchenSection,
  deleteKitchenSection,
  ensureCatalogMenu,
  posCreateCategory,
  posCreateProduct,
  posDeleteCategory,
  posDeleteProduct,
  posSaveProductBasics,
  posSetAvailability,
  posSetCategorySection,
  posSetProductSetting,
  renameKitchenSection,
} from '@/server/studio/actions/pos';
import { posCatalogEditor } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let owner: Person;
let manager: Person;
let cashier: Person;
let bOwner: Person;
let menuId: string;

const arabic = (text: string) => ({ ar: text });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Edit A');
  b = await restaurant('Edit B');
  owner = await person('owner', { membership: [a.id, 'OWNER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  bOwner = await person('bowner', { membership: [b.id, 'OWNER'] });
  menuId = dataOf(await run(owner, ensureCatalogMenu, {})).menuId;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

async function newCategory(who: Person = manager, name = 'مشروبات') {
  return dataOf(await run(who, posCreateCategory, { names: arabic(name) })).categoryId;
}

async function newProduct(categoryId: string, name = 'شاي', price = 1500, who: Person = manager) {
  return dataOf(await run(who, posCreateProduct, { categoryId, names: arabic(name), price })).productId;
}

describe('a manager sets up the product list', () => {
  it('creates a category and a product and the till catalog shows them', async () => {
    const categoryId = await newCategory();
    const productId = await newProduct(categoryId, 'شاي', 1500);
    const catalog = (await loadTillCatalog(prisma(), a.id))!;
    expect(catalog.categories.map((c) => [c.id, c.names.ar])).toEqual([[categoryId, 'مشروبات']]);
    expect(catalog.products.map((p) => [p.id, p.names.ar, p.price])).toEqual([[productId, 'شاي', 1500]]);
  });

  it('edits a product’s name, price and category with the version it read', async () => {
    const drinks = await newCategory();
    const food = await newCategory(manager, 'أكل');
    const productId = await newProduct(drinks);
    const before = (await prisma().product.findUniqueOrThrow({ where: { id: productId } })).version;
    const saved = dataOf(await run(manager, posSaveProductBasics, { productId, version: before, names: arabic('شاي كرك'), price: 2000, categoryId: food }));
    expect(saved.version).toBe(before + 1);
    const [product] = (await loadTillCatalog(prisma(), a.id))!.products;
    expect(product).toMatchObject({ categoryId: food, price: 2000 });
    expect(product!.names.ar).toBe('شاي كرك');
  });

  it('keeps a product’s sizes and option groups when its basics are saved', async () => {
    const productId = await newProduct(await newCategory());
    const variant = await prisma().productVariant.create({ data: { menuId, productId, priceDelta: 500, isDefault: true, translations: { ar: { name: 'كبير' } } } });
    const group = await prisma().modifierGroup.create({ data: { menuId, productId, minSelect: 0, maxSelect: 1, translations: { ar: { name: 'إضافات' } } } });
    await prisma().modifierOption.create({ data: { menuId, groupId: group.id, priceDelta: 250, translations: { ar: { name: 'عسل' } } } });
    const version = (await prisma().product.findUniqueOrThrow({ where: { id: productId } })).version;
    dataOf(await run(manager, posSaveProductBasics, { productId, version, names: arabic('شاي'), price: 1800, categoryId: (await prisma().product.findUniqueOrThrow({ where: { id: productId } })).categoryId }));
    const [product] = (await loadTillCatalog(prisma(), a.id))!.products;
    expect(product!.variants.map((v) => [v.id, v.priceDelta, v.isDefault])).toEqual([[variant.id, 500, true]]);
    expect(product!.groups[0]!.options.map((o) => o.priceDelta)).toEqual([250]);
  });

  it('refuses a stale version with the Studio’s conflict', async () => {
    const productId = await newProduct(await newCategory());
    const categoryId = (await prisma().product.findUniqueOrThrow({ where: { id: productId } })).categoryId;
    const version = (await prisma().product.findUniqueOrThrow({ where: { id: productId } })).version;
    dataOf(await run(manager, posSaveProductBasics, { productId, version, names: arabic('أ'), price: 1, categoryId }));
    expect(codeOf(await run(owner, posSaveProductBasics, { productId, version, names: arabic('ب'), price: 2, categoryId }))).toBe('CONFLICT');
  });

  it('deletes a product and its till setting cascades with it', async () => {
    const productId = await newProduct(await newCategory());
    const section = dataOf(await run(manager, createKitchenSection, { name: 'Grill' })).sectionId;
    dataOf(await run(manager, posSetProductSetting, { productId, sectionId: section, soldOutOverride: true }));
    const version = (await prisma().product.findUniqueOrThrow({ where: { id: productId } })).version;
    dataOf(await run(manager, posDeleteProduct, { productId, version }));
    expect(await prisma().posProductSetting.count({ where: { productId } })).toBe(0);
    expect((await loadTillCatalog(prisma(), a.id))!.products).toEqual([]);
  });

  it('deletes a category and its setting', async () => {
    const categoryId = await newCategory();
    const section = dataOf(await run(manager, createKitchenSection, { name: 'Bar' })).sectionId;
    dataOf(await run(manager, posSetCategorySection, { categoryId, sectionId: section }));
    const version = (await prisma().category.findUniqueOrThrow({ where: { id: categoryId } })).version;
    dataOf(await run(manager, posDeleteCategory, { categoryId, version }));
    expect(await prisma().posCategorySetting.count({ where: { categoryId } })).toBe(0);
  });

  it('writes the Studio’s own audit actions, by the person at the till', async () => {
    const productId = await newProduct(await newCategory());
    const rows = await prisma().auditLog.findMany({ where: { entityId: productId } });
    expect(rows.map((row) => row.action)).toContain('product.created');
    expect(rows[0]).toMatchObject({ actorId: manager.userId, restaurantId: a.id, menuId });
  });

  it('makes a sold-out toggle live for guests: it needs no publish', async () => {
    const productId = await newProduct(await newCategory());
    dataOf(await run(manager, posSetAvailability, { productId, isAvailable: false }));
    expect((await prisma().product.findUniqueOrThrow({ where: { id: productId } })).isAvailable).toBe(false);
    expect((await loadTillCatalog(prisma(), a.id))!.products[0]!.available).toBe(false);
  });

  it('shows the editor the catalog with versions and the kitchen sections', async () => {
    const categoryId = await newCategory();
    const productId = await newProduct(categoryId);
    const section = dataOf(await run(manager, createKitchenSection, { name: 'Grill' })).sectionId;
    const view = dataOf(await ask(manager, posCatalogEditor, {}));
    expect(view.menuId).toBe(menuId);
    expect(view.sections).toEqual([{ id: section, name: 'Grill', sortOrder: 0 }]);
    expect(view.catalog.categories[0]).toMatchObject({ id: categoryId, version: 1 });
    expect(view.catalog.categories[0]!.products[0]).toMatchObject({ id: productId, version: 1 });
  });
});

describe('who may, and where', () => {
  it('refuses a cashier, who has no catalog.manage', async () => {
    expect(codeOf(await run(cashier, posCreateCategory, { names: arabic('س') }))).toBe('FORBIDDEN');
    expect(codeOf(await run(cashier, createKitchenSection, { name: 'x' }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(cashier, posCatalogEditor, {}))).toBe('FORBIDDEN');
  });

  it('refuses everything until the product list exists', async () => {
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { catalogMenuId: null } });
    expect(codeOf(await run(manager, posCreateCategory, { names: arabic('س') }))).toBe('NOT_FOUND');
  });

  it('cannot touch another restaurant’s product, category or section by id', async () => {
    const bMenu = dataOf(await run(bOwner, ensureCatalogMenu, {})).menuId;
    const theirCategory = dataOf(await run(bOwner, posCreateCategory, { names: arabic('ب') })).categoryId;
    const theirProduct = dataOf(await run(bOwner, posCreateProduct, { categoryId: theirCategory, names: arabic('ب'), price: 1 })).productId;
    const theirSection = dataOf(await run(bOwner, createKitchenSection, { name: 'Theirs' })).sectionId;

    expect(codeOf(await run(manager, posDeleteProduct, { productId: theirProduct, version: 1 }))).toBe('NOT_FOUND');
    expect(codeOf(await run(manager, posDeleteCategory, { categoryId: theirCategory, version: 1 }))).toBe('NOT_FOUND');
    expect(codeOf(await run(manager, posSetAvailability, { productId: theirProduct, isAvailable: false }))).toBe('NOT_FOUND');
    expect(codeOf(await run(manager, posSetProductSetting, { productId: theirProduct, sectionId: null, soldOutOverride: true }))).toBe('NOT_FOUND');
    expect(codeOf(await run(manager, posCreateProduct, { categoryId: theirCategory, names: arabic('س'), price: 1 }))).toBe('NOT_FOUND');
    const mine = await newProduct(await newCategory());
    expect(codeOf(await run(manager, posSetProductSetting, { productId: mine, sectionId: theirSection, soldOutOverride: false }))).toBe('NOT_FOUND');
    expect(codeOf(await run(manager, renameKitchenSection, { sectionId: theirSection, name: 'Stolen' }))).toBe('NOT_FOUND');
    expect(codeOf(await run(manager, deleteKitchenSection, { sectionId: theirSection }))).toBe('NOT_FOUND');
    expect(await prisma().product.count({ where: { menuId: bMenu } })).toBe(1);
    expect((await prisma().posKitchenSection.findUniqueOrThrow({ where: { id: theirSection } })).name).toBe('Theirs');
  });

  it('keeps a restaurant that only has a menu unchanged: no till permission reaches the Studio’s own checks', async () => {
    // The owner of A is an OWNER member; the Studio still gives them exactly the OWNER permissions it did.
    const { effectivePermissions } = await import('@/server/domain/permissions');
    expect([...effectivePermissions({ isSuperAdmin: false, role: 'OWNER', policy: {} })].sort()).toEqual(
      ['content.availability', 'content.edit', 'content.media', 'content.prices', 'prices.bulk', 'publish.now'].sort(),
    );
  });
});

describe('kitchen sections', () => {
  it('creates, renames and lists sections in order', async () => {
    const grill = dataOf(await run(manager, createKitchenSection, { name: 'Grill' })).sectionId;
    const bar = dataOf(await run(manager, createKitchenSection, { name: 'Bar' })).sectionId;
    dataOf(await run(manager, renameKitchenSection, { sectionId: bar, name: 'Cold bar' }));
    const rows = await prisma().posKitchenSection.findMany({ where: { restaurantId: a.id }, orderBy: { sortOrder: 'asc' } });
    expect(rows.map((row) => [row.id, row.name])).toEqual([[grill, 'Grill'], [bar, 'Cold bar']]);
  });

  it('refuses an empty or very long name', async () => {
    expect(codeOf(await run(manager, createKitchenSection, { name: '   ' }))).toBe('INVALID');
    expect(codeOf(await run(manager, createKitchenSection, { name: 'x'.repeat(61) }))).toBe('INVALID');
  });

  it('clears the assignments of a section that is deleted in use, and a kitchen person’s section', async () => {
    const section = dataOf(await run(manager, createKitchenSection, { name: 'Grill' })).sectionId;
    const categoryId = await newCategory();
    const productId = await newProduct(categoryId);
    dataOf(await run(manager, posSetCategorySection, { categoryId, sectionId: section }));
    dataOf(await run(manager, posSetProductSetting, { productId, sectionId: section, soldOutOverride: false }));
    const kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
    await prisma().posStaff.updateMany({ where: { userId: kitchen.userId }, data: { kitchenSectionId: section } });

    dataOf(await run(manager, deleteKitchenSection, { sectionId: section }));
    expect(await prisma().posKitchenSection.count({ where: { id: section } })).toBe(0);
    expect((await prisma().posCategorySetting.findUniqueOrThrow({ where: { categoryId } })).sectionId).toBeNull();
    expect((await prisma().posProductSetting.findUniqueOrThrow({ where: { productId } })).sectionId).toBeNull();
    expect((await prisma().posStaff.findFirstOrThrow({ where: { userId: kitchen.userId } })).kitchenSectionId).toBeNull();
  });

  it('writes audit rows for section changes', async () => {
    const section = dataOf(await run(manager, createKitchenSection, { name: 'Grill' })).sectionId;
    dataOf(await run(manager, renameKitchenSection, { sectionId: section, name: 'Hot' }));
    dataOf(await run(manager, deleteKitchenSection, { sectionId: section }));
    const actions = (await prisma().auditLog.findMany({ where: { entityType: 'PosKitchenSection' }, orderBy: { occurredAt: 'asc' } })).map((row) => row.action);
    expect(actions).toEqual(['pos.section.create', 'pos.section.rename', 'pos.section.delete']);
  });

  it('is a failure, not a crash, to assign a section that does not exist', async () => {
    const categoryId = await newCategory();
    expect(failureOf(await run(manager, posSetCategorySection, { categoryId, sectionId: 'nope' })).code).toBe('NOT_FOUND');
  });
});
