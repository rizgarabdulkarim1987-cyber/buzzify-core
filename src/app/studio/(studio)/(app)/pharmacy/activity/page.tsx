import type { Metadata } from 'next';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { ActivityList } from '../../activity/ActivityList';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('activity.title') };
}

export default function PharmacyActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ActivityList searchParams={searchParams} space="pharmacy" />;
}
