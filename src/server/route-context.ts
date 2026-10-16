import { buildMenuView, type MenuView } from '@/server/data/menu-view';
import { getCatalog } from '@/server/data/public-menu';
import type { TenantInfo } from '@/server/data/tenant';
import type { Locale } from '@/lib/locale';

export interface RouteContext {
  tenant: TenantInfo;
  locale: Locale;
}

/** The menu page's data: the live revision with today's availability, in the route's language. */
export async function loadMenuView(route: RouteContext): Promise<MenuView> {
  const catalog = await getCatalog(route.tenant);
  return buildMenuView(catalog, route.tenant, route.locale, new Date());
}
