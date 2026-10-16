import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDraftCatalog } from '@/server/data/catalog-loader';
import { menuDb } from '@/server/data/tenant-db';
import { recordEvents } from '@/server/data/events';
import { createMenuFixture, resetTestData, seedAtelier, testPrisma } from '../helpers/db';

const prisma = testPrisma();
let menuId = '';

describe('data layer (database)', () => {
  beforeAll(async () => {
    await resetTestData(prisma);
    menuId = (await seedAtelier(prisma)).menuId;
  });
  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('loads the full ATELIER catalog into domain types', async () => {
    const catalog = await loadDraftCatalog(prisma, menuId);
    expect(catalog.currency).toBe('USD');
    expect(catalog.timeZone).toBe('Asia/Baghdad');
    expect(catalog.products).toHaveLength(24);
    expect(catalog.categories).toHaveLength(5);
    expect(catalog.bundles).toHaveLength(2);
    expect(catalog.schedule).toHaveLength(4);
    const burger = catalog.products.find((p) => p.slug === 'atelier-burger')!;
    expect(burger.basePrice).toBe(900);
    expect(burger.groups[0]?.options.map((o) => o.priceDelta)).toEqual([100, 300, 150]);
    expect(burger.slot).toBe('MAIN');
    expect(burger.translations.ckb?.name).toBeTruthy();
  });

  it('carries the hidden flag, dietary tags, calories and badges of a product', async () => {
    const row = await prisma.product.findFirstOrThrow({ where: { menuId, slug: 'atelier-burger' } });
    const plain = (await loadDraftCatalog(prisma, menuId)).products.find((p) => p.id === row.id)!;
    expect(plain).toMatchObject({ isHidden: false, dietary: [], calories: null, badges: [] });
    try {
      await prisma.product.update({
        where: { id: row.id },
        data: { isHidden: true, dietary: ['halal'], calories: 640, badges: ['POPULAR'] },
      });
      const changed = (await loadDraftCatalog(prisma, menuId)).products.find((p) => p.id === row.id)!;
      expect(changed).toMatchObject({ isHidden: true, dietary: ['halal'], calories: 640, badges: ['POPULAR'] });
    } finally {
      await prisma.product.update({
        where: { id: row.id },
        data: { isHidden: false, dietary: [], calories: null, badges: [] },
      });
    }
  });

  it('takes the products of a deactivated category out of the catalog', async () => {
    const before = await loadDraftCatalog(prisma, menuId);
    const category = await prisma.category.findFirstOrThrow({ where: { menuId, slug: 'cold' } });
    const inCategory = before.products.filter((p) => p.categoryId === category.id).length;
    expect(inCategory).toBeGreaterThan(0);
    try {
      await prisma.category.update({ where: { id: category.id }, data: { isActive: false } });
      const after = await loadDraftCatalog(prisma, menuId);
      expect(after.categories.map((c) => c.slug)).not.toContain('cold');
      expect(after.products).toHaveLength(before.products.length - inCategory);
      expect(after.products.some((p) => p.categoryId === category.id)).toBe(false);
    } finally {
      await prisma.category.update({ where: { id: category.id }, data: { isActive: true } });
    }
  });

  it('orders variants, groups and options that share a sort order by id', async () => {
    const burger = await prisma.product.findFirstOrThrow({
      where: { menuId, slug: 'atelier-burger' },
      include: { groups: { include: { options: true } } },
    });
    const options = burger.groups[0]!.options;
    try {
      await prisma.modifierOption.updateMany({ where: { id: { in: options.map((o) => o.id) } }, data: { sortOrder: 0 } });
      const loaded = (await loadDraftCatalog(prisma, menuId)).products.find((p) => p.id === burger.id)!;
      expect(loaded.groups[0]!.options.map((o) => o.id)).toEqual(options.map((o) => o.id).sort());
    } finally {
      for (const option of options) {
        await prisma.modifierOption.update({ where: { id: option.id }, data: { sortOrder: option.sortOrder } });
      }
    }
  });

  it('reads only the menu it is given, on a scoped client and in a transaction', async () => {
    const other = await createMenuFixture(prisma, 'loader-other');
    const scoped = await loadDraftCatalog(menuDb(prisma, menuId), menuId);
    expect(scoped.products).toHaveLength(24);
    const inTx = await prisma.$transaction((tx) => loadDraftCatalog(tx, other.menu.id));
    expect(inTx.products.map((p) => p.id)).toEqual([other.product.id]);
    // A client scoped to another menu sees none of this one's rows.
    expect((await loadDraftCatalog(menuDb(prisma, other.menu.id), menuId)).products).toEqual([]);
  });

  it('records analytics events scoped to the tenant', async () => {
    const stored = await recordEvents(prisma, menuId, {
      anonymousSessionId: 'session-12345',
      tableNumber: 4,
      events: [
        { type: 'MENU_VIEW', payload: {} },
        { type: 'UPSELL_IMPRESSION', productId: 'p1', suggestionId: 'up:p1:OPTION:o1', payload: { position: 0 } },
      ],
    });
    expect(stored).toBe(2);
    const rows = await prisma.analyticsEvent.findMany({ where: { menuId } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.tableNumber === 4)).toBe(true);
  });
});
