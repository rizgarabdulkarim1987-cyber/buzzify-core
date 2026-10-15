import { notFound } from 'next/navigation';
import { resolveRoute } from '@/server/route-context';
import { CartView } from '@/ui/cart/CartView';

export default async function Page({ params }: { params: Promise<{ tenant: string; locale: string }> }) {
  const route = await resolveRoute(await params);
  if (!route) notFound();
  return <CartView />;
}
