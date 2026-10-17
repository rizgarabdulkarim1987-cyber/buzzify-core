import type { Metadata } from 'next';
import { isLocale } from '@/lib/locale';
import { query } from '@/server/studio/framework/invoke';
import * as revisionQueries from '@/server/studio/queries/revisions';
import { RevisionsTable } from '@/studio/workspace/RevisionsTable';
import { loadMenu, tabMetadata } from '../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'revisions');
}

/** The Revisions tab: what is waiting to go live, and every revision of the menu. */
export default async function RevisionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [menu, list] = await Promise.all([loadMenu(id), query(revisionQueries.list, { menuId: id, page: 1 })]);
  return (
    <RevisionsTable
      menuId={id}
      defaultLocale={isLocale(menu.defaultLocale) ? menu.defaultLocale : 'en'}
      rows={list.rows}
      pending={list.pending}
      timezone={list.timezone}
      draftHash={list.draftHash}
      canRollback={menu.can.rollback}
      canSchedule={menu.can.schedule}
    />
  );
}
