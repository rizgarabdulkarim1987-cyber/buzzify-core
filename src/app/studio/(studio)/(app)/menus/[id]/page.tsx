import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { Permission } from '@/server/domain/permissions';
import { query } from '@/server/studio/framework/invoke';
import * as contentQueries from '@/server/studio/queries/content';
import { CategoryTree } from '@/studio/workspace/content/CategoryTree';
import { visibleTabs } from '@/studio/workspace/tabs';
import { loadMenu, tabMetadata } from './load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'content');
}

/**
 * The Content tab, the menu's own address: its categories and products. Someone who may open the menu but not edit its
 * content lands on the first tab they have instead.
 */
export default async function ContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const menu = await loadMenu(id);
  const permissions = new Set(menu.permissions as Permission[]);
  if (!permissions.has('content.edit')) {
    const first = visibleTabs(permissions)[0];
    redirect(`/studio/menus/${id}${first?.path ?? '/preview'}`);
  }
  const tree = await query(contentQueries.tree, { menuId: id });
  return (
    <CategoryTree
      menuId={id}
      restaurantId={menu.restaurant.id}
      tree={tree}
      canPrice={permissions.has('content.prices')}
      canMedia={permissions.has('content.media')}
    />
  );
}
