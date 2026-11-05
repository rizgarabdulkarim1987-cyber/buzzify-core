import type { Metadata } from 'next';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PeopleList } from '../../people/PeopleList';
import { productOf, type ProductPageProps } from '../product';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('people.title') };
}

export default async function RetailPeoplePage({ params, searchParams }: ProductPageProps) {
  return <PeopleList searchParams={searchParams} space={await productOf(params)} />;
}
