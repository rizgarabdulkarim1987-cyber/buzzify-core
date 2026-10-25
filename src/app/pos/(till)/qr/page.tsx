import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import { posCatalogMenu } from '@/server/studio/queries/pos';
import { posQrSheet } from '@/server/studio/queries/pos-requests';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { Alert } from '@/studio/ui/Alert';
import { PageHeader } from '@/studio/ui/PageHeader';
import { QrSheet } from '@/app/pos/_ui/QrSheet';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.qr.title') };
}

/** One QR code per table, each opening the Menu's page for that table. A role without `settings.manage` gets the 404 page. */
export default async function QrPage() {
  const [state, locale] = await Promise.all([query(posCatalogMenu, {}), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const sheet = state.chosenId === null ? null : await query(posQrSheet, {});
  return (
    <>
      <PageHeader title={t('pos.qr.title')} description={t('pos.qr.intro')} />
      <div className="flex flex-col gap-4 px-4 pb-8 sm:px-8">
        {sheet === null ? <Alert>{t('pos.qr.noCatalog')}</Alert> : null}
        {sheet !== null && !sheet.enabled ? <Alert>{t('pos.qr.off')}</Alert> : null}
        {sheet !== null && !sheet.menu?.published ? <Alert>{t('pos.qr.notPublished')}</Alert> : null}
        {sheet !== null ? <QrSheet sheet={sheet} /> : null}
      </div>
    </>
  );
}
