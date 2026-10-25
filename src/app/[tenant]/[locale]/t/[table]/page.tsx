import { notFound } from 'next/navigation';
import { getPrisma } from '@/server/data/prisma';
import { menuDb } from '@/server/data/tenant-db';
import { searchString, withPublicMenu, type SearchParams } from '@/server/public-page';
import { complaintGate } from '@/server/pos/complaints-guest';
import { loadMenuView } from '@/server/route-context';
import { RouteTable } from '@/ui/AppProviders';
import { MenuApp } from '@/ui/menu/MenuApp';
import { COMPLAINT_LINK } from './complaint/words';

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
    // The complaint page exists only when the restaurant turned it on; the link follows the same gate.
    const complaints = (await complaintGate(getPrisma(), route.tenant, number)).open;
    return (
      <>
        <RouteTable number={number} />
        <MenuApp view={view} />
        {complaints ? (
          <p className="px-4 pb-8 text-center text-sm">
            <a className="inline-flex min-h-12 items-center text-muted underline" href={`/${route.tenant.slug}/${route.locale}/t/${number}/complaint`}>
              {COMPLAINT_LINK(route.locale)}
            </a>
          </p>
        ) : null}
      </>
    );
  });
}
