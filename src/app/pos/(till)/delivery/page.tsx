import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import { posDeliverySetup } from '@/server/studio/queries/pos-delivery';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { DeliverySetup } from '@/app/pos/_ui/DeliverySetup';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.delivery.title') };
}

/** The delivery areas and drivers a delivery order picks from. */
export default async function DeliveryPage() {
  const [setup, locale] = await Promise.all([query(posDeliverySetup, {}), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  return (
    <>
      <PageHeader title={t('pos.delivery.title')} description={t('pos.delivery.intro')} />
      <DeliverySetup zones={setup.zones} drivers={setup.drivers} />
    </>
  );
}
