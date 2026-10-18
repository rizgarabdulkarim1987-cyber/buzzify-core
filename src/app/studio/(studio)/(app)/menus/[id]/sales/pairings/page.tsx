import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import * as salesQueries from '@/server/studio/queries/sales';
import { PairingsEditor } from '@/studio/workspace/sales/PairingsEditor';
import { tabMetadata } from '../../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'sales');
}

export default async function SalesPairingsEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rules = await query(salesQueries.rules, { menuId: id });
  return <PairingsEditor menuId={id} rules={rules} />;
}
