import type { Metadata } from 'next';
import { getActor } from '@/server/studio/auth/actor';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { ProjectHub } from '@/studio/shell/ProjectHub';
import OverviewPage, { generateMetadata as overviewMetadata } from './overview/page';

export async function generateMetadata(): Promise<Metadata> {
  const actor = await getActor();
  if (actor?.isSuperAdmin) return { title: getStudioTranslator(await requestStudioLocale())('hub.title') };
  return overviewMetadata();
}

/**
 * The Studio's home. A Super Admin gets the project icons, one closed space per project; everyone else gets the Overview
 * exactly as before (an owner of one restaurant goes straight to it).
 */
export default async function StudioHomePage() {
  const actor = await getActor();
  if (actor?.isSuperAdmin) return <ProjectHub t={getStudioTranslator(actor.locale)} />;
  return <OverviewPage />;
}
