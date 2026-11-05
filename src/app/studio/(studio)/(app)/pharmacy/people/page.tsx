import type { Metadata } from 'next';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PeopleList } from '../../people/PeopleList';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('people.title') };
}

export default function PharmacyPeoplePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <PeopleList searchParams={searchParams} space="pharmacy" />;
}
