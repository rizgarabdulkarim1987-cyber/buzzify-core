import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import * as motionQueries from '@/server/studio/queries/motions';
import { MotionPlaces } from '@/studio/workspace/motion/MotionPlaces';
import { tabMetadata } from '../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'motion');
}

/** The Motion tab: motions from the library at the menu's places, the top, the signature dish and each category. */
export default async function MotionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await query(motionQueries.list, { menuId: id });
  return <MotionPlaces menuId={id} view={view} />;
}
