import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { billingOverview } from '@/server/studio/queries/billing';
import { getPlans } from '@/server/studio/queries/plans';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { RouteTabs } from '@/studio/ui/RouteTabs';
import { settingsTabs } from '../tabs';
import { BillingSettings } from './BillingSettings';

export async function generateMetadata(): Promise<Metadata> {
  const t = getStudioTranslator(await requestStudioLocale());
  return { title: `${t('billingSettings.title')} · ${t('settings.title')}` };
}

/**
 * The products restaurants subscribe to and what each plan costs (docs/superpowers/plans/2026-10-22-business-core-in-menu.md,
 * Task 5). Super Admins read it; the platform owner changes it. Anyone else gets the not-found page.
 */
export default async function BillingSettingsPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const [overview, plans] = await Promise.all([query(billingOverview, {}), query(getPlans, {})]);
  // The Menu's plan codes are the plans of Settings → Plans, named as there.
  const planNames = Object.fromEntries(Object.entries(plans.plans).map(([code, plan]) => [code, plan.names]));

  return (
    <>
      <PageHeader
        title={t('settings.title')}
        description={t('settings.description')}
        below={<RouteTabs tabs={settingsTabs(t)} label={t('settings.tabs.label')} />}
      />
      <div className="px-8 py-6">
        {/* Remounted after a save, so every form starts again from what is stored. */}
        <BillingSettings key={JSON.stringify(overview.applications)} products={overview.applications} planNames={planNames} canEdit={overview.canEdit} />
      </div>
    </>
  );
}
