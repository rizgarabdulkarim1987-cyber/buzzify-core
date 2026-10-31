import type { Metadata } from 'next';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { AnnouncementsList } from './AnnouncementsList';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('announcements.title') };
}

/** The Buzzify team's announcements, for Super Admins (anyone else gets the not-found page). */
export default function AnnouncementsPage() {
  return <AnnouncementsList space="food" />;
}
