import { notFound } from 'next/navigation';
import { getPrisma } from '@/server/data/prisma';
import { menuDb } from '@/server/data/tenant-db';
import { searchString, withPublicMenu, type SearchParams } from '@/server/public-page';
import { loadMenuView } from '@/server/route-context';
import { RouteTable } from '@/ui/AppProviders';
import { MenuApp } from '@/ui/menu/MenuApp';
import { TemplateMenu } from '@/ui/template/TemplateMenu';

const TABLE_NUMBER = /^\d{1,3}$/;

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; locale: string; table: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const raw = await params;
  return withPublicMenu(raw, `/t/${encodeURIComponent(raw.table)}`, searchString(await searchParams), async (route) => {
    if (!TABLE_NUMBER.test(raw.table)) notFound();

    const number = Number(raw.table);
    if (number < 1) notFound();
    const table = await menuDb(getPrisma(), route.tenant.id).table.findFirst({ where: { number } });
    if (!table) notFound();

    const view = await loadMenuView(route);
    const { design } = route.tenant.brand;
    return (
      <>
        <RouteTable number={number} />
        {design ? (
          <TemplateMenu view={view} design={design} tagline={route.tenant.seo[route.locale]?.description || undefined} />
        ) : (
          <MenuApp view={view} />
        )}
      </>
    );
  });
}
