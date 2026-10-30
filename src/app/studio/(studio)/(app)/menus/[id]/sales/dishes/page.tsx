import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import * as salesQueries from '@/server/studio/queries/sales';
import { DishesTable } from '@/studio/workspace/sales/DishesTable';
import { tabMetadata } from '../../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'sales');
}

export default async function SalesDishesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await query(salesQueries.dishes, { menuId: id });
  return <DishesTable menuId={id} view={view} />;
}
