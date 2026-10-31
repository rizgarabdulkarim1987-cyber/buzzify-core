import { EyeOff, HandCoins } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InvoiceVariance } from '@/app/pharmacy/_ui/InvoiceVariance';
import { Amount, BandChip, InvoiceStatusChip } from '@/app/pharmacy/_ui/money-status';
import { MoneyLocked, ReasonAction } from '@/app/pharmacy/_ui/ReasonAction';
import { formatNumber } from '@/lib/pos-format';
import { get, variance } from '@/server/pharmacy/queries/supplier-invoices';
import { query } from '@/server/studio/framework/invoke';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.m.inv.detail') };
}

/** One invoice: header, lines, totals with paid / credited / balance, the variance against order and receipt (cost viewers), and the actions: Pay, and Void with a reason. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, g] = await Promise.all([params, purchasingGate('pharmacy.purchasing.m.inv.detail', { href: '/pharmacy/purchasing/invoices', labelKey: 'pharmacy.purchasing.m.inv.back' })]);
  if (g.blocked) return g.blocked;
  if (!/^[\w-]{1,64}$/.test(id)) notFound();
  const { access, t, locale } = g;
  const invoice = await query(get, { ...access.placeInput, invoiceId: id });
  const compare = access.showCost ? await query(variance, { ...access.placeInput, invoiceId: id }) : null;
  const c = invoice.currency;
  const owing = invoice.status === 'OPEN' || invoice.status === 'PARTIAL';
  const date = (d: string) => <bdi dir="ltr">{phDate(`${d}T00:00:00.000Z`, locale)}</bdi>;
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        above={g.back}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <bdi dir="ltr">{invoice.number}</bdi>
            <InvoiceStatusChip status={invoice.status} t={t} />
            {invoice.dueBand && <BandChip band={invoice.dueBand} t={t} />}
          </span>
        }
        description={<span dir="auto">{invoice.supplierName}</span>}
      />
      <div className="flex min-w-0 flex-col gap-8 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        <section aria-labelledby="inv-head" className="flex min-w-0 flex-col gap-3" data-testid="invoice-head">
          <h2 id="inv-head" className="text-md font-semibold text-text">
            {t('pharmacy.purchasing.m.inv.header')}
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm text-text sm:max-w-xl">
            <dt className="text-muted">{t('pharmacy.purchasing.po.supplier')}</dt>
            <dd>
              <Link href={`/pharmacy/purchasing/suppliers/${invoice.supplierId}`} dir="auto" className="underline underline-offset-2">
                {invoice.supplierName}
              </Link>
            </dd>
            <dt className="text-muted">{t('pharmacy.purchasing.m.inv.invoiceDate')}</dt>
            <dd>{date(invoice.invoiceDate)}</dd>
            <dt className="text-muted">{t('pharmacy.purchasing.m.inv.dueDate')}</dt>
            <dd>{date(invoice.dueDate)}</dd>
            {invoice.status === 'VOID' && invoice.voidedAt && (
              <>
                <dt className="text-muted">{t('pharmacy.purchasing.m.inv.voidedOn')}</dt>
                <dd>{date(invoice.voidedAt.slice(0, 10))}</dd>
                <dt className="text-muted">{t('pharmacy.purchasing.m.reason')}</dt>
                <dd dir="auto">{invoice.voidReason}</dd>
              </>
            )}
          </dl>
        </section>

        {invoice.totalMinor !== undefined && (
          <section aria-labelledby="inv-totals" className="flex min-w-0 flex-col gap-3" data-testid="invoice-totals">
            <h2 id="inv-totals" className="text-md font-semibold text-text">
              {t('pharmacy.purchasing.m.inv.totals')}
            </h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm text-text sm:max-w-md">
              {invoice.adjustmentMinor !== undefined && invoice.adjustmentMinor !== '0' && (
                <>
                  <dt className="text-muted">
                    {t('pharmacy.purchasing.m.inv.adjustmentTotal')}
                    {invoice.adjustmentReason && <span dir="auto"> ({invoice.adjustmentReason})</span>}
                  </dt>
                  <dd className="text-end">
                    <Amount amount={invoice.adjustmentMinor} currency={c} locale={locale} />
                  </dd>
                </>
              )}
              <dt className="text-muted">{t('pharmacy.purchasing.po.total')}</dt>
              <dd className="text-end" data-testid="invoice-total">
                <Amount amount={invoice.totalMinor} currency={c} locale={locale} />
              </dd>
              <dt className="text-muted">{t('pharmacy.purchasing.m.inv.paid')}</dt>
              <dd className="text-end" data-testid="invoice-paid">
                <Amount amount={invoice.paidMinor} currency={c} locale={locale} />
              </dd>
              <dt className="text-muted">{t('pharmacy.purchasing.m.inv.credited')}</dt>
              <dd className="text-end" data-testid="invoice-credited">
                <Amount amount={invoice.creditedMinor} currency={c} locale={locale} />
              </dd>
              <dt className="font-semibold">{t('pharmacy.purchasing.m.inv.balance')}</dt>
              <dd className="text-end font-semibold" data-testid="invoice-balance">
                <Amount amount={invoice.balanceMinor} currency={c} locale={locale} />
              </dd>
            </dl>
          </section>
        )}

        <section aria-labelledby="inv-actions" className="flex min-w-0 flex-col gap-3" data-testid="invoice-actions">
          <h2 id="inv-actions" className="text-md font-semibold text-text">
            {t('pharmacy.purchasing.m.inv.actions')}
          </h2>
          {!g.writable.ok ? null : !g.mayMoney ? (
            <MoneyLocked testId="invoice-money-locked" text={t('pharmacy.purchasing.m.needsMoneyRole')} />
          ) : (
            <div className="flex min-w-0 flex-col gap-3">
              {owing && (
                <div>
                  <Link
                    href={`/pharmacy/purchasing/payments/new?supplier=${encodeURIComponent(invoice.supplierId)}&currency=${c}&invoice=${encodeURIComponent(invoice.id)}`}
                    data-testid="invoice-pay"
                    className={buttonClasses('primary', 'lg', 'min-h-11')}
                  >
                    <HandCoins aria-hidden />
                    {t('pharmacy.purchasing.m.inv.pay')}
                  </Link>
                </div>
              )}
              {invoice.status !== 'VOID' && <ReasonAction kind="void" targetId={invoice.id} version={invoice.version} userId={access.actor.userId} restaurantId={access.placeInput.restaurantId} />}
            </div>
          )}
        </section>

        <section aria-labelledby="inv-lines" className="flex min-w-0 flex-col gap-3" data-testid="invoice-lines">
          <h2 id="inv-lines" className="text-md font-semibold text-text">
            {t('pharmacy.purchasing.m.inv.lines')}
          </h2>
          <ol className="flex flex-col border-t border-line">
            {invoice.lines.map((l) => (
              <li key={l.lineNo} data-testid="invoice-line-row" className="flex min-w-0 flex-col gap-1 border-b border-line py-3 text-sm text-text">
                <p dir="auto" className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                  {l.productName} <span className="font-normal text-muted">· {l.unitLabel}</span>
                </p>
                {l.redacted ? (
                  <p className="flex items-start gap-2 text-muted">
                    <EyeOff aria-hidden className="mt-px size-4 shrink-0" />
                    {t('pharmacy.purchasing.m.inv.otherBranch')}
                  </p>
                ) : (
                  <p className="flex flex-wrap gap-x-5 gap-y-0.5 text-muted">
                    {l.receiptId && (
                      <span>
                        {t('pharmacy.purchasing.m.inv.receipt')}:{' '}
                        <Link href={`/pharmacy/stock/receive/${l.receiptId}`} className="underline underline-offset-2">
                          <bdi dir="ltr">{l.receiptNumber ?? l.receiptId.slice(0, 8)}</bdi>
                        </Link>
                      </span>
                    )}
                    {l.lot && (
                      <span>
                        {t('pharmacy.stock.batch.lot')}: <bdi dir="ltr">{l.lot}</bdi>
                      </span>
                    )}
                    {l.expiry && (
                      <span>
                        {t('pharmacy.purchasing.m.inv.expiry')}: {date(l.expiry)}
                      </span>
                    )}
                  </p>
                )}
                <p className="flex flex-wrap gap-x-5 gap-y-0.5">
                  <span>
                    {t('pharmacy.purchasing.m.inv.qty')}: <bdi dir="ltr">{formatNumber(l.qtyInvoiced)}</bdi>
                  </span>
                  {l.unitCostMinor !== undefined && (
                    <span>
                      {t('pharmacy.purchasing.m.inv.unitCost')}: <Amount amount={l.unitCostMinor} currency={c} locale={locale} />
                    </span>
                  )}
                  {l.lineTotalMinor !== undefined && (
                    <span className="font-medium">
                      {t('pharmacy.purchasing.m.inv.lineTotal')}: <Amount amount={l.lineTotalMinor} currency={c} locale={locale} />
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {compare && <InvoiceVariance variance={compare} t={t} locale={locale} />}
      </div>
    </>
  );
}
