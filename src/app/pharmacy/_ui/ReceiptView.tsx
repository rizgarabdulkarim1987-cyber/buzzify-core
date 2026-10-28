import { ArrowDown, ArrowUp, Equal, ShieldAlert, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import { formatNumber } from '@/lib/pos-format';
import { formatExpiry } from '@/server/domain/pharmacy/expiry';
import { formatPhMoney } from '@/server/domain/pharmacy/money';
import type { ReceiptDetail } from '@/server/pharmacy/receipts';
import type { MovementView } from '@/server/pharmacy/stock-reads';
import { formatDate, formatDateTime } from '@/studio/format';
import { MovementList } from './MovementList';
import { costVariance } from './purchasing-logic';
import { ReceiptStatus } from './ReceiptStatus';

function cost(l: ReceiptDetail['lines'][number], locale: Locale): string | null {
  if (l.unitCostMinor == null || !l.currency) return null;
  try {
    return formatPhMoney({ amount: BigInt(l.unitCostMinor), currency: l.currency }, locale);
  } catch {
    return `${l.unitCostMinor} ${l.currency}`;
  }
}

function money(amount: bigint, currency: 'IQD' | 'USD', locale: Locale): string {
  try {
    return formatPhMoney({ amount, currency }, locale);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** The received cost against the order's: an icon and a sentence, never a colour alone. */
function Variance({ l, t, locale }: { l: ReceiptDetail['lines'][number]; t: Translate; locale: Locale }) {
  if (l.unitCostMinor == null || !l.currency || l.orderUnitCostMinor == null || !l.orderCurrency) return null;
  const v = costVariance({ orderMinor: BigInt(l.orderUnitCostMinor), orderCurrency: l.orderCurrency, receivedMinor: BigInt(l.unitCostMinor), receivedCurrency: l.currency });
  if (v.kind === 'currency') {
    return (
      <span data-variance="currency" className="inline-flex items-center gap-1 text-muted">
        <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
        {t('pharmacy.purchasing.receive.variance.currency')}
      </span>
    );
  }
  if (v.kind === 'same') {
    return (
      <span data-variance="same" className="inline-flex items-center gap-1 text-muted">
        <Equal aria-hidden className="size-3.5 shrink-0" />
        {t('pharmacy.purchasing.receive.variance.same')}
      </span>
    );
  }
  const Icon = v.kind === 'higher' ? ArrowUp : ArrowDown;
  return (
    <span data-variance={v.kind} className="inline-flex items-center gap-1 font-medium text-text">
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {t(`pharmacy.purchasing.receive.variance.${v.kind}`, { amount: money(v.diffMinor, v.currency, locale) })}
    </span>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-text">{children}</dd>
    </div>
  );
}

/**
 * A receipt that can no longer change (confirmed or void), or a draft the person may only read: the delivery's header,
 * every line, and, when the role reads the ledger, the stock changes this receipt made. Cost appears only when the
 * payload carries the cost keys. Server rendered; no motion.
 */
export function ReceiptView({
  receipt,
  movements,
  branchName,
  t,
  locale,
}: {
  receipt: ReceiptDetail;
  /** The receipt's stock changes; null when the role does not read the ledger. */
  movements: MovementView[] | null;
  branchName: string;
  t: Translate;
  locale: Locale;
}) {
  const showCost = receipt.lines.some((l) => 'unitCostMinor' in l);
  const total = receipt.lines.reduce((sum, l) => sum + l.baseQty, 0);
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="receipt-view">
      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Item label={t('pharmacy.receive.col.number')}>
          {receipt.number ? (
            <bdi dir="ltr" data-testid="receipt-number" className="font-medium tabular-nums">
              {receipt.number}
            </bdi>
          ) : (
            <span className="text-muted">{t('pharmacy.receive.noNumber')}</span>
          )}
        </Item>
        <Item label={t('pharmacy.receive.col.status')}>
          <ReceiptStatus status={receipt.status} t={t} />
        </Item>
        <Item label={t('pharmacy.receive.col.branch')}>
          <span dir="auto">{branchName}</span>
        </Item>
        <Item label={t('pharmacy.receive.field.receivedOn')}>
          <bdi dir="ltr">{formatDate(`${receipt.receivedOn}T00:00:00.000Z`, locale)}</bdi>
        </Item>
        <Item label={t('pharmacy.receive.field.supplier')}>
          {receipt.supplierName ? <span dir="auto">{receipt.supplierName}</span> : <span className="text-muted">{t('pharmacy.receive.none')}</span>}
        </Item>
        <Item label={t('pharmacy.receive.field.reference')}>
          {receipt.reference ? <bdi dir="ltr">{receipt.reference}</bdi> : <span className="text-muted">{t('pharmacy.receive.none')}</span>}
        </Item>
        {receipt.purchaseOrderId && (
          <Item label={t('pharmacy.purchasing.receive.order')}>
            <Link href={`/pharmacy/purchasing/orders/${receipt.purchaseOrderId}`} data-testid="receipt-order-link" className="underline underline-offset-2">
              <bdi dir="ltr" className="tabular-nums">
                {receipt.purchaseOrderNumber ?? ''}
              </bdi>
            </Link>
          </Item>
        )}
        {receipt.confirmedAt && (
          <Item label={t('pharmacy.receive.view.confirmedAt')}>
            <bdi dir="ltr">{formatDateTime(receipt.confirmedAt, locale)}</bdi>
          </Item>
        )}
        <Item label={t('pharmacy.receive.view.total')}>
          <span>
            {t('pharmacy.receive.totals.lines', { count: receipt.lineCount })} · {t('pharmacy.receive.totals.units', { count: formatNumber(total) })}
          </span>
        </Item>
        {receipt.note && (
          <div className="sm:col-span-2 lg:col-span-4">
            <dt className="text-muted">{t('pharmacy.receive.field.note')}</dt>
            <dd dir="auto" className="whitespace-pre-wrap break-words text-text">
              {receipt.note}
            </dd>
          </div>
        )}
      </dl>

      <section aria-labelledby="receipt-lines" className="flex flex-col gap-2">
        <h2 id="receipt-lines" className="text-md font-semibold text-text">
          {t('pharmacy.receive.section.lines')}
        </h2>
        <ul className="flex flex-col border-t border-line">
          {receipt.lines.map((l) => (
            <li key={l.lineNo} data-testid="receipt-view-line" className="flex min-w-0 flex-col gap-1.5 border-b border-line py-3">
              <p dir="auto" className="min-w-0 break-words text-base font-medium text-text [overflow-wrap:anywhere]">
                {l.productName}
              </p>
              <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-text">
                <span>
                  <span className="text-muted">{t('pharmacy.receive.field.qty')}: </span>
                  <bdi dir="ltr" className="tabular-nums">
                    {formatNumber(l.qty)}
                  </bdi>{' '}
                  <span dir="auto">{l.unitLabel}</span>
                </span>
                {l.bonusQty > 0 && (
                  <span>
                    <span className="text-muted">{t('pharmacy.receive.field.bonus')}: </span>
                    <bdi dir="ltr" className="tabular-nums">
                      {formatNumber(l.bonusQty)}
                    </bdi>
                  </span>
                )}
                <span>
                  <span className="text-muted">{t('pharmacy.receive.view.baseQty')}: </span>
                  <bdi dir="ltr" className="tabular-nums">
                    {formatNumber(l.baseQty)}
                  </bdi>
                </span>
                <span>
                  <span className="text-muted">{t('pharmacy.receive.field.lot')}: </span>
                  <bdi dir="ltr" data-testid="receipt-view-lot">
                    {l.lot}
                  </bdi>
                </span>
                <span>
                  <span className="text-muted">{t('pharmacy.receive.field.expiry')}: </span>
                  <bdi dir="ltr">{formatExpiry({ expiryDate: l.expiryDate, expiryPrecision: l.expiryPrecision })}</bdi>
                </span>
                {showCost && (
                  <span data-cost>
                    <span className="text-muted">{t('pharmacy.receive.field.cost')}: </span>
                    <bdi dir="ltr" className="tabular-nums">
                      {cost(l, locale) ?? t('pharmacy.receive.none')}
                    </bdi>
                  </span>
                )}
                {showCost && l.orderUnitCostMinor != null && l.orderCurrency && (
                  <span data-cost data-testid="receipt-order-cost">
                    <span className="text-muted">{t('pharmacy.purchasing.receive.orderCost')}: </span>
                    <bdi dir="ltr" className="tabular-nums">
                      {money(BigInt(l.orderUnitCostMinor), l.orderCurrency, locale)}
                    </bdi>{' '}
                    <Variance l={l} t={t} locale={locale} />
                  </span>
                )}
              </p>
              {(l.freeOfCharge || l.acceptExpired) && (
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-text">
                  {l.freeOfCharge && <span>{t('pharmacy.receive.free.label')}</span>}
                  {l.acceptExpired && (
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldAlert aria-hidden className="size-3.5 shrink-0" />
                      {t('pharmacy.receive.view.quarantined')}
                    </span>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {movements !== null && receipt.status === 'CONFIRMED' && (
        <section aria-labelledby="receipt-moves" className="flex flex-col gap-2">
          <h2 id="receipt-moves" className="text-md font-semibold text-text">
            {t('pharmacy.receive.view.movements')}
          </h2>
          {movements.length === 0 ? (
            <p className="text-sm text-muted">{t('pharmacy.receive.view.noMovements')}</p>
          ) : (
            <MovementList items={movements} t={t} reverseBranchId={null} />
          )}
        </section>
      )}
    </div>
  );
}
