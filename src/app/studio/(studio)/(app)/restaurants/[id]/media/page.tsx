import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { query } from '@/server/studio/framework/invoke';
import { listMedia } from '@/server/studio/queries/media';
import { MEDIA_PAGE_SIZE } from '@/server/studio/services/media';
import { MediaLibrary } from '@/studio/media/MediaLibrary';
import { loadRestaurant, tabMetadata } from '../load';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (typeof value === 'string' && value !== '' ? value : undefined);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'media');
}

/** A restaurant's Media tab: its own library, for those who manage it. */
export default async function RestaurantMediaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const [{ id }, filters] = await Promise.all([params, searchParams]);
  const restaurant = await loadRestaurant(id);
  if (!restaurant.can.media) notFound();
  const page = Math.max(1, Number(one(filters.page)) || 1);
  const folder = one(filters.folder);
  const tag = one(filters.tag);
  const q = one(filters.q);
  const list = await query(listMedia, { restaurantId: id, own: true, page, ...(folder ? { folder } : {}), ...(tag ? { tag } : {}), ...(q ? { q } : {}) });
  return <MediaLibrary restaurantId={id} editable libraries={[]} list={list} page={page} pageSize={MEDIA_PAGE_SIZE} />;
}
