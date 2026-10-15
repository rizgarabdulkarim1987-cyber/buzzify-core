import { getCatalog } from '@/server/data/catalog-loader';
import { buildMenuView, type MenuView } from '@/server/data/menu-view';
import { getTenant, type TenantInfo } from '@/server/data/tenant';
import { isLocale, type Locale } from '@/lib/locale';

export interface RouteContext {
  tenant: TenantInfo;
  locale: Locale;
}

/** Returns null for an unknown restaurant, an unsupported locale, or a locale the restaurant does not offer. */
export async function resolveRoute(params: { tenant: string; locale: string }): Promise<RouteContext | null> {
  if (!isLocale(params.locale)) return null;
  const tenant = await getTenant(params.tenant);
  if (!tenant || !tenant.locales.includes(params.locale)) return null;
  return { tenant, locale: params.locale };
}

export async function loadMenuView(route: RouteContext): Promise<MenuView> {
  const catalog = await getCatalog(route.tenant.id);
  return buildMenuView(catalog, route.tenant, route.locale, new Date());
}
