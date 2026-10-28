import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import { menuIntro } from '@/server/studio/queries/intro';
import { IntroForm } from '@/studio/intro/IntroForm';
import { loadMenu, tabMetadata } from '../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'intro');
}

/** The Intro tab: the page guests see before the menu, its background, and the Buzzify adverts on it (read only). */
export default async function IntroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [view, menu] = await Promise.all([query(menuIntro, { menuId: id }), loadMenu(id)]);
  return <IntroForm menuId={id} restaurantId={menu.restaurant.id} slug={menu.slug} view={view} />;
}
