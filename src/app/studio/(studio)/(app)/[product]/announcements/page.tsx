import type { Metadata } from 'next';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { AnnouncementsList } from '../../announcements/AnnouncementsList';
import { productOf, type ProductParams } from '../product';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('announcements.title') };
}

/** The Buzzify team's announcements written in this Retail product's space, for Super Admins (anyone else gets the not-found page). */
export default async function RetailAnnouncementsPage({ params }: ProductParams) {
  return <AnnouncementsList space={await productOf(params)} />;
}
