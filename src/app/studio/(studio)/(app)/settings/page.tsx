import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { RESERVED_SLUGS } from '@/server/domain/slug';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { platformSettings } from '@/server/studio/queries/settings';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { RouteTabs } from '@/studio/ui/RouteTabs';
import { SettingsForm } from './SettingsForm';
import { settingsTabs } from './tabs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('settings.title') };
}

/** The platform's settings, for Super Admins (anyone else gets the not-found page): reserved addresses, the email sender name and new-menu defaults. */
export default async function SettingsPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const data = await query(platformSettings, {});

  return (
    <>
      <PageHeader
        title={t('settings.title')}
        description={t('settings.description')}
        below={<RouteTabs tabs={settingsTabs(t)} label={t('settings.tabs.label')} />}
      />
      <div className="px-8 pb-2">
        <SettingsForm
          // A save changes what the form starts from, so it starts again from what was saved.
          key={data.updatedAt ?? 'defaults'}
          settings={data.settings}
          updatedAt={data.updatedAt}
          currencies={data.currencies}
          timeZones={data.timeZones}
          builtIn={RESERVED_SLUGS}
        />
      </div>
    </>
  );
}
