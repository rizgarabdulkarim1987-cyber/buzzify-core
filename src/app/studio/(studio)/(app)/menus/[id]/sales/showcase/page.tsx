import type { Metadata } from 'next';
import type { Permission } from '@/server/domain/permissions';
import { query } from '@/server/studio/framework/invoke';
import * as salesQueries from '@/server/studio/queries/sales';
import { ShowcaseEditor } from '@/studio/workspace/sales/ShowcaseEditor';
import { loadMenu, tabMetadata } from '../../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'sales');
}

export default async function SalesShowcaseEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const menu = await loadMenu(id);
  const rules = await query(salesQueries.rules, { menuId: id });
  return <ShowcaseEditor menuId={id} rules={rules} canEdit={(menu.permissions as Permission[]).includes('content.edit')} />;
}
