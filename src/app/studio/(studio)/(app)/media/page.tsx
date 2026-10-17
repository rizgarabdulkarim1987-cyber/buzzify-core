import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { libraries as librariesQuery, listMedia } from '@/server/studio/queries/media';
import { MEDIA_PAGE_SIZE } from '@/server/studio/services/media';
import { MediaLibrary } from '@/studio/media/MediaLibrary';
import { getStudioTranslator } from '@/studio/messages';
import { isOwnerOnly } from '@/studio/nav';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (typeof value === 'string' && value !== '' ? value : undefined);
const SHARED = 'shared';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('media.library.title') };
}

/**
 * The Media page: the libraries a person manages, one at a time — each restaurant's where they hold `media.manage`, and
 * the shared one (Super Admins change it; everyone else browses it). An owner's pictures are picked where they are used.
 */
export default async function MediaPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  if (isOwnerOnly(actor)) redirect('/studio');
  const t = getStudioTranslator(actor.locale);
  const filters = await searchParams;
  const { restaurants, sharedEditable } = await query(librariesQuery, {});

  // The library in the address, if it is one the person may manage; else their first restaurant's, else the shared one.
  const asked = one(filters.library);
  const library = asked === SHARED || restaurants.some((restaurant) => restaurant.id === asked) ? asked! : (restaurants[0]?.id ?? SHARED);
  const restaurantId = library === SHARED ? null : library;
  const page = Math.max(1, Number(one(filters.page)) || 1);
  const folder = one(filters.folder);
  const tag = one(filters.tag);
  const q = one(filters.q);
  const list = await query(listMedia, {
    ...(restaurantId ? { restaurantId, own: true } : {}),
    page,
    ...(folder ? { folder } : {}),
    ...(tag ? { tag } : {}),
    ...(q ? { q } : {}),
  });

  return (
    <>
      <PageHeader title={t('media.library.title')} description={t('media.library.intro')} />
      <MediaLibrary
        restaurantId={restaurantId}
        editable={restaurantId !== null || sharedEditable}
        libraries={[...restaurants.map((restaurant) => ({ value: restaurant.id, label: restaurant.name })), { value: SHARED, label: t('media.library.shared') }]}
        selectedLibrary={library}
        list={list}
        page={page}
        pageSize={MEDIA_PAGE_SIZE}
      />
    </>
  );
}
