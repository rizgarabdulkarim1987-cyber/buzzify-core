import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { peopleOf } from '@/app/pharmacy/_ui/people';
import { BackLink, Forbidden, PickBranch } from '@/app/pharmacy/_ui/PageGate';
import { Money, Row, FIGURES } from '@/app/pharmacy/_ui/money-parts';
import { PrintButton } from '@/app/pharmacy/_ui/PrintDialog';
import { Num } from '@/app/pharmacy/_ui/sell-parts';
import { formatUtc, personLabel, shortId } from '@/app/pharmacy/_ui/shifts-logic';
import { get } from '@/server/pharmacy/queries/returns';
import { query } from '@/server/studio/framework/invoke';
import { StudioError } from '@/server/studio/framework/result';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.returns.detail') };
}

/** One return: what came back (lot and expiry), the refund and its method, the reason, and the slip to print. */
export default async function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, access, locale] = await Promise.all([params, catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const { actor, place, placeInput } = access;
  const back = <BackLink href="/pharmacy/returns">{t('pharmacy.returns.back')}</BackLink>;
  if (actor.role === null || (!roleMay(actor, 'report.view') && !roleMay(actor, 'return.approve'))) {
    return (
      <>
        <PageHeader className="max-sm:px-4" title={t('pharmacy.returns.detail')} above={back} />
        <Forbidden t={t} scope="returns" support={actor.role === null} />
      </>
    );
  }
  if (!place.branchId) {
    return (
      <>
        <PageHeader className="max-sm:px-4" title={t('pharmacy.returns.detail')} above={back} />
        <PickBranch t={t} scope="returns" />
      </>
    );
  }
  let r;
  try {
    r = await query(get, { ...placeInput, returnId: id.slice(0, 64) });
  } catch (error) {
    if (error instanceof StudioError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
  const names = await peopleOf(placeInput, [r.approvedById]);
  return (
    <>
      <PageHeader className="max-sm:px-4" title={<Num>{r.number ?? shortId(r.id)}</Num>} description={t('pharmacy.returns.detail')} above={back} />
      <div className="flex min-w-0 flex-col gap-6 px-4 pb-10 sm:px-8" data-testid="return-detail">
        <div className="flex flex-wrap gap-2">
          <PrintButton target={{ kind: 'return', id: r.id, number: r.number }} label={t('pharmacy.returns.slip.open')} />
          <Link href={`/pharmacy/returns/${r.id}/slip`} data-testid="slip-a4-open" className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-strong bg-raised px-3 text-sm font-medium text-text hover:bg-hover">
            {t('pharmacy.print.slip.open')}
          </Link>
          <Link href={`/pharmacy/sales/${r.saleId}`} className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-strong bg-raised px-3 text-sm font-medium text-text hover:bg-hover">
            {t('pharmacy.returns.backToSale')} <Num>{r.saleNumber ?? ''}</Num>
          </Link>
        </div>
        <dl className={`${FIGURES} sm:max-w-[34rem]`}>
          <Row label={t('pharmacy.returns.refund')} strong testId="detail-refund">
            <Money minor={r.refundMinor} currency={r.currency} />
          </Row>
          <Row label={t('pharmacy.returns.method')}>{t(`pharmacy.method.${r.refundMethod}`)}</Row>
          <Row label={t('pharmacy.shifts.openedAt')}>
            <Num>{formatUtc(r.createdAt)}</Num>
          </Row>
          <Row label={t('pharmacy.returns.approvedBy')}>
            <span dir="auto" className="break-words [overflow-wrap:anywhere]">{personLabel(names, r.approvedById)}</span>
          </Row>
        </dl>
        <p className="text-sm text-text">
          <span className="text-muted">{t('pharmacy.returns.reason')}: </span>
          <span dir="auto" className="break-words [overflow-wrap:anywhere]" data-testid="detail-reason">
            {r.reason}
          </span>
        </p>
        <section aria-labelledby="ret-lines" className="flex flex-col gap-2">
          <h2 id="ret-lines" className="text-md font-semibold text-text">
            {t('pharmacy.sales.lines')}
          </h2>
          <ul className="flex flex-col border-t border-line">
            {r.lines.map((l) => (
              <li key={l.id} data-testid="return-detail-line" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-3 text-sm">
                <span className="min-w-0 break-words text-text" dir="auto">
                  {l.productName} · <Num>{l.lot}</Num> · <Num>{l.expiryDate}</Num> · <Num>{l.baseQty}</Num>
                </span>
                <Money minor={l.refundMinor} currency={r.currency} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
