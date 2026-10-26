import { CreditCard } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { billingRestaurants } from '@/server/studio/queries/billing';
import { getPlans } from '@/server/studio/queries/plans';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { Pagination } from '@/studio/ui/Pagination';
import { BillingTable } from './BillingTable';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('billing.title') };
}

/**
 * Every restaurant's subscriptions in one place: each product's status, plan and paid-until day, and the last payment.
 * Super Admins read it; anyone else gets the not-found page. The page number lives in the address.
 */
export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const raw = (await searchParams).page;
  const page = Number(Array.isArray(raw) ? raw[0] : raw);
  const [list, plans] = await Promise.all([
    query(billingRestaurants, { page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1 }),
    query(getPlans, {}),
  ]);
  // The Menu's plan codes are the plans of Settings → Plans, named as there.
  const planNames = Object.fromEntries(Object.entries(plans.plans).map(([code, plan]) => [code, plan.names]));

  return (
    <>
      <PageHeader title={t('billing.title')} description={t('billingList.description')} />
      <div className="flex flex-col gap-4 px-8 pb-10">
        {list.total === 0 ? (
          <EmptyState icon={<CreditCard aria-hidden />} title={t('billingList.emptyTitle')} body={t('billingList.emptyBody')} />
        ) : (
          <>
            <BillingTable rows={list.rows} applications={list.applications} planNames={planNames} />
            <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
          </>
        )}
      </div>
    </>
  );
}
