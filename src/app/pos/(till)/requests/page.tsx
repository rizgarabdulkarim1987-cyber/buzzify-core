import type { Metadata } from 'next';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posBillCalls, posQrFlags, posRequestCatalog, posRequests } from '@/server/studio/queries/pos-requests';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { Alert } from '@/studio/ui/Alert';
import { PageHeader } from '@/studio/ui/PageHeader';
import { RequestsScreen } from '@/app/pos/_ui/RequestsScreen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.requests.title') };
}

/** The guests' orders from the table QR code. With QR ordering switched off there is nothing to show. */
export default async function RequestsPage() {
  const { actor } = await getPosAccess();
  if (!actor) return null;
  const t = getStudioTranslator(actor.locale);
  const flags = await query(posQrFlags, {});
  if (!flags.qrOrdering) {
    return (
      <>
        <PageHeader title={t('pos.requests.title')} />
        <div className="px-4 pb-8 sm:px-8">
          <Alert>{t('pos.qr.off')}</Alert>
        </div>
      </>
    );
  }
  const [{ requests, readAt }, billCalls, catalog] = await Promise.all([query(posRequests, {}), query(posBillCalls, {}), query(posRequestCatalog, {})]);
  return (
    <>
      <PageHeader title={t('pos.requests.title')} description={t('pos.requests.intro')} />
      <RequestsScreen requests={requests} billCalls={billCalls} catalog={catalog} role={actor.role} readAt={readAt} />
    </>
  );
}
