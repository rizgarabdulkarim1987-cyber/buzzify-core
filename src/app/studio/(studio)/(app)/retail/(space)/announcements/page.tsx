import type { Metadata } from 'next';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { AnnouncementsList } from '../../../announcements/AnnouncementsList';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('announcements.title') };
}

/** The Buzzify team's announcements written in the Retail space, for Super Admins (anyone else gets the not-found page). */
export default function RetailAnnouncementsPage() {
  return <AnnouncementsList space="retail" />;
}
