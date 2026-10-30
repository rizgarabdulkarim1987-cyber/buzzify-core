import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { peopleOf } from '@/app/pharmacy/_ui/people';
import { BackLink, Forbidden, PickBranch } from '@/app/pharmacy/_ui/PageGate';
import { Money, Row, FIGURES, SaleStatus } from '@/app/pharmacy/_ui/money-parts';
import { SaleActions } from '@/app/pharmacy/_ui/SaleActions';
import { Num } from '@/app/pharmacy/_ui/sell-parts';
import { formatUtc, personLabel, shortId, type RefundMethod } from '@/app/pharmacy/_ui/shifts-logic';
import { list as listReturns, returnable } from '@/server/pharmacy/queries/returns';
import { get } from '@/server/pharmacy/queries/sales';
import { query } from '@/server/studio/framework/invoke';
import { StudioError } from '@/server/studio/framework/result';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.sales.detail') };
}

/**
 * One sale: lines with what was returned of each, discounts, rounding, payments and change, the returns made against it,
 * and the actions (print or reprint, return, cancel). A cashier reads the sale (while their shift is open) but is told
 * why they cannot return it. Nothing here carries a cost or a patient field.
 */
export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, access, locale] = await Promise.all([params, catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const { actor, place, placeInput } = access;
  const back = <BackLink href="/pharmacy/sales">{t('pharmacy.sales.back')}</BackLink>;
  if (actor.role === null || (!roleMay(actor, 'shift.use') && !roleMay(actor, 'report.view'))) {
    return (
      <>
        <PageHeader className="max-sm:px-4" title={t('pharmacy.sales.detail')} above={back} />
        <Forbidden t={t} scope="sales" support={actor.role === null} />
      </>
    );
  }
  if (!place.branchId) {
    return (
      <>
        <PageHeader className="max-sm:px-4" title={t('pharmacy.sales.detail')} above={back} />
        <PickBranch t={t} scope="sales" />
      </>
    );
  }
  let sale;
  try {
    sale = await query(get, { ...placeInput, saleId: id.slice(0, 64) });
  } catch (error) {
    if (error instanceof StudioError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
  const names = await peopleOf(placeInput, [sale.soldById]);
  // A credit payment is not a way to hand money back: the refund choices are the drawer methods the sale was paid by.
  const refundable = sale.methods.filter((m): m is RefundMethod => m !== 'CREDIT');
  const mayRead = roleMay(actor, 'return.approve') || roleMay(actor, 'report.view');
  const [can, made] = mayRead
    ? await Promise.all([query(returnable, { ...placeInput, saleId: sale.id }), query(listReturns, { ...placeInput, saleId: sale.id, pageSize: 50 })])
    : [null, null];
  const returnWrite = access.writable('return.approve');
  const mayReturn = roleMay(actor, 'return.approve') && returnWrite.ok;
  const cur = sale.currency;

  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        title={<Num>{sale.number ?? t('pharmacy.sales.noNumber')}</Num>}
        description={t('pharmacy.sales.detail')}
        above={back}
        actions={<SaleStatus status={sale.status} t={t} />}
      />
      <div className="flex min-w-0 flex-col gap-6 px-4 pb-10 sm:px-8" data-testid="sale-detail">
        <SaleActions
          sale={{ id: sale.id, number: sale.number, status: sale.status }}
          mayReturn={mayReturn}
          roleCannotReturn={!roleMay(actor, 'return.approve')}
          returnable={can?.returnable ?? false}
          returnWindow={can?.window ?? null}
          writeBlocked={roleMay(actor, 'return.approve') && !returnWrite.ok && returnWrite.reason !== 'role' ? returnWrite : null}
          cancelLines={(can?.lines ?? []).filter((l) => l.remainingBaseQty > 0).map((l) => ({ saleLineId: l.id, baseQty: l.remainingBaseQty }))}
          currency={sale.currency}
          paid={can?.paidMethods ?? refundable}
          defaultMethod={can?.defaultRefundMethod ?? refundable[0] ?? 'CASH'}
        />

        <p className="text-sm text-muted">
          <Num>{formatUtc(sale.completedAt ?? sale.createdAt)}</Num> · {t('pharmacy.sales.soldBy')} <span dir="auto" className="break-words [overflow-wrap:anywhere]">{personLabel(names, sale.soldById)}</span>
        </p>

        <section aria-labelledby="lines" className="flex min-w-0 flex-col gap-2">
          <h2 id="lines" className="text-md font-semibold text-text">
            {t('pharmacy.sales.lines')}
          </h2>
          <ul className="flex flex-col border-t border-line" data-testid="sale-lines">
            {sale.lines.map((l) => {
              const returned = l.allocations.reduce((s, a) => s + a.returnedBaseQty, 0);
              return (
                <li key={l.lineNo} data-testid="sale-line" className="flex min-w-0 flex-col gap-1 border-b border-line py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="min-w-0 break-words font-medium text-text" dir="auto">
                      {l.productName}
                    </span>
                    <span className="font-medium text-text" data-testid="line-total-cell">
                      <Money minor={l.totalMinor} currency={cur} />
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-muted">
                    <span>
                      <Num>{l.qty}</Num> × <span dir="auto">{l.unitLabel}</span> · <Money minor={l.unitPriceMinor} currency={cur} />
                    </span>
                    {l.discountMinor !== '0' && (
                      <span>
                        {t('pharmacy.sell.totals.discount')}: −<Money minor={l.discountMinor} currency={cur} />
                      </span>
                    )}
                    <span>
                      {t('pharmacy.sales.lots')}: {l.allocations.map((a) => a.lot).join(', ')}
                    </span>
                  </div>
                  <p className={returned > 0 ? 'font-medium text-text' : 'text-muted'} data-testid="line-returned">
                    {t('pharmacy.sales.returnedQty', { returned, sold: l.baseQty })}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="totals" className="flex flex-col gap-2">
          <h2 id="totals" className="text-md font-semibold text-text">
            {t('pharmacy.sales.totals')}
          </h2>
          <dl className={`${FIGURES} sm:max-w-[34rem]`} data-testid="sale-figures">
            <Row label={t('pharmacy.sell.totals.subtotal')}>
              <Money minor={sale.subtotalMinor} currency={cur} />
            </Row>
            {sale.discountMinor !== '0' && (
              <Row label={t('pharmacy.sell.totals.discount')}>
                −<Money minor={sale.discountMinor} currency={cur} />
              </Row>
            )}
            {sale.roundingMinor !== '0' && (
              <Row label={t('pharmacy.sell.totals.rounding')}>
                <Money minor={sale.roundingMinor} currency={cur} signed />
              </Row>
            )}
            <Row label={t('pharmacy.sell.totals.total')} strong testId="detail-total">
              <Money minor={sale.totalMinor} currency={cur} />
            </Row>
            {sale.payments.map((p) => (
              <Row key={p.id} label={t(`pharmacy.method.${p.method}`)} testId={p.method === 'CREDIT' ? 'detail-credit' : 'detail-payment'}>
                <Money minor={p.amountMinor} currency={cur} />
              </Row>
            ))}
            {sale.customer && (
              <Row label={t('pharmacy.credit.onAccount')} testId="detail-customer">
                <Link href={`/pharmacy/customers/${sale.customer.id}`} className="inline-flex min-h-11 items-center rounded-md underline underline-offset-2 hover:bg-hover" dir="auto">
                  {sale.customer.name}
                </Link>
              </Row>
            )}
            <Row label={t('pharmacy.sell.pay.change')} testId="detail-change">
              <Money minor={sale.changeMinor} currency={cur} />
            </Row>
          </dl>
        </section>

        {made && made.items.length > 0 && (
          <section aria-labelledby="made" className="flex flex-col gap-2">
            <h2 id="made" className="text-md font-semibold text-text">
              {t('pharmacy.sales.returnsMade')}
            </h2>
            <ul className="flex flex-col border-t border-line" data-testid="sale-returns">
              {made.items.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line py-3 text-sm">
                  <Link href={`/pharmacy/returns/${r.id}`} className="inline-flex min-h-11 items-center rounded-md px-1 font-semibold text-text underline underline-offset-2 hover:bg-hover">
                    <Num>{r.number ?? shortId(r.id)}</Num>
                  </Link>
                  <Money minor={r.refundMinor} currency={r.currency} />
                  <span className="text-muted">{t(`pharmacy.method.${r.refundMethod}`)}</span>
                  <span className="ms-auto text-muted">
                    <Num>{formatUtc(r.createdAt)}</Num>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
