import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadMenuView, resolveRoute } from '@/server/route-context';
import { ProductPage } from '@/ui/product/ProductPage';

type Params = Promise<{ tenant: string; locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const raw = await params;
  const route = await resolveRoute(raw);
  if (!route) return { title: 'Not found' };
  const view = await loadMenuView(route);
  const product = view.products.find((candidate) => candidate.slug === raw.slug);
  return { title: product?.name ?? 'Not found' };
}

export default async function Page({ params }: { params: Params }) {
  const raw = await params;
  const route = await resolveRoute(raw);
  if (!route) notFound();
  const view = await loadMenuView(route);
  const product = view.products.find((candidate) => candidate.slug === raw.slug);
  if (!product) notFound();
  return <ProductPage product={product} view={view} />;
}
