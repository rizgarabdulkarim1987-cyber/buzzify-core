import { NotebookText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Amount, moneyText } from '@/app/pharmacy/_ui/money-status';
import { formatNumber } from '@/lib/pos-format';
import { get } from '@/server/pharmacy/queries/supplier-returns';
import { query } from '@/server/studio/framework/invoke';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.m.ret.detail') };
}

/** One return to a supplier: reason, lines (product, lot, expiry, bucket, quantity), the value at cost (cost viewers) and the credit notes linked to it. */
export default async function SupplierReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, g] = await Promise.all([params, purchasingGate('pharmacy.purchasing.m.ret.detail', { href: '/pharmacy/purchasing/returns', labelKey: 'pharmacy.purchasing.m.ret.back' })]);
  if (g.blocked) return g.blocked;
  if (!/^[\w-]{1,64}$/.test(id)) notFound();
  const { access, t, locale } = g;
  const r = await query(get, { ...access.placeInput, returnId: id });
  const values = r.returnValue ? (['IQD', 'USD'] as const).filter((c) => r.returnValue![c] !== undefined) : [];
  return (
    <>
      <PageHeader className="max-sm:px-4" above={g.back} title={<bdi dir="ltr">{r.number ?? r.id.slice(0, 8)}</bdi>} description={<span dir="auto">{r.supplierName}</span>} />
      <div className="flex min-w-0 flex-col gap-8 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        <section aria-labelledby="ret-head" className="flex min-w-0 flex-col gap-3" data-testid="return-head">
          <h2 id="ret-head" className="text-md font-semibold text-text">
            {t('pharmacy.purchasing.m.ret.detailHeader')}
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm text-text sm:max-w-xl">
            <dt className="text-muted">{t('pharmacy.purchasing.po.supplier')}</dt>
            <dd>
              <Link href={`/pharmacy/purchasing/suppliers/${r.supplierId}`} dir="auto" className="underline underline-offset-2">
                {r.supplierName}
              </Link>
            </dd>
            <dt className="text-muted">{t('pharmacy.purchasing.m.ret.date')}</dt>
            <dd>
              <bdi dir="ltr">{phDate(r.createdAt, locale)}</bdi>
            </dd>
            <dt className="text-muted">{t('pharmacy.purchasing.m.reason')}</dt>
            <dd dir="auto">{r.reason}</dd>
            {r.note && (
              <>
                <dt className="text-muted">{t('pharmacy.purchasing.po.note')}</dt>
                <dd dir="auto">{r.note}</dd>
              </>
            )}
            {values.length > 0 && (
              <>
                <dt className="text-muted">{t('pharmacy.purchasing.m.ret.value')}</dt>
                <dd data-testid="return-value" className="flex flex-col">
                  {values.map((c) => (
                    <bdi key={c} dir="ltr" className="tabular-nums">
                      {moneyText(r.returnValue![c]!, c, locale)}
                    </bdi>
                  ))}
                </dd>
              </>
            )}
          </dl>
          {r.returnValue !== undefined && <p className="max-w-[72ch] text-sm text-muted">{t('pharmacy.purchasing.m.ret.valueNote')}</p>}
        </section>

        <section aria-labelledby="ret-lines" className="flex min-w-0 flex-col gap-3" data-testid="return-lines">
          <h2 id="ret-lines" className="text-md font-semibold text-text">
            {t('pharmacy.purchasing.m.ret.lines')}
          </h2>
          <ol className="flex flex-col border-t border-line">
            {r.lines.map((l) => (
              <li key={l.lineNo} className="flex min-w-0 flex-col gap-1 border-b border-line py-3 text-sm text-text">
                <p dir="auto" className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                  {l.productName}
                </p>
                <p className="flex flex-wrap gap-x-5 gap-y-0.5 text-muted">
                  <span>
                    {t('pharmacy.stock.batch.lot')}: <bdi dir="ltr">{l.lot}</bdi>
                  </span>
                  <span>
                    {t('pharmacy.purchasing.m.inv.expiry')}: <bdi dir="ltr">{phDate(`${l.expiryDate}T00:00:00.000Z`, locale)}</bdi>
                  </span>
                  <span>{t(`pharmacy.stock.bucket.${l.bucket.toLowerCase()}`)}</span>
                  <span className="text-text">
                    {t('pharmacy.purchasing.m.ret.qtyReturned')}: <bdi dir="ltr">{formatNumber(l.qty)}</bdi> {l.baseUnit}
                  </span>
                  {l.unitCostMinor != null && l.costCurrency && (
                    <span>
                      {t('pharmacy.purchasing.m.inv.unitCost')}: <Amount amount={l.unitCostMinor} currency={l.costCurrency} locale={locale} />
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="ret-credits" className="flex min-w-0 flex-col gap-3" data-testid="return-credits">
          <h2 id="ret-credits" className="text-md font-semibold text-text">
            {t('pharmacy.purchasing.m.ret.credits')}
          </h2>
          {r.creditNotes.length === 0 ? (
            <p className="text-sm text-muted">{t('pharmacy.purchasing.m.ret.noCredits')}</p>
          ) : (
            <ul className="flex flex-col border-t border-line">
              {r.creditNotes.map((c) => (
                <li key={c.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-line text-sm text-text">
                  <Link href={`/pharmacy/purchasing/credits/${c.id}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
                    <bdi dir="ltr">{c.number}</bdi>
                  </Link>
                  {c.amountMinor !== undefined && <Amount amount={c.amountMinor} currency={c.currency} locale={locale} className="font-medium" />}
                </li>
              ))}
            </ul>
          )}
          {g.writable.ok && g.mayMoney && (
            <div>
              <Link href={`/pharmacy/purchasing/credits/new?return=${encodeURIComponent(r.id)}`} data-testid="return-record-credit" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
                <NotebookText aria-hidden />
                {t('pharmacy.purchasing.m.ret.recordCredit')}
              </Link>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
