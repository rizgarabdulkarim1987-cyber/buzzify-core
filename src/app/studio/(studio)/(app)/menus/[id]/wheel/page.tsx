import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import * as wheelQueries from '@/server/studio/queries/wheel';
import { WheelForm } from '@/studio/workspace/wheel/WheelForm';
import { tabMetadata } from '../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'wheel');
}

/** The Wheel tab: the wheel of fortune on the menu's Explore page, its dishes and its rules. */
export default async function WheelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await query(wheelQueries.menuWheel, { menuId: id });
  return <WheelForm menuId={id} view={view} />;
}
