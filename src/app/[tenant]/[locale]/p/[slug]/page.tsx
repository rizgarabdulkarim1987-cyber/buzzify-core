import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { env } from '@/server/env';
import { resolvePublicRoute, searchString, withPublicMenu, type SearchParams } from '@/server/public-page';
import { loadMenuView } from '@/server/route-context';
import { menuAlternates } from '@/server/seo';
import { ProductPage } from '@/ui/product/ProductPage';

type Params = Promise<{ tenant: string; locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const raw = await params;
  const resolved = await resolvePublicRoute(raw);
  if (resolved.kind !== 'live') return {};

  const { route } = resolved;
  const view = await loadMenuView(route);
  const product = view.products.find((candidate) => candidate.slug === raw.slug);
  if (!product) return { title: 'Not found' };
  // The product's own address is canonical, not the menu's (which the layout names).
  return {
    title: product.name,
    alternates: menuAlternates(env().publicOrigin, route.tenant, route.locale, `/p/${encodeURIComponent(raw.slug)}`),
  };
}

export default async function Page({ params, searchParams }: { params: Params; searchParams: Promise<SearchParams> }) {
  const raw = await params;
  return withPublicMenu(raw, `/p/${encodeURIComponent(raw.slug)}`, searchString(await searchParams), async (route) => {
    const view = await loadMenuView(route);
    const product = view.products.find((candidate) => candidate.slug === raw.slug);
    if (!product) notFound();
    return <ProductPage product={product} view={view} />;
  });
}
