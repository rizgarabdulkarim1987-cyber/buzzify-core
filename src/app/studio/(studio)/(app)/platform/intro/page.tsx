import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { platformIntro } from '@/server/studio/queries/platform-intro';
import { PlatformIntro } from '@/studio/intro/PlatformIntro';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('platformIntro.title') };
}

/** The Buzzify team's intro page settings: the default background and the adverts. Super Admins only (anyone else gets the not-found page). */
export default async function PlatformIntroPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const view = await query(platformIntro, {});
  return (
    <>
      <PageHeader title={t('platformIntro.title')} description={t('platformIntro.description')} />
      <PlatformIntro view={view} />
    </>
  );
}
