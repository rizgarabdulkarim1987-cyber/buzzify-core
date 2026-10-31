import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { A4Document } from '@/app/pharmacy/_ui/A4Document';
import { BackLink, Forbidden, PickBranch } from '@/app/pharmacy/_ui/PageGate';
import { get as getReceipt } from '@/server/pharmacy/queries/receipt-print';
import { get as getPrint } from '@/server/pharmacy/queries/print-settings';
import { get as getSale } from '@/server/pharmacy/queries/sales';
import { query } from '@/server/studio/framework/invoke';
import { StudioError } from '@/server/studio/framework/result';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.print.invoice.title') };
}

/**
 * The A4 sale invoice. Anyone who may read the sale may open and print it; the paper is drawn from the stored sale. The customer's name is on
 * it only when the server gave it (a role that may see customers), and a sale paid on credit shows its CREDIT line. Printing never changes the
 * sale; a copy is logged through the reprint action, which a read-only pharmacy refuses (said in words).
 */
export default async function SaleInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, access, locale] = await Promise.all([params, catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const { actor, place, placeInput } = access;
  const back = <BackLink href={`/pharmacy/sales/${id.slice(0, 64)}`}>{t('pharmacy.print.backToSale')}</BackLink>;
  const title = t('pharmacy.print.invoice.title');
  if (actor.role === null || (!roleMay(actor, 'shift.use') && !roleMay(actor, 'report.view'))) {
    return (
      <>
        <PageHeader className="max-sm:px-4 print:hidden" title={title} above={back} />
        <Forbidden t={t} scope="sales" support={actor.role === null} />
      </>
    );
  }
  if (!place.branchId) {
    return (
      <>
        <PageHeader className="max-sm:px-4 print:hidden" title={title} above={back} />
        <PickBranch t={t} scope="sales" />
      </>
    );
  }
  const saleId = id.slice(0, 64);
  let loaded;
  try {
    loaded = await Promise.all([query(getReceipt, { ...placeInput, saleId, width: '80', locale }), query(getSale, { ...placeInput, saleId }), query(getPrint, placeInput)]);
  } catch (error) {
    if (error instanceof StudioError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    if (error instanceof StudioError && error.fields?.phCode === 'NOT_PRINTABLE') {
      return (
        <>
          <PageHeader className="max-sm:px-4" title={title} above={back} />
          <p data-testid="not-printable" className="mx-4 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text sm:mx-8">
            {t('pharmacy.print.notPrintable')}
          </p>
        </>
      );
    }
    throw error;
  }
  const [receipt, sale, print] = loaded;
  return (
    <>
      <PageHeader className="max-sm:px-4 print:hidden" title={title} description={t('pharmacy.print.invoice.intro')} above={back} />
      <A4Document target={{ kind: 'sale', id: saleId }} initial={receipt.model} customerName={sale.customer?.name ?? null} print={print.print} writable={access.writable('catalog.view')} />
    </>
  );
}
