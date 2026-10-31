import { Pill, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { listPharmacies } from '@/server/studio/queries/pharmacies';
import { SUBSCRIPTION_TONE } from '@/studio/billing';
import { formatDate, numberFormat } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { businessPath } from '@/studio/spaces';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { RestaurantStatusBadge } from '../restaurants/RestaurantStatusBadge';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacies.title') };
}

const NEW_PHARMACY = '/studio/pharmacy/new';

/**
 * The pharmacies on the platform, the way the Cashier page is for the till: every PHARMACY-sector business with its
 * branches, status, pharmacy subscription and when it was added. Super Admins read it; anyone else gets the not-found
 * page. A pharmacy is still a business of the Restaurants list too: each row opens that same detail page, and "New
 * pharmacy" opens the same create form, on the Pharmacy sector.
 */
export default async function PharmaciesPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const number = numberFormat(actor.locale);
  const { rows } = await query(listPharmacies, {});

  const newPharmacy = (
    <Link href={NEW_PHARMACY} className={buttonClasses('primary')}>
      <Plus aria-hidden />
      {t('pharmacies.new')}
    </Link>
  );

  return (
    <>
      <PageHeader title={t('pharmacies.title')} description={t('pharmacies.description')} actions={rows.length > 0 ? newPharmacy : undefined} />
      <div className="flex flex-col gap-4 px-8 pb-10">
        {rows.length === 0 ? (
          <EmptyState icon={<Pill aria-hidden />} title={t('pharmacies.emptyTitle')} body={t('pharmacies.emptyBody')} action={newPharmacy} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-start text-sm">
              <caption className="sr-only">{t('pharmacies.caption')}</caption>
              <thead className="border-b border-line bg-surface-muted text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('pharmacies.name')}</th>
                  <th scope="col" className="px-4 py-3 text-end font-medium">{t('pharmacies.branches')}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('pharmacies.status')}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('pharmacies.subscription')}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('pharmacies.created')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3">
                      <Link href={businessPath('PHARMACY', row.id)} className="font-medium text-text underline-offset-2 hover:underline">
                        {row.name}
                      </Link>
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
                          <span className="whitespace-nowrap text-xs text-muted">
                            {row.subscription.planName?.[actor.locale] ?? row.subscription.planCode}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDate(row.createdAt.toISOString(), actor.locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
