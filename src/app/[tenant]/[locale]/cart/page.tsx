import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslator } from '@/lib/messages';
import { resolvePublicRoute, searchString, withPublicMenu, type SearchParams } from '@/server/public-page';
import { CartView } from '@/ui/cart/CartView';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}): Promise<Metadata> {
  const resolved = await resolvePublicRoute(await params);
  // Anything but a live menu takes its title and robots tag from the layout.
  return resolved.kind === 'live' ? { title: getTranslator(resolved.route.locale)('cart.title') } : {};
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const raw = await params;
  return withPublicMenu(raw, '/cart', searchString(await searchParams), async (route) => {
    // A menu without ordering has no cart at all.
    if (route.tenant.brand.design?.ordering === 'none') redirect(`/${route.tenant.slug}/${route.locale}`);
    return <CartView />;
  });
}
