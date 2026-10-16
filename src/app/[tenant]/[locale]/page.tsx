import { searchString, withPublicMenu, type SearchParams } from '@/server/public-page';
import { loadMenuView } from '@/server/route-context';
import { MenuApp } from '@/ui/menu/MenuApp';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  return withPublicMenu(await params, '', searchString(await searchParams), async (route) => {
    const view = await loadMenuView(route);
    return <MenuApp view={view} />;
  });
}
