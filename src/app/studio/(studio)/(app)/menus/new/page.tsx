import { ChevronLeft, Store } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { hostEnv } from '@/server/env';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { newMenuOptions } from '@/server/studio/queries/menus';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { NewMenuForm } from './NewMenuForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('menus.new') };
}

/**
 * A new menu, for someone who may create menus in at least one restaurant (anyone else gets the not-found page). A
 * restaurant named in the address (`?restaurant=`) is chosen to start with.
 */
export default async function NewMenuPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const options = await query(newMenuOptions, {});
  const t = getStudioTranslator(actor.locale);
  const requested = (await searchParams).restaurant;
  const preselected = options.restaurants.find((restaurant) => restaurant.id === requested)?.id ?? options.restaurants[0]?.id ?? '';

  return (
    <>
      <PageHeader
        above={
          <Link href="/studio/menus" className="inline-flex w-fit items-center gap-1 text-sm text-muted transition-colors hover:text-text">
            <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
            {t('menus.title')}
          </Link>
        }
        title={t('menus.new')}
        description={t('menus.form.description')}
      />
      <div className="px-8 pb-2">
        {options.restaurants.length === 0 ? (
          <EmptyState
            icon={<Store aria-hidden />}
            title={t('menus.form.noRestaurantsTitle')}
            body={t('menus.form.noRestaurantsBody')}
            action={
              <Link href="/studio/restaurants/new" className={buttonClasses('primary')}>
                {t('restaurants.new')}
              </Link>
            }
          />
        ) : (
          <NewMenuForm
            restaurants={options.restaurants}
            restaurantId={preselected}
            defaults={options.defaults}
            currencies={options.currencies}
            timeZones={options.timeZones}
            origin={hostEnv().publicOrigin}
          />
        )}
      </div>
    </>
  );
}
