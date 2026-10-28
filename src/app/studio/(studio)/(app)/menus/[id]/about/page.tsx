import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import * as aboutQueries from '@/server/studio/queries/about';
import { AboutForm } from '@/studio/workspace/about/AboutForm';
import { tabMetadata } from '../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'about');
}

/** The About tab: the restaurant's own page inside the menu (guests see it as "Explore" unless it names it otherwise), and its offers. */
export default async function AboutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await query(aboutQueries.menuAbout, { menuId: id });
  return <AboutForm menuId={id} view={view} />;
}
