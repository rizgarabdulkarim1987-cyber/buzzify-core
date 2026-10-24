import { Store } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { posOverview } from '@/server/studio/queries/pos';
import { SUBSCRIPTION_TONE } from '@/studio/billing';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { StatusBadge } from '@/studio/ui/StatusBadge';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('cashierOverview.title') };
}

/**
 * The Cashier across the platform, the way Billing is for subscriptions: every restaurant that has it, with its
 * subscription, active staff and whether the product list is set up. Super Admins read it; anyone else gets the
 * not-found page. The till itself (/pos) belongs to each restaurant's own people.
 */
export default async function CashierOverviewPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const { rows } = await query(posOverview, {});

  return (
    <>
      <PageHeader title={t('cashierOverview.title')} description={t('cashierOverview.description')} />
      <div className="flex flex-col gap-4 px-8 pb-10">
        {rows.length === 0 ? (
          <EmptyState icon={<Store aria-hidden />} title={t('cashierOverview.emptyTitle')} body={t('cashierOverview.emptyBody')} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-start text-sm">
              <thead className="border-b border-line bg-surface-muted text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('cashierOverview.restaurant')}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('cashierOverview.subscription')}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('cashierOverview.staff')}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('cashierOverview.catalog')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3">
                      <Link href={`/studio/restaurants/${row.id}/billing`} className="font-medium text-text underline-offset-2 hover:underline">
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={row.status === 'NONE' ? undefined : SUBSCRIPTION_TONE[row.status]}>{t(`billing.status.${row.status}`)}</StatusBadge>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-text">{row.staff}</td>
                    <td className="px-4 py-3 text-text">{row.catalogChosen ? t('cashierOverview.catalogSet') : t('cashierOverview.catalogMissing')}</td>
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
