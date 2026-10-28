import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslator } from '@/lib/messages';
import { loadAbout } from '@/server/data/about';
import { resolvePublicRoute, searchString, withPublicMenu, type SearchParams } from '@/server/public-page';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}): Promise<Metadata> {
  const resolved = await resolvePublicRoute(await params);
  if (resolved.kind !== 'live') return {};
  const { tenant, locale } = resolved.route;
  const custom = tenant.extras?.aboutTitle?.[locale]?.trim();
  return { title: custom || getTranslator(locale)('about.title') };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const search = searchString(await searchParams);
  return withPublicMenu(await params, '/about', search, async (route) => {
    // Off, not in the plan, or nothing filled in: the page does not exist, so it answers like any other missing page.
    const view = await loadAbout(route);
    if (!view) notFound();
    return <main><h1>{view.title}</h1></main>;
  });
}
