import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import * as salesQueries from '@/server/studio/queries/sales';
import { SalesOverview } from '@/studio/workspace/sales/SalesOverview';
import { tabMetadata } from '../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'sales');
}

/** The Sales tab's Overview: what to fix next, what sells, and how often guests take the suggestions. */
export default async function SalesOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await query(salesQueries.overview, { menuId: id });
  return <SalesOverview menuId={id} view={view} />;
}
