import { notFound } from 'next/navigation';
import { getPrisma } from '@/server/data/prisma';
import { scopedDb } from '@/server/data/tenant-db';
import { loadMenuView, resolveRoute } from '@/server/route-context';
import { RouteTable } from '@/ui/AppProviders';
import { MenuApp } from '@/ui/menu/MenuApp';

const TABLE_NUMBER = /^\d{1,3}$/;

export default async function Page({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; table: string }>;
}) {
  const raw = await params;
  const route = await resolveRoute(raw);
  if (!route || !TABLE_NUMBER.test(raw.table)) notFound();

  const number = Number(raw.table);
  if (number < 1) notFound();
  const table = await scopedDb(getPrisma(), route.tenant.id).table.findFirst({ where: { number } });
  if (!table) notFound();

  const view = await loadMenuView(route);
  return (
    <>
      <RouteTable number={number} />
      <MenuApp view={view} />
    </>
  );
}
