import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslator } from '@/lib/messages';
import { resolveRoute } from '@/server/route-context';
import { CartView } from '@/ui/cart/CartView';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}): Promise<Metadata> {
  const route = await resolveRoute(await params);
  return { title: route ? getTranslator(route.locale)('cart.title') : 'Not found' };
}

export default async function Page({ params }: { params: Promise<{ tenant: string; locale: string }> }) {
  const route = await resolveRoute(await params);
  if (!route) notFound();
  return <CartView />;
}
