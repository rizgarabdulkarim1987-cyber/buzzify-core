import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import * as salesQueries from '@/server/studio/queries/sales';
import { UpgradesEditor } from '@/studio/workspace/sales/UpgradesEditor';
import { tabMetadata } from '../../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'sales');
}

export default async function SalesUpgradesEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rules = await query(salesQueries.rules, { menuId: id });
  return <UpgradesEditor menuId={id} rules={rules} />;
}
