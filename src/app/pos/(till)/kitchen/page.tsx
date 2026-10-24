import type { Metadata } from 'next';
import { getPosAccess } from '@/server/pos/actor';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.kitchen.title') };
}

/** A placeholder: the kitchen screen arrives with orders, in a later phase. */
export default async function KitchenPage() {
  const { actor } = await getPosAccess();
  if (!actor) return null;
  const t = getStudioTranslator(actor.locale);
  return <PageHeader title={t('pos.kitchen.title')} description={t('pos.kitchen.soon')} />;
}
