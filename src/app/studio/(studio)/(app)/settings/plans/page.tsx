import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { getPlans } from '@/server/studio/queries/plans';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { RouteTabs } from '@/studio/ui/RouteTabs';
import { settingsTabs } from '../tabs';
import { PlansEditor } from './PlansEditor';

export async function generateMetadata(): Promise<Metadata> {
  const t = getStudioTranslator(await requestStudioLocale());
  return { title: `${t('plansSettings.title')} · ${t('settings.title')}` };
}

/**
 * What each plan includes (spec: plans and entitlements, 8.2). Super Admins read it; the platform owner changes it, and
 * the WhatsApp number the upgrade button opens. Anyone else gets the not-found page.
 */
export default async function PlansSettingsPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const data = await query(getPlans, {});

  return (
    <>
      <PageHeader
        title={t('settings.title')}
        description={t('settings.description')}
        below={<RouteTabs tabs={settingsTabs(t)} label={t('settings.tabs.label')} />}
      />
      <div className="px-8 py-6">
        <PlansEditor
          key={JSON.stringify([data.plans, data.whatsapp])}
          plans={data.plans}
          whatsapp={data.whatsapp}
          features={data.features}
          followers={data.followers}
          canEdit={data.canEdit}
        />
      </div>
    </>
  );
}
