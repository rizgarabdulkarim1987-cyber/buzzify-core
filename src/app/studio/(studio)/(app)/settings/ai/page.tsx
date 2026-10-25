import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { aiSettings } from '@/server/studio/queries/ai-settings';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { RouteTabs } from '@/studio/ui/RouteTabs';
import { settingsTabs } from '../tabs';
import { AiSettings } from './AiSettings';

export async function generateMetadata(): Promise<Metadata> {
  const t = getStudioTranslator(await requestStudioLocale());
  return { title: `${t('aiSettings.title')} · ${t('settings.title')}` };
}

/** Which AI provider answers and its key. The platform owner only; anyone else gets the not-found page. */
export default async function AiSettingsPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const settings = await query(aiSettings, {});

  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.description')} below={<RouteTabs tabs={settingsTabs(t)} label={t('settings.tabs.label')} />} />
      <div className="px-8 py-6">
        {/* Remounted after a save, so every field starts again from what is stored. */}
        <AiSettings key={settings.updatedAt ?? 'defaults'} settings={settings} />
      </div>
    </>
  );
}
