import type { Metadata } from 'next';
import Link from 'next/link';
import { formatStamp } from '@/lib/pos-format';
import { unitCostLabel } from '@/server/domain/pos/stock';
import { query } from '@/server/studio/framework/invoke';
import { posPurchase } from '@/server/studio/queries/pos-inventory';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { PurchaseActions } from '@/app/pos/_ui/stock/PurchaseForm';
import { moneyLabel, quantityLabel } from '@/app/pos/_ui/stock/view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.buy.title') };
}

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [invoice, locale] = await Promise.all([query(posPurchase, { invoiceId: id }), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const voided = invoice.voidedAt !== null;
  return (
    <>
      <PageHeader
        above={
          <Link href="/pos/purchases" className="inline-flex min-h-12 items-center text-base text-muted underline underline-offset-2">
            {t('pos.stock.back')}
          </Link>
        }
        title={<span dir="auto">{invoice.supplierName}</span>}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <span dir="ltr">{invoice.invoiceDay}</span>
            {invoice.number ? <span dir="auto">#{invoice.number}</span> : null}
            {voided ? <StatusBadge>{t('pos.buy.voided')}</StatusBadge> : invoice.paidAt ? <StatusBadge tone="success">{t('pos.buy.paidState')}{invoice.paidMethod ? ` · ${t(`pos.buy.method.${invoice.paidMethod}`)}` : ''}</StatusBadge> : <StatusBadge tone="danger">{t('pos.buy.unpaid')}</StatusBadge>}
          </span>
        }
      />
      <div className="flex flex-col gap-6 px-8 pb-8">
        {voided ? (
          <p className="text-base text-muted" dir="auto">
            {t('pos.buy.voidedReason')}: {invoice.voidReason}
          </p>
        ) : null}
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {invoice.lines.map((line) => (
            <li key={line.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-base text-text" dir="auto">
                  {line.itemName}
                </span>
                <span className="text-sm text-muted">
                  {quantityLabel(t, line.quantity, line.unit)} · ≈ {moneyLabel(t, unitCostLabel({ amount: line.lineTotal, quantity: line.quantity }, line.unit))} / {t(`pos.stock.per.${line.unit}`)}
                </span>
              </span>
              <span className="text-base text-text">{moneyLabel(t, line.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <p className="text-lg font-semibold text-text" data-testid="invoice-total">
          {t('pos.buy.total')}: {moneyLabel(t, invoice.total)}
        </p>
        <p className="text-sm text-muted" dir="auto">
          {formatStamp(invoice.createdAt)} {invoice.userName ? `· ${invoice.userName}` : ''} {invoice.note ? `· ${invoice.note}` : ''}
        </p>
        <PurchaseActions invoiceId={invoice.id} paid={invoice.paidAt !== null} voided={voided} />
      </div>
    </>
  );
}
