import { Plus, Store } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { listRestaurants } from '@/server/studio/queries/restaurants';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { Pagination } from '@/studio/ui/Pagination';
import { LIST_PARAMS, listInput } from './list-params';
import { RestaurantFilters } from './RestaurantFilters';
import { RestaurantsTable } from './RestaurantsTable';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('restaurants.title') };
}

/**
 * Every restaurant the person may see, with search, filters and sorting. All of it lives in the address (`q`, `city`,
 * `type`, `status`, `createdFrom`, `createdTo`, `sort`, `dir`, `page`), which the server reads, so the page is a plain
 * server render and a filtered list is a link.
 */
export default async function RestaurantsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const input = listInput(await searchParams);
  const list = await query(listRestaurants, input);
  const filtered = LIST_PARAMS.some((name) => name in input);

  return (
    <>
      <PageHeader
        title={t('restaurants.title')}
        description={actor.isSuperAdmin ? t('restaurants.description') : t('restaurants.descriptionScoped')}
        actions={
          list.canCreate ? (
            <Link href="/studio/restaurants/new" className={buttonClasses('primary')}>
              <Plus aria-hidden />
              {t('restaurants.new')}
            </Link>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-4 px-8 pb-10">
        {list.total === 0 && !filtered ? (
          <EmptyState
            icon={<Store aria-hidden />}
            title={t('restaurants.list.emptyTitle')}
            body={list.canCreate ? t('restaurants.list.emptyBody') : t('restaurants.list.emptyBodyScoped')}
            action={
              list.canCreate ? (
                <Link href="/studio/restaurants/new" className={buttonClasses('primary')}>
                  <Plus aria-hidden />
                  {t('restaurants.new')}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <RestaurantFilters cities={list.cities} planNames={list.planNames} showSector={!actor.isSuperAdmin} />
            <RestaurantsTable
              rows={list.rows}
              sort={input.sort}
              dir={input.dir}
              planNames={list.planNames}
              canDelete={list.canDelete}
              showSector={!actor.isSuperAdmin}
            />
            <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
          </>
        )}
      </div>
    </>
  );
}
