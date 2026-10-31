import { cachedDishCounts } from '@/server/data/dish-counts';
import { buildMenuView, type MenuView } from '@/server/data/menu-view';
import { cachedMostOrdered } from '@/server/data/most-ordered';
import { getPrisma } from '@/server/data/prisma';
import { getCatalog } from '@/server/data/public-menu';
import { loadStories } from '@/server/data/stories';
import type { TenantInfo } from '@/server/data/tenant';
import { salesSettings } from '@/server/domain/config';
import type { Locale } from '@/lib/locale';

export interface RouteContext {
  tenant: TenantInfo;
  locale: Locale;
}

/**
 * The menu page's data: the live revision with today's availability, in the route's language, and the most ordered
 * dishes when the menu shows them (one cached read an hour), and the dishes' order and view counts when the menu shows them
 * (one cached read a minute), and the running stories when the plan has them (one cached read a minute).
 */
export async function loadMenuView(route: RouteContext): Promise<MenuView> {
  const { tenant } = route;
  const showsMostOrdered = tenant.features.socialProof && salesSettings(tenant.engineConfig).showMostOrdered;
  const [catalog, mostOrdered, dishCounts] = await Promise.all([
    getCatalog(tenant),
    showsMostOrdered ? cachedMostOrdered(getPrisma(), tenant.id) : Promise.resolve([]),
    tenant.extras?.dishCounts ? cachedDishCounts(getPrisma(), tenant.id) : Promise.resolve([]),
  ]);
  const now = new Date();
  const stories = tenant.features.stories ? await loadStories(tenant, route.locale, catalog, now) : [];
  return buildMenuView(catalog, tenant, route.locale, now, { mostOrdered, dishCounts: new Map(dishCounts), stories });
}
