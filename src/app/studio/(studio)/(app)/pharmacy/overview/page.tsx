import { Pill } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { RESTAURANT_STATUSES } from '@/server/domain/restaurant-profile';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { overview } from '@/server/studio/queries/overview';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { isolated } from '@/studio/ui/isolate';
import { PageHeader } from '@/studio/ui/PageHeader';
import { RecentActivity, Tally } from '../../overview/OverviewParts';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('overview.title') };
}

/** The Pharmacy space's home: how many pharmacies there are by status, and the newest activity on them. */
export default async function PharmacyOverviewPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const locale = actor.locale;
  const data = await query(overview, { space: 'pharmacy' });
  const total = RESTAURANT_STATUSES.reduce((sum, status) => sum + data.restaurants[status], 0);

  return (
    <>
      <PageHeader title={isolated(t('overview.welcome'), { name: actor.name })} description={t('hub.pharmacy')} />
      <div className="flex flex-col gap-8 px-8 pb-10">
        {total === 0 ? (
          <EmptyState
            icon={<Pill aria-hidden />}
            title={t('pharmacies.emptyTitle')}
            body={t('pharmacies.emptyBody')}
            action={
              <Link href="/studio/pharmacy/new" className={buttonClasses('primary')}>
                {t('pharmacies.new')}
              </Link>
            }
          />
        ) : (
          <div className="grid gap-10 xl:grid-cols-2">
            <div className="max-w-md">
              <Tally
                title={t('pharmacies.title')}
                total={total}
                locale={locale}
                parts={RESTAURANT_STATUSES.map((status) => ({
                  label: t(`status.${status.toLowerCase()}`),
                  count: data.restaurants[status],
                  href: `/studio/pharmacy`,
                }))}
              />
            </div>
            {data.recentActivity && <RecentActivity rows={data.recentActivity} t={t} locale={locale} activityHref="/studio/pharmacy/activity" />}
          </div>
        )}
      </div>
    </>
  );
}
