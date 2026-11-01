import { Plus, ShoppingBag } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { retailList } from '@/server/studio/queries/retail';
import { SUBSCRIPTION_TONE } from '@/studio/billing';
import { formatDate, numberFormat } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { syncLabel } from '@/studio/retail-sync';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { RestaurantStatusBadge } from '../restaurants/RestaurantStatusBadge';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('retail.title') };
}

const NEW_SHOP = '/studio/restaurants/new?sector=RETAIL';

/**
 * The retail shops on the platform, the way the Pharmacy page is for pharmacies: every RETAIL-sector business linked to
 * Buzzify Retail with its branches, status, Retail subscription and how far delivery to Retails has got. `?failed=1`
 * keeps the shops whose delivery failed. Super Admins read it; anyone else gets the not-found page.
 */
export default async function RetailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const number = numberFormat(actor.locale);
  const failedOnly = (await searchParams).failed === '1';
  const { rows } = await query(retailList, { failedOnly });

  const newShop = (
    <Link href={NEW_SHOP} className={buttonClasses('primary')}>
      <Plus aria-hidden />
      {t('retail.new')}
    </Link>
  );
  const filters = [
    { id: 'all', href: '/studio/retail', label: t('retail.filter.all'), current: !failedOnly },
    { id: 'failed', href: '/studio/retail?failed=1', label: t('retail.filter.failed'), current: failedOnly },
  ];

  return (
    <>
      <PageHeader title={t('retail.title')} description={t('retail.description')} actions={rows.length > 0 || failedOnly ? newShop : undefined} />
      <div className="flex flex-col gap-4 px-8 pb-10">
        <nav aria-label={t('retail.filter.label')} className="flex flex-wrap gap-2">
          {filters.map((filter) => (
            <Link
              key={filter.id}
              href={filter.href}
              aria-current={filter.current ? 'page' : undefined}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:text-text aria-[current=page]:border-text aria-[current=page]:text-text"
            >
              {filter.label}
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          failedOnly ? (
            <EmptyState icon={<ShoppingBag aria-hidden />} title={t('retail.emptyFailedTitle')} body={t('retail.emptyFailedBody')} />
          ) : (
            <EmptyState icon={<ShoppingBag aria-hidden />} title={t('retail.emptyTitle')} body={t('retail.emptyBody')} action={newShop} />
          )
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-start text-sm">
              <caption className="sr-only">{t('retail.caption')}</caption>
              <thead className="border-b border-line bg-surface-muted text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('retail.name')}</th>
                  <th scope="col" className="px-4 py-3 text-end font-medium">{t('retail.branches')}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('retail.status')}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('retail.subscription')}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('retail.delivery')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => {
                  const sync = syncLabel(row.sync, t, actor.locale);
                  return (
                    <tr key={row.id}>
                      <td className="px-4 py-3">
                        <Link href={`/studio/restaurants/${row.id}/retail`} className="font-medium text-text underline-offset-2 hover:underline">
                          {row.name}
                        </Link>
                        <p className="text-xs text-muted">{formatDate(row.createdAt.toISOString(), actor.locale)}</p>
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums text-text">{number.format(row.branches)}</td>
                      <td className="px-4 py-3">
                        <RestaurantStatusBadge status={row.status} t={t} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge tone={row.subscription ? SUBSCRIPTION_TONE[row.subscription.status] : undefined}>
                            {t(`billing.status.${row.subscription?.status ?? 'NONE'}`)}
                          </StatusBadge>
                          {row.subscription && (
                            <span className="whitespace-nowrap text-xs text-muted">{row.subscription.planName?.[actor.locale] ?? row.subscription.planCode}</span>
                          )}
                        </div>
                      </td>
                      <td className="min-w-48 px-4 py-3">
                        <StatusBadge tone={sync.tone} className="h-auto min-h-5 whitespace-normal py-0.5">
                          {sync.text}
                        </StatusBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
