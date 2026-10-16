import { Plus, UtensilsCrossed } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { hostEnv } from '@/server/env';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { listMenus } from '@/server/studio/queries/menus';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { Pagination } from '@/studio/ui/Pagination';
import { LIST_PARAMS, listInput } from './list-params';
import { MenuFilters } from './MenuFilters';
import { MenusTable } from './MenusTable';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('menus.title') };
}

/**
 * Every menu the person may see, for 1,000 menus and more: search, filters, sorting and paging run on the server, and
 * all of it lives in the address (`q`, `status`, `city`, `restaurant`, `createdFrom`, `createdTo`, `unpublished`,
 * `sort`, `dir`, `page`), so a filtered list is a link. Selected rows can be published, suspended, archived or restored
 * together.
 */
export default async function MenusPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const input = listInput(await searchParams);
  const list = await query(listMenus, input);
  const filtered = LIST_PARAMS.some((name) => name in input || (name === 'restaurant' && 'restaurantId' in input));
  const newMenu = (
    <Link href="/studio/menus/new" className={buttonClasses('primary')}>
      <Plus aria-hidden />
      {t('menus.new')}
    </Link>
  );

  return (
    <>
      <PageHeader
        title={t('menus.title')}
        description={actor.isSuperAdmin ? t('menus.description') : t('menus.descriptionScoped')}
        actions={list.canCreate ? newMenu : undefined}
      />
      <div className="flex flex-col gap-4 px-8 pb-10">
        {list.total === 0 && !filtered ? (
          <EmptyState
            icon={<UtensilsCrossed aria-hidden />}
            title={t('menus.list.emptyTitle')}
            body={list.canCreate ? t('menus.list.emptyBody') : t('menus.list.emptyBodyReadOnly')}
            action={list.canCreate ? newMenu : undefined}
          />
        ) : (
          <>
            <MenuFilters cities={list.cities} restaurants={list.restaurants} />
            <MenusTable
              rows={list.rows}
              sort={input.sort}
              dir={input.dir}
              origin={hostEnv().publicOrigin}
              duplicateTargets={actor.isSuperAdmin ? list.restaurants : []}
            />
            <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
          </>
        )}
      </div>
    </>
  );
}
