import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ATELIER } from '../../prisma/seed/atelier';
import { seedRestaurant } from '../../prisma/seed/apply';
import { loadCatalog } from '@/server/data/catalog-loader';
import { findTenant } from '@/server/data/tenant';
import { recordEvents } from '@/server/data/events';
import { resetTestData, testPrisma } from '../helpers/db';

const prisma = testPrisma();
let restaurantId = '';

describe('data layer (database)', () => {
  beforeAll(async () => {
    await resetTestData(prisma);
    restaurantId = (await seedRestaurant(prisma, ATELIER)).restaurantId;
  });
  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('loads the full ATELIER catalog into domain types', async () => {
    const catalog = await loadCatalog(prisma, restaurantId);
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

  it('resolves a tenant by slug and by host', async () => {
    const bySlug = await findTenant(prisma, { slug: 'atelier' });
    expect(bySlug?.name).toBe('ATELIER');
    expect(bySlug?.locales).toEqual(['en', 'ar', 'ckb']);
    expect(bySlug?.brand.tokens.dark.accent).toBe('#D6BC8A');
    const byHost = await findTenant(prisma, { host: 'atelier.localhost' });
    expect(byHost?.id).toBe(bySlug?.id);
  });

  it('rejects unknown, malformed and suspended tenants', async () => {
    expect(await findTenant(prisma, { slug: 'nope' })).toBeNull();
    expect(await findTenant(prisma, { slug: "x'; DROP TABLE" })).toBeNull();
    expect(await findTenant(prisma, { slug: '' })).toBeNull();
    expect(await findTenant(prisma, { host: 'unknown.example' })).toBeNull();
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { status: 'SUSPENDED' } });
    expect(await findTenant(prisma, { slug: 'atelier' })).toBeNull();
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { status: 'ACTIVE' } });
  });

  it('records analytics events scoped to the tenant', async () => {
    const stored = await recordEvents(prisma, restaurantId, {
      anonymousSessionId: 'session-12345',
      tableNumber: 4,
      events: [
        { type: 'MENU_VIEW', payload: {} },
        { type: 'UPSELL_IMPRESSION', productId: 'p1', suggestionId: 'up:p1:OPTION:o1', payload: { position: 0 } },
      ],
    });
    expect(stored).toBe(2);
    const rows = await prisma.analyticsEvent.findMany({ where: { restaurantId } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.tableNumber === 4)).toBe(true);
  });
});
