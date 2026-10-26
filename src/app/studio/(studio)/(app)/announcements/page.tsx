import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { listAnnouncements } from '@/server/studio/queries/announcements';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { AnnouncementsAdmin } from './AnnouncementsAdmin';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('announcements.title') };
}

/** The Buzzify team's announcements, for Super Admins (anyone else gets the not-found page). */
export default async function AnnouncementsPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const rows = await query(listAnnouncements, {});

  return (
    <>
      <PageHeader title={t('announcements.title')} description={t('announcements.description')} />
      <div className="max-w-4xl px-8 pb-16">
        <AnnouncementsAdmin rows={rows} />
      </div>
    </>
  );
}
