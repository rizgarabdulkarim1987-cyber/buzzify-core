import type { Metadata } from 'next';
import { hostEnv } from '@/server/env';
import { resolvePublicRoute, searchString, withPublicMenu, type SearchParams } from '@/server/public-page';
import { loadMenuView } from '@/server/route-context';
import { menuAlternates } from '@/server/seo';
import { MenuApp } from '@/ui/menu/MenuApp';
import { TemplateMenu } from '@/ui/template/TemplateMenu';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}): Promise<Metadata> {
  const resolved = await resolvePublicRoute(await params);
  // The menu's home names its translations; anything but a live menu takes its title and robots tag from the layout.
  if (resolved.kind !== 'live') return {};
  const { tenant, locale } = resolved.route;
  return { alternates: menuAlternates(hostEnv().publicOrigin, tenant, locale) };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  return withPublicMenu(await params, '', searchString(await searchParams), async (route) => {
    const view = await loadMenuView(route);
    const { design } = route.tenant.brand;
    if (design) return <TemplateMenu view={view} design={design} tagline={route.tenant.seo[route.locale]?.description || undefined} />;
    return <MenuApp view={view} />;
  });
}
