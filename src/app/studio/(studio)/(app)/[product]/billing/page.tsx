import type { Metadata } from 'next';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { BillingList } from '../../billing/BillingList';
import { productOf, type ProductPageProps } from '../product';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('billing.title') };
}

export default async function RetailBillingPage({ params, searchParams }: ProductPageProps) {
  return <BillingList searchParams={searchParams} space={await productOf(params)} />;
}
