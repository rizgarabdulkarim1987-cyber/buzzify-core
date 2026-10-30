import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { OrderActions } from '@/app/pharmacy/_ui/OrderActions';
import { FigureBar, OrderStatus } from '@/app/pharmacy/_ui/purchasing-parts';
import { ReceiptStatus } from '@/app/pharmacy/_ui/ReceiptStatus';
import { formatNumber } from '@/lib/pos-format';
import { formatPhMoney } from '@/server/domain/pharmacy/money';
import { getPhPlaces } from '@/server/pharmacy/actor';
import { get, receipts } from '@/server/pharmacy/queries/purchase-orders';
import { query } from '@/server/studio/framework/invoke';
import { phDate, phDateTime } from '@/app/pharmacy/_ui/ph-date';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.po.title') };
}

/**
 * One order: header and state, every line with ordered / received / invoiced as figures and a bar, the actions its state
 * allows, and the receipts that answered it. Money only when the server sent it (a role with cost.view).
 */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, g] = await Promise.all([params, purchasingGate('pharmacy.purchasing.po.title', { href: '/pharmacy/purchasing/orders', labelKey: 'pharmacy.purchasing.po.back' })]);
  if (g.blocked) return g.blocked;
  if (!/^[\w-]{1,64}$/.test(id)) notFound();
  const { access, t, locale } = g;
  const [order, answered, places] = await Promise.all([
    query(get, { ...access.placeInput, purchaseOrderId: id }),
    query(receipts, { ...access.placeInput, purchaseOrderId: id }),
    getPhPlaces(),
  ]);
  const branches = places.find((p) => p.restaurantId === access.placeInput.restaurantId)?.branches ?? [];
  const branchName = branches.find((b) => b.id === order.branchId)?.name ?? '';
  const anyReceived = order.lines.some((l) => l.receivedQty + l.receivedBonus > 0);
  const money = (amount: string, currency: 'IQD' | 'USD') => {
    try {
      return formatPhMoney({ amount: BigInt(amount), currency }, locale);
    } catch {
      return `${amount} ${currency}`;
    }
  };
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        above={g.back}
        title={order.number ? t('pharmacy.purchasing.po.viewTitle', { number: order.number }) : t('pharmacy.purchasing.po.viewDraftTitle')}
      />
      <div className="flex min-w-0 flex-col gap-6 px-4 pb-10 sm:px-8" data-testid="order-view">
        {g.writeNotice}
        <OfflineNotice />
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted">{t('pharmacy.receive.col.status')}</dt>
            <dd data-testid="order-status">
              <OrderStatus status={order.status} t={t} />
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted">{t('pharmacy.purchasing.po.supplier')}</dt>
            <dd dir="auto" className="min-w-0 break-words text-text">
              <Link href={`/pharmacy/purchasing/suppliers/${order.supplierId}`} className="underline underline-offset-2">
                {order.supplierName}
              </Link>
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted">{t('pharmacy.receive.col.branch')}</dt>
            <dd dir="auto" className="text-text">
              {branchName}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted">{t('pharmacy.purchasing.po.currency')}</dt>
            <dd className="text-text">
              <bdi dir="ltr">{order.currency}</bdi>
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted">{t('pharmacy.purchasing.po.expectedOn')}</dt>
            <dd className="text-text">{order.expectedOn ? <bdi dir="ltr">{phDate(`${order.expectedOn}T00:00:00.000Z`, locale)}</bdi> : t('pharmacy.receive.none')}</dd>
          </div>
          {order.orderedAt && (
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-muted">{t('pharmacy.purchasing.po.orderedAt')}</dt>
              <dd className="text-text">
                <bdi dir="ltr">{phDateTime(order.orderedAt, locale)}</bdi>
              </dd>
            </div>
          )}
          {order.totalMinor !== undefined && (
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-muted">{t('pharmacy.purchasing.po.total')}</dt>
              <dd data-testid="order-total" className="font-medium text-text">
                <bdi dir="ltr" className="tabular-nums">
                  {money(order.totalMinor, order.currency)}
                </bdi>
              </dd>
            </div>
          )}
          {order.closeReason && (
            <div className="sm:col-span-2 lg:col-span-4">
              <dt className="text-muted">{t('pharmacy.purchasing.po.closedBecause')}</dt>
              <dd dir="auto" className="break-words text-text">
                {order.closeReason}
              </dd>
            </div>
          )}
          {order.note && (
            <div className="sm:col-span-2 lg:col-span-4">
              <dt className="text-muted">{t('pharmacy.purchasing.po.note')}</dt>
              <dd dir="auto" className="whitespace-pre-wrap break-words text-text">
                {order.note}
              </dd>
            </div>
          )}
        </dl>

        <OrderActions
          orderId={order.id}
          version={order.version}
          status={order.status}
          anyReceived={anyReceived}
          writable={g.writable.ok}
          atBranch={access.place.branchId === order.branchId}
        />

        <section aria-labelledby="po-lines" className="flex flex-col gap-2">
          <h2 id="po-lines" className="text-md font-semibold text-text">
            {t('pharmacy.purchasing.po.section.lines')}
          </h2>
          <ul className="flex flex-col border-t border-line">
            {order.lines.map((l) => (
              <li key={l.lineId} data-testid="order-line" className="flex min-w-0 flex-col gap-2 border-b border-line py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p dir="auto" className="min-w-0 break-words text-base font-medium text-text [overflow-wrap:anywhere]">
                    {l.productName} <span className="text-sm font-normal text-muted">({l.unitLabel})</span>
                  </p>
                  {l.unitCostMinor !== undefined && (
                    <p className="text-sm text-text">
                      <bdi dir="ltr" className="tabular-nums">
                        {money(l.unitCostMinor, order.currency)}
                      </bdi>
                      {l.lineTotalMinor !== undefined && (
                        <>
                          {' · '}
                          <bdi dir="ltr" className="font-medium tabular-nums">
                            {money(l.lineTotalMinor, order.currency)}
                          </bdi>
                        </>
                      )}
                    </p>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <FigureBar label={t('pharmacy.purchasing.po.figure.ordered')} value={l.qtyOrdered + l.bonusOrdered} of={l.qtyOrdered + l.bonusOrdered} />
                  <FigureBar label={t('pharmacy.purchasing.po.figure.received')} value={l.receivedQty + l.receivedBonus} of={l.qtyOrdered + l.bonusOrdered} />
                  <FigureBar label={t('pharmacy.purchasing.po.figure.invoiced')} value={l.invoicedQty} of={l.qtyOrdered} />
                </div>
                <p className="text-sm text-muted">
                  {t('pharmacy.purchasing.po.figure.summary', {
                    ordered: formatNumber(l.qtyOrdered),
                    bonus: formatNumber(l.bonusOrdered),
                    received: formatNumber(l.receivedQty + l.receivedBonus),
                    left: formatNumber(l.toReceive),
                  })}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="po-receipts" className="flex flex-col gap-2" data-testid="order-receipts">
          <h2 id="po-receipts" className="text-md font-semibold text-text">
            {t('pharmacy.purchasing.po.receipts')}
          </h2>
          {answered.length === 0 ? (
            <p className="text-sm text-muted">{t('pharmacy.purchasing.po.receiptsNone')}</p>
          ) : (
            <ul className="flex flex-col border-t border-line">
              {answered.map((r) => (
                <li key={r.id} className="border-b border-line">
                  <Link href={`/pharmacy/stock/receive/${r.id}`} className="flex min-h-11 flex-wrap items-center gap-x-6 gap-y-1 px-1 py-2 text-sm text-text hover:bg-hover">
                    <bdi dir="ltr" className="font-medium tabular-nums">
                      {r.number ?? t('pharmacy.receive.noNumber')}
                    </bdi>
                    <ReceiptStatus status={r.status} t={t} />
                    <bdi dir="ltr">{phDate(`${r.receivedOn}T00:00:00.000Z`, locale)}</bdi>
                    <span>{t('pharmacy.receive.totals.lines', { count: r.lines.length })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
