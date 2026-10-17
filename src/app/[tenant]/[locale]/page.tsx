import type { Metadata } from 'next';
import { hostEnv } from '@/server/env';
import { resolvePublicRoute, searchString, withPublicMenu, type SearchParams } from '@/server/public-page';
import { loadMenuView } from '@/server/route-context';
import { menuAlternates } from '@/server/seo';
import { MenuApp } from '@/ui/menu/MenuApp';

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
    return <MenuApp view={view} />;
  });
}
