import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
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
  const search = searchString(await searchParams);
  return withPublicMenu(await params, '/explore', search, async (route) => {
    // Without Explore in the restaurant's plan, an old link or bookmark opens the menu itself rather than a dead page.
    if (!route.tenant.features.explore) redirect(`/${route.tenant.slug}/${route.locale}${search}`);
    const view = await loadMenuView(route);
    return <ExploreApp view={view} />;
  });
}
