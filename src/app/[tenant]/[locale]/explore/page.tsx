import type { Metadata } from 'next';
import { getTranslator } from '@/lib/messages';
import { resolvePublicRoute, searchString, withPublicMenu, type SearchParams } from '@/server/public-page';
import { loadMenuView } from '@/server/route-context';
import { ExploreApp } from '@/ui/explore/ExploreApp';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}): Promise<Metadata> {
  const resolved = await resolvePublicRoute(await params);
  return resolved.kind === 'live' ? { title: getTranslator(resolved.route.locale)('explore.title') } : {};
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  return withPublicMenu(await params, '/explore', searchString(await searchParams), async (route) => {
    const view = await loadMenuView(route);
    return <ExploreApp view={view} />;
  });
}
