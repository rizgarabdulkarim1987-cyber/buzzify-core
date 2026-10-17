import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import * as availabilityQueries from '@/server/studio/queries/availability';
import { AvailabilityBoard } from '@/studio/workspace/AvailabilityBoard';
import { tabMetadata } from '../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'availability');
}

/** The Availability tab: what guests can order right now, changed live without a publish. */
export default async function AvailabilityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const board = await query(availabilityQueries.board, { menuId: id });
  return <AvailabilityBoard menuId={id} board={board} />;
}
