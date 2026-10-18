import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import * as salesQueries from '@/server/studio/queries/sales';
import { SalesSettingsForm } from '@/studio/workspace/sales/SalesSettingsForm';
import { tabMetadata } from '../../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'sales');
}

export default async function SalesSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await query(salesQueries.settings, { menuId: id });
  return <SalesSettingsForm menuId={id} view={view} />;
}
