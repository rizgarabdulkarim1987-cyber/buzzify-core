import { notFound } from 'next/navigation';
import { loadMenuView, resolveRoute } from '@/server/route-context';
import { MenuApp } from '@/ui/menu/MenuApp';

export default async function Page({ params }: { params: Promise<{ tenant: string; locale: string }> }) {
  const route = await resolveRoute(await params);
  if (!route) notFound();
  const view = await loadMenuView(route);
  return <MenuApp view={view} />;
}
