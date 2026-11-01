import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { appPlansList } from '@/server/studio/queries/app-plans';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { AppPlansEditor } from './AppPlansEditor';

export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const { app } = await searchParams;
  return { title: getStudioTranslator(await requestStudioLocale())(`appPlans.${app === 'retail' ? 'retail' : 'pharmacy'}.title`) };
}

/**
 * The pharmacy and Retail plans (`?app=retail`) and the limits each sets. Super Admins read it; the platform owner changes it. Anyone else gets the
 * not-found page.
 */
export default async function AppPlansPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const { app } = await searchParams;
  const applicationId = app === 'retail' ? 'retail' : 'pharmacy';
  const { plans, canEdit } = await query(appPlansList, { applicationId });

  return (
    <>
      <PageHeader
        above={
          <Link href="/studio/billing" className="inline-flex w-fit items-center gap-1 text-sm text-muted transition-colors hover:text-text">
            <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
            {t('billing.title')}
          </Link>
        }
        title={t(`appPlans.${applicationId}.title`)}
        description={t(`appPlans.${applicationId}.description`)}
      />
      <div className="px-8 pb-10">
        <nav aria-label={t('appPlans.navLabel')} className="mb-8 flex gap-2">
          {(['pharmacy', 'retail'] as const).map((id) => (
            <Link
              key={id}
              href={id === 'retail' ? '/studio/billing/plans?app=retail' : '/studio/billing/plans'}
              aria-current={id === applicationId ? 'page' : undefined}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:text-text aria-[current=page]:border-text aria-[current=page]:text-text"
            >
              {t(`appPlans.app.${id}`)}
            </Link>
          ))}
        </nav>
        <AppPlansEditor key={applicationId} applicationId={applicationId} plans={plans} canEdit={canEdit} />
      </div>
    </>
  );
}
