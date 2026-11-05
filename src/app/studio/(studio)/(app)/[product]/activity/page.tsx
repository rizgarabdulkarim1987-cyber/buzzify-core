import type { Metadata } from 'next';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { ActivityList } from '../../activity/ActivityList';
import { productOf, type ProductPageProps } from '../product';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('activity.title') };
}

export default async function RetailActivityPage({ params, searchParams }: ProductPageProps) {
  return <ActivityList searchParams={searchParams} space={await productOf(params)} />;
}
