import { notFound } from 'next/navigation';
import { loadMenuView, resolveRoute } from '@/server/route-context';
import { ProductPage } from '@/ui/product/ProductPage';

export default async function Page({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; slug: string }>;
}) {
  const raw = await params;
  const route = await resolveRoute(raw);
  if (!route) notFound();
  const view = await loadMenuView(route);
  const product = view.products.find((candidate) => candidate.slug === raw.slug);
  if (!product) notFound();
  return <ProductPage product={product} view={view} />;
}
