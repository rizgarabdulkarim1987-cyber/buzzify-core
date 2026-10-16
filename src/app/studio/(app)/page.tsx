import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { myRestaurants } from '@/server/studio/queries/account';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { isolated } from '@/studio/ui/isolate';
import { PageHeader } from '@/studio/ui/PageHeader';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('overview.title') };
}

/**
 * The Studio's home. Until the Overview screen is built (its counts, schedules and activity), it greets the person and
 * lists the restaurants they belong to, each linking to where the navigation sends them.
 */
export default async function OverviewPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const restaurants = actor.isSuperAdmin ? [] : await query(myRestaurants, {});

  return (
    <>
      <PageHeader title={isolated(t('overview.welcome'), { name: actor.name })} description={t('overview.intro')} />
      {restaurants.length > 0 && (
        <section aria-labelledby="your-restaurants" className="px-8 pb-10">
          <h2 id="your-restaurants" className="mb-3 text-sm font-medium text-muted">
            {t('overview.yourRestaurants')}
          </h2>
          <ul className="max-w-3xl divide-y divide-line border-y border-line">
            {restaurants.map((restaurant) => (
              <li key={restaurant.id}>
                <Link
                  href={
                    restaurant.menus.length === 1 && restaurants.length === 1
                      ? `/studio/menus/${restaurant.menus[0]!.id}`
                      : `/studio/restaurants/${restaurant.id}`
                  }
                  className="flex h-12 items-center justify-between gap-4 px-1 transition-colors hover:bg-surface"
                >
                  <span className="truncate text-base font-medium text-text">{restaurant.name}</span>
                  <span className="shrink-0 text-sm text-muted">{t(`role.${restaurant.role}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
