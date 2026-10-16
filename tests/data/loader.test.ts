import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDraftCatalog } from '@/server/data/catalog-loader';
import { findTenant } from '@/server/data/tenant';
import { recordEvents } from '@/server/data/events';
import { resetTestData, seedAtelier, testPrisma } from '../helpers/db';

const prisma = testPrisma();
let restaurantId = '';
let menuId = '';

describe('data layer (database)', () => {
  beforeAll(async () => {
    await resetTestData(prisma);
    const seeded = await seedAtelier(prisma);
    restaurantId = seeded.restaurant.id;
    menuId = seeded.menuId;
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

  it('resolves a tenant by slug and by host', async () => {
    const bySlug = await findTenant(prisma, { slug: 'atelier' });
    expect(bySlug?.name).toBe('ATELIER');
    expect(bySlug?.locales).toEqual(['en', 'ar', 'ckb']);
    expect(bySlug?.brand.tokens.dark.accent).toBe('#D6BC8A');
    const byHost = await findTenant(prisma, { host: 'atelier.localhost' });
    expect(byHost?.id).toBe(bySlug?.id);
  });

  it('rejects unknown and malformed tenants', async () => {
    expect(await findTenant(prisma, { slug: 'nope' })).toBeNull();
    expect(await findTenant(prisma, { slug: "x'; DROP TABLE" })).toBeNull();
    expect(await findTenant(prisma, { slug: '' })).toBeNull();
    expect(await findTenant(prisma, { host: 'unknown.example' })).toBeNull();
  });

  it('serves only a published menu of an active restaurant', async () => {
    for (const status of ['DRAFT', 'SUSPENDED', 'ARCHIVED'] as const) {
      await prisma.menu.update({ where: { id: menuId }, data: { status } });
      expect(await findTenant(prisma, { slug: 'atelier' }), `menu ${status}`).toBeNull();
      expect(await findTenant(prisma, { host: 'atelier.localhost' }), `menu ${status} by host`).toBeNull();
    }
    await prisma.menu.update({ where: { id: menuId }, data: { status: 'PUBLISHED' } });
    for (const status of ['SUSPENDED', 'ARCHIVED'] as const) {
      await prisma.restaurant.update({ where: { id: restaurantId }, data: { status } });
      expect(await findTenant(prisma, { slug: 'atelier' }), `restaurant ${status}`).toBeNull();
    }
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { status: 'ACTIVE' } });
    expect(await findTenant(prisma, { slug: 'atelier' })).not.toBeNull();
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
