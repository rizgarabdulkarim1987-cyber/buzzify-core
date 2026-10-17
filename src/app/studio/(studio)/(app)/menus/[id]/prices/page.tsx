import type { Metadata } from 'next';
import type { Permission } from '@/server/domain/permissions';
import { query } from '@/server/studio/framework/invoke';
import * as priceQueries from '@/server/studio/queries/prices';
import { PriceGrid } from '@/studio/workspace/PriceGrid';
import { loadMenu, tabMetadata } from '../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'prices');
}

/** The Prices tab: every price of the menu, edited in place or changed in bulk from a preview. */
export default async function PricesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [menu, grid] = await Promise.all([loadMenu(id), query(priceQueries.grid, { menuId: id })]);
  return <PriceGrid menuId={id} grid={grid} canBulk={(menu.permissions as Permission[]).includes('prices.bulk')} />;
}
