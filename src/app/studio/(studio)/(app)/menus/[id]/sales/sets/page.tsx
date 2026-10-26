import type { Metadata } from 'next';
import type { Permission } from '@/server/domain/permissions';
import { query } from '@/server/studio/framework/invoke';
import * as salesQueries from '@/server/studio/queries/sales';
import { SetsEditor } from '@/studio/workspace/sales/SetsEditor';
import { loadMenu, tabMetadata } from '../../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'sales');
}

export default async function SalesSetsEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const menu = await loadMenu(id);
  const rules = await query(salesQueries.rules, { menuId: id });
  return <SetsEditor menuId={id} rules={rules} canPrice={(menu.permissions as Permission[]).includes('content.prices')} />;
}
