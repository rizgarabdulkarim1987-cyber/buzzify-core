import { Store } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MENU_STATUSES } from '@/server/domain/menu-status';
import { RESTAURANT_STATUSES } from '@/server/domain/restaurant-profile';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { myRestaurants } from '@/server/studio/queries/account';
import { overview } from '@/server/studio/queries/overview';
import { formatBytes, formatDate, formatDateTime, numberFormat } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { isOwnerOnly, landingPath } from '@/studio/nav';
import { requestStudioLocale } from '@/studio/request-locale';
import { RecentActivity, Tally } from './OverviewParts';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { isolated } from '@/studio/ui/isolate';
import { PageHeader } from '@/studio/ui/PageHeader';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('overview.title') };
}

/**
 * The Studio's home. An owner of one restaurant goes straight to it (their menu when it has one, as their navigation
 * does); an owner of several sees them listed. Everyone else sees, within the restaurants they may open, how many
 * restaurants and menus there are by status, the menus with changes guests do not see yet, and how often menus were
 * opened in the last 7 days. Super Admins also see the newest activity.
 */
export default async function OverviewPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const locale = actor.locale;

  if (isOwnerOnly(actor)) {
    const restaurants = await query(myRestaurants, {});
    const landing = landingPath(
      actor,
      restaurants.map((restaurant) => ({ id: restaurant.id, name: restaurant.name, menuIds: restaurant.menus.map((menu) => menu.id) })),
    );
    if (landing) redirect(landing);
    return (
      <>
        <PageHeader title={isolated(t('overview.welcome'), { name: actor.name })} description={t('overview.yourRestaurants')} />
        <section aria-label={t('overview.yourRestaurants')} className="px-8 pb-10">
          <ul className="max-w-3xl divide-y divide-line border-y border-line">
            {restaurants.map((restaurant) => (
              <li key={restaurant.id}>
                <Link
                  href={`/studio/restaurants/${restaurant.id}/menus`}
                  className="flex h-12 items-center justify-between gap-4 px-1 transition-colors hover:bg-surface"
                >
                  <span dir="auto" className="truncate text-base font-medium text-text">
                    {restaurant.name}
                  </span>
                  <span className="shrink-0 text-sm text-muted">{t(`role.${restaurant.role}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </>
    );
  }

  const data = await query(overview, {});
  const restaurantTotal = RESTAURANT_STATUSES.reduce((sum, status) => sum + data.restaurants[status], 0);
  const menuTotal = MENU_STATUSES.reduce((sum, status) => sum + data.menus[status], 0);
  const number = numberFormat(locale);

  return (
    <>
      <PageHeader title={isolated(t('overview.welcome'), { name: actor.name })} description={t('overview.intro')} />
      <div className="flex flex-col gap-8 px-8 pb-10">
        {restaurantTotal === 0 ? (
          <EmptyState
            icon={<Store aria-hidden />}
            title={actor.isSuperAdmin ? t('overview.noRestaurants.title') : t('restaurants.list.emptyTitle')}
            body={actor.isSuperAdmin ? t('overview.noRestaurants.body') : t('restaurants.list.emptyBodyScoped')}
            action={
              actor.isSuperAdmin ? (
                <Link href="/studio/restaurants/new" className={buttonClasses('primary')}>
                  {t('restaurants.new')}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Tally
                title={t('overview.restaurants')}
                total={restaurantTotal}
                locale={locale}
                parts={RESTAURANT_STATUSES.map((status) => ({
                  label: t(`status.${status.toLowerCase()}`),
                  count: data.restaurants[status],
                  href: `/studio/restaurants?status=${status}`,
                }))}
              />
              <Tally
                title={t('overview.menus')}
                total={menuTotal}
                locale={locale}
                parts={MENU_STATUSES.map((status) => ({
                  label: t(`status.${status.toLowerCase()}`),
                  count: data.menus[status],
                  href: `/studio/menus?status=${status}`,
                }))}
              />
              <section aria-label={t('overview.views')} className="flex flex-col gap-1 rounded-lg border border-line p-5">
                <h2 className="text-sm font-medium text-muted">{t('overview.views')}</h2>
                <p className="text-3xl font-semibold tabular-nums text-text">{number.format(data.viewsLast7Days)}</p>
                <p className="text-sm text-muted">{t('overview.viewsPeriod')}</p>
              </section>
              <section aria-label={t('overview.storage')} className="flex flex-col gap-1 rounded-lg border border-line p-5">
                <h2 className="text-sm font-medium text-muted">{t('overview.storage')}</h2>
                <p className="text-3xl font-semibold tabular-nums text-text">{formatBytes(data.storageBytes, locale)}</p>
                <Link href="/studio/media" className="w-fit text-sm text-muted underline-offset-2 transition-colors hover:text-text hover:underline">
                  {t('overview.storageLink')}
                </Link>
              </section>
            </div>

            <div className={data.recentActivity ? 'grid gap-10 xl:grid-cols-2' : 'max-w-3xl'}>
              <section aria-labelledby="unpublished-title" className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <h2 id="unpublished-title" className="text-md font-semibold text-text">
                    {t('overview.unpublished.title')}
                  </h2>
                  <p className="text-sm text-muted">{t('overview.unpublished.intro')}</p>
                </div>
                {data.unpublished.length === 0 ? (
                  <p className="border-y border-line py-6 text-base text-muted">{t('overview.unpublished.empty')}</p>
                ) : (
                  <>
                    <ul className="divide-y divide-line border-y border-line">
                      {data.unpublished.map((menu) => (
                        <li key={menu.menuId}>
                          <Link
                            href={`/studio/menus/${menu.menuId}`}
                            className="flex items-center justify-between gap-4 px-1 py-2.5 transition-colors hover:bg-surface"
                          >
                            <span className="flex min-w-0 flex-col">
                              <span dir="auto" className="truncate text-base font-medium text-text">
                                {menu.name}
                              </span>
                              <span dir="auto" className="truncate text-sm text-muted">
                                {menu.restaurantName}
                              </span>
                            </span>
                            <time dateTime={menu.updatedAt} className="shrink-0 whitespace-nowrap text-sm text-muted">
                              {formatDate(menu.updatedAt, locale)}
                            </time>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <Link
                      href="/studio/menus?unpublished=1"
                      className="w-fit text-sm text-muted underline-offset-2 transition-colors hover:text-text hover:underline"
                    >
                      {t('overview.unpublished.all')}
                    </Link>
                  </>
                )}
              </section>

              {data.recentActivity && <RecentActivity rows={data.recentActivity} t={t} locale={locale} />}

              {data.scheduled.length > 0 && (
                <section aria-labelledby="scheduled-title" className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <h2 id="scheduled-title" className="text-md font-semibold text-text">
                      {t('overview.scheduled.title')}
                    </h2>
                    <p className="text-sm text-muted">{t('overview.scheduled.intro')}</p>
                  </div>
                  <ul className="divide-y divide-line border-y border-line">
                    {data.scheduled.map((entry) => (
                      <li key={`${entry.menuId}:${entry.number}`}>
                        <Link
                          href={`/studio/menus/${entry.menuId}/revisions`}
                          className="flex items-center justify-between gap-4 px-1 py-2.5 transition-colors hover:bg-surface"
                        >
                          <span className="flex min-w-0 flex-col">
                            <span dir="auto" className="truncate text-base font-medium text-text">
                              {entry.menuName}
                            </span>
                            <span dir="auto" className="truncate text-sm text-muted">
                              {entry.restaurantName} · {t('overview.scheduled.revision', { number: number.format(entry.number) })}
                            </span>
                          </span>
                          <time dateTime={entry.goLiveAt} className="shrink-0 whitespace-nowrap text-sm text-text">
                            {formatDateTime(entry.goLiveAt, locale)}
                          </time>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
