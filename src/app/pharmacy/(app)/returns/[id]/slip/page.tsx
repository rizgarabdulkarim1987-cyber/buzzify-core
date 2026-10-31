import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { A4Document } from '@/app/pharmacy/_ui/A4Document';
import { BackLink, Forbidden, PickBranch } from '@/app/pharmacy/_ui/PageGate';
import { get as getPrint } from '@/server/pharmacy/queries/print-settings';
import { returnReceipt } from '@/server/pharmacy/queries/receipt-print';
import { query } from '@/server/studio/framework/invoke';
import { StudioError } from '@/server/studio/framework/result';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.print.slip.title') };
}

/** The A4 return slip: what came back and what was refunded, drawn from the stored return. A customer is never named on it (the return has none). */
export default async function ReturnSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, access, locale] = await Promise.all([params, catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const { actor, place, placeInput } = access;
  const back = <BackLink href={`/pharmacy/returns/${id.slice(0, 64)}`}>{t('pharmacy.print.backToReturn')}</BackLink>;
  const title = t('pharmacy.print.slip.title');
  if (actor.role === null || (!roleMay(actor, 'report.view') && !roleMay(actor, 'return.approve'))) {
    return (
      <>
        <PageHeader className="max-sm:px-4 print:hidden" title={title} above={back} />
        <Forbidden t={t} scope="returns" support={actor.role === null} />
      </>
    );
  }
  if (!place.branchId) {
    return (
      <>
        <PageHeader className="max-sm:px-4 print:hidden" title={title} above={back} />
        <PickBranch t={t} scope="returns" />
      </>
    );
  }
  const returnId = id.slice(0, 64);
  let loaded;
  try {
    loaded = await Promise.all([query(returnReceipt, { ...placeInput, returnId, width: '80', locale }), query(getPrint, placeInput)]);
  } catch (error) {
    if (error instanceof StudioError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
  const [slip, print] = loaded;
  return (
    <>
      <PageHeader className="max-sm:px-4 print:hidden" title={title} description={t('pharmacy.print.slip.intro')} above={back} />
      <A4Document target={{ kind: 'return', id: returnId }} initial={slip.model} customerName={null} print={print.print} writable={access.writable('catalog.view')} />
    </>
  );
}
