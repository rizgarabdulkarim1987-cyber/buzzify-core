import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import * as aboutQueries from '@/server/studio/queries/about';
import * as wheelQueries from '@/server/studio/queries/wheel';
import { AboutForm } from '@/studio/workspace/about/AboutForm';
import { WheelForm } from '@/studio/workspace/wheel/WheelForm';
import { tabMetadata } from '../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'about');
}

/**
 * The Explore tab: the restaurant's own page inside the menu (guests see it as "Explore" unless it names it otherwise), its offers, and the
 * wheel of fortune that sits on the same page.
 */
export default async function AboutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [about, wheel] = await Promise.all([query(aboutQueries.menuAbout, { menuId: id }), query(wheelQueries.menuWheel, { menuId: id })]);
  return (
    <>
      <AboutForm menuId={id} view={about} />
      <WheelForm menuId={id} view={wheel} />
    </>
  );
}
