import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslator } from '@/lib/messages';
import { loadAbout } from '@/server/data/about';
import { aboutAnswer } from '@/server/domain/about';
import { AboutPage } from '@/ui/about/AboutPage';
import { resolvePublicRoute, searchString, withPublicMenu, type SearchParams } from '@/server/public-page';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}): Promise<Metadata> {
  const resolved = await resolvePublicRoute(await params);
  if (resolved.kind !== 'live' || !resolved.route.tenant.extras?.about) return {};
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
    // Off or not in the plan: the page does not exist. On but with nothing left to show: back to the menu, not a dead end.
    const view = await loadAbout(route);
    const answer = aboutAnswer(route.tenant.extras?.about === true, view !== null);
    if (answer === 'missing') notFound();
    if (answer === 'menu' || !view) redirect(`/${route.tenant.slug}/${route.locale}${search}`);
    return <AboutPage view={view} />;
  });
}
