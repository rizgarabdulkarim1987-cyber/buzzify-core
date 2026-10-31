import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatMoney } from '@/server/domain/money';
import { tvSeconds, tvSlides } from '@/server/domain/tv-board';
import { resolvePublicRoute, searchString, withPublicMenu, type SearchParams } from '@/server/public-page';
import { loadMenuView } from '@/server/route-context';
import { TvBoard, type TvPage } from '@/ui/tv/TvBoard';

/** The board is a sign for a wall, not a page to find: it stays out of search results. */
export async function generateMetadata({ params }: { params: Promise<{ tenant: string; locale: string }> }): Promise<Metadata> {
  const resolved = await resolvePublicRoute(await params);
  if (resolved.kind !== 'live') return {};
  return { title: { absolute: resolved.route.tenant.name }, robots: { index: false } };
}

export default async function Page({ params, searchParams }: { params: Promise<{ tenant: string; locale: string }>; searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const seconds = query.seconds;
  return withPublicMenu(await params, '/tv', searchString(query), async (route) => {
    // A plan without the board: the page does not exist.
    if (!route.tenant.features.tvBoard) notFound();
    const view = await loadMenuView(route);
    const { currency, numeralSystem } = view.restaurant;
    const symbol = view.priceStyle !== 'plain';
    // Only what the screen draws goes to the browser: no choices, badges or sales data.
    const pages: TvPage[] = tvSlides(view.categories, view.products).map((slide) => ({
      key: `${slide.categoryId}:${slide.page}`,
      name: slide.name,
      page: slide.page,
      pages: slide.pages,
      dishes: slide.products.map((product) => ({
        id: product.id,
        slug: product.slug,
        name: product.name,
        price: formatMoney(product.displayPrice, currency, route.locale, numeralSystem, { symbol }),
        media: product.media,
      })),
    }));
    return <TvBoard pages={pages} seconds={tvSeconds(typeof seconds === 'string' ? seconds : undefined)} />;
  });
}
