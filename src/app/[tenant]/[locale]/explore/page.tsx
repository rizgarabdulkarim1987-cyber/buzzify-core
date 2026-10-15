import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslator } from '@/lib/messages';
import { loadMenuView, resolveRoute } from '@/server/route-context';
import { ExploreApp } from '@/ui/explore/ExploreApp';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}): Promise<Metadata> {
  const route = await resolveRoute(await params);
  return { title: route ? getTranslator(route.locale)('explore.title') : 'Not found' };
}

export default async function Page({ params }: { params: Promise<{ tenant: string; locale: string }> }) {
  const route = await resolveRoute(await params);
  if (!route) notFound();
  const view = await loadMenuView(route);
  return <ExploreApp view={view} />;
}
