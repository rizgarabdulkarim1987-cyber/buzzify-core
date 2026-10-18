import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { query } from '@/server/studio/framework/invoke';
import * as motionQueries from '@/server/studio/queries/motions';
import { MotionPlaceEditor } from '@/studio/workspace/motion/MotionPlaceEditor';
import { placeBySegment } from '@/studio/workspace/motion/places';
import { tabMetadata } from '../../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'motion');
}

/** Choosing and tuning the motion of one place: `hero`, `signature` or `category-<categoryId>`. */
export default async function MotionPlacePage({ params }: { params: Promise<{ id: string; place: string }> }) {
  const { id, place: segment } = await params;
  const view = await query(motionQueries.list, { menuId: id });
  const place = placeBySegment(view, segment);
  if (!place) notFound();
  return <MotionPlaceEditor key={place.motion?.version ?? 0} menuId={id} view={view} place={place} />;
}
