import type { Metadata } from 'next';
import type { Permission } from '@/server/domain/permissions';
import { query } from '@/server/studio/framework/invoke';
import * as storyQueries from '@/server/studio/queries/stories';
import { StoriesEditor } from '@/studio/workspace/sales/StoriesEditor';
import { loadMenu, tabMetadata } from '../../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'sales');
}

export default async function SalesStoriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const menu = await loadMenu(id);
  const view = await query(storyQueries.menuStories, { menuId: id });
  return <StoriesEditor menuId={id} view={view} canEdit={(menu.permissions as Permission[]).includes('content.edit')} />;
}
