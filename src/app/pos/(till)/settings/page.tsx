import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import { posSettings } from '@/server/studio/queries/pos';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { SettingsForm } from './SettingsForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.settings.title') };
}

/** How the restaurant's till charges and takes payment. A role without `settings.manage` gets the 404 page. */
export default async function PosSettingsPage() {
  const [settings, locale] = await Promise.all([query(posSettings, {}), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  return (
    <>
      <PageHeader title={t('pos.settings.title')} description={t('pos.settings.intro')} />
      <div className="px-8 pb-8">
        <SettingsForm settings={settings} />
      </div>
    </>
  );
}
