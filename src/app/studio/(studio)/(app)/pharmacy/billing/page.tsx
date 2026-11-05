import type { Metadata } from 'next';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { BillingList } from '../../billing/BillingList';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('billing.title') };
}

export default function PharmacyBillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <BillingList searchParams={searchParams} space="pharmacy" />;
}
