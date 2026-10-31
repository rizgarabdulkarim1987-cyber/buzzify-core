import type { Metadata } from 'next';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PeopleList } from '../people/PeopleList';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('nav.team') };
}

/** The team: the accounts of the platform's own space (Super Admins, and anyone not yet working in a project), with their invitations. */
export default function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <PeopleList searchParams={searchParams} space="platform" />;
}
