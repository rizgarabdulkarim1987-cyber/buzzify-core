import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { canOpenTillPage } from '@/server/domain/pos/nav';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posBillCalls, posQrFlags, posRequestCatalog, posRequests } from '@/server/studio/queries/pos-requests';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { CaptainScreen } from '@/app/pos/_ui/CaptainScreen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.captain.title') };
}

/**
 * The captain's page: bill calls, guest orders held for approval, and an order taken at the table. Bill calls and held
 * orders show even with QR ordering off (some may be left from before); only the new order needs it on.
 */
export default async function CaptainPage() {
  const { actor } = await getPosAccess();
  if (!actor || !canOpenTillPage(actor.role, 'captain')) notFound();
  const t = getStudioTranslator(actor.locale);
  const [flags, { requests, readAt }, billCalls, catalog] = await Promise.all([query(posQrFlags, {}), query(posRequests, {}), query(posBillCalls, {}), query(posRequestCatalog, {})]);
  return (
    <>
      <PageHeader title={t('pos.captain.title')} description={t('pos.captain.intro')} />
      <CaptainScreen requests={requests} billCalls={billCalls} catalog={catalog} role={actor.role} qrOrdering={flags.qrOrdering} readAt={readAt} />
    </>
  );
}
