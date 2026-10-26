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

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('appPlans.title') };
}

/**
 * The pharmacy plans and the limits each sets. Super Admins read it; the platform owner changes it. Anyone else gets the
 * not-found page.
 */
export default async function AppPlansPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const { plans, canEdit } = await query(appPlansList, {});

  return (
    <>
      <PageHeader
        above={
          <Link href="/studio/billing" className="inline-flex w-fit items-center gap-1 text-sm text-muted transition-colors hover:text-text">
            <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
            {t('billing.title')}
          </Link>
        }
        title={t('appPlans.title')}
        description={t('appPlans.description')}
      />
      <div className="px-8 pb-10">
        <AppPlansEditor plans={plans} canEdit={canEdit} />
      </div>
    </>
  );
}
