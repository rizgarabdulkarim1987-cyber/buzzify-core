import { CalendarClock, CircleCheck, ExternalLink, History, PackageX, Pill, TrendingDown, Truck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import { formatNumber, ltr } from '@/lib/pos-format';
import { formatPhMoney } from '@/server/domain/pharmacy/money';
import { formatExpiry } from '@/server/domain/pharmacy/expiry';
import type { BatchBuckets, BatchView, BucketTotals, ProductBalance } from '@/server/pharmacy/stock-reads';
import { BatchActions } from './BatchActions';
import { batchChips, StockChip } from './StockChip';
import { sellableTotal, stockState, type StockState } from './stock-logic';

const BUCKET_KEYS = ['available', 'sellable', 'reserved', 'quarantine', 'damaged'] as const;

/** The five numbers of one place, label and value side by side so they wrap on a phone and never scroll. */
function Totals({ totals, t, minQty }: { totals: BucketTotals; t: Translate; minQty?: number }) {
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {BUCKET_KEYS.map((key) => (
        <div key={key} className="flex items-baseline gap-1.5">
          <dt className="text-ph-muted">{t(`pharmacy.stock.col.${key}`)}</dt>
          <dd className="font-medium text-ph-text tabular-nums" dir="ltr">
            {formatNumber(totals[key])}
          </dd>
        </div>
      ))}
      {minQty !== undefined && minQty > 0 && (
        <div className="flex items-baseline gap-1.5">
          <dt className="text-ph-muted">{t('pharmacy.stock.col.min')}</dt>
          <dd className="font-medium text-ph-text tabular-nums" dir="ltr">
            {formatNumber(minQty)}
          </dd>
        </div>
      )}
    </dl>
  );
}

function money(batch: BatchView, locale: Locale): string | null {
  if (batch.unitCostMinor == null || !batch.currency) return null;
  try {
    return formatPhMoney({ amount: BigInt(batch.unitCostMinor), currency: batch.currency }, locale);
  } catch {
    return null;
  }
}

function priceText(product: ProductBalance, locale: Locale): string | null {
  if (!product.price) return null;
  try {
    return formatPhMoney({ amount: BigInt(product.price.amountMinor), currency: product.price.currency }, locale);
  } catch {
    return null;
  }
}

export interface StockListProps {
  items: ProductBalance[];
  t: Translate;
  locale: Locale;
  today: string;
  branchNames: Record<string, string>;
  /** Whether the batches show the cost: the payload carries it only for a role with `cost.view`. */
  showCost: boolean;
  /** The chosen branch when the person may change stock in it; null hides every change control. */
  adjustBranchId: string | null;
  /** Units on the road per product and destination (`ph.transfers.inTransit`); absent for a role without `transfer.manage`. Read only: it changes no figure above. */
  inTransit?: Record<string, { toBranchId: string; qty: number }[]>;
}

/** Desktop columns: tile, name, unit, price, quantity, status. A phone keeps the name, the quantity and the status. */
const ROW = 'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-4 md:grid-cols-[38px_minmax(0,1fr)_minmax(0,6rem)_minmax(0,7rem)_minmax(0,5rem)_minmax(0,7.5rem)]';

const STATE_LOOK: Record<StockState, string> = {
  ok: 'bg-ph-g1 text-ph-g6',
  low: 'bg-ph-amber-wash text-ph-amber-ink',
  expiring: 'bg-ph-blue-wash text-ph-blue',
  out: 'bg-ph-red-wash text-ph-red',
};

const STATE_ICON: Record<StockState, ReactNode> = {
  ok: <CircleCheck aria-hidden />,
  low: <TrendingDown aria-hidden />,
  expiring: <CalendarClock aria-hidden />,
  out: <PackageX aria-hidden />,
};

/** The column labels over the rows, on a desktop only; each row also names its cells for a screen reader. */
export function StockListHead({ t }: { t: Translate }) {
  return (
    <div aria-hidden data-testid="stock-head" className={`${ROW} sticky top-0 z-10 hidden min-h-10 border-b border-ph-line bg-ph-card text-xs font-semibold text-ph-muted md:grid`}>
      <span />
      <span>{t('pharmacy.stock.head.product')}</span>
      <span>{t('pharmacy.stock.head.unit')}</span>
      <span className="text-end">{t('pharmacy.stock.head.price')}</span>
      <span className="text-end">{t('pharmacy.stock.head.qty')}</span>
      <span>{t('pharmacy.stock.head.status')}</span>
    </div>
  );
}

/**
 * One 52px row per product: a tile, the name over its generic name or barcode, the base unit, the price, the sellable
 * quantity and the status in words. Each row is the browser's own disclosure (no animation) that opens on the branch
 * totals, what is on the road, and the batches in the order the server gave: first to expire first. Each batch states its
 * condition as an icon and a word; lots, dates and numbers read left to right inside right-to-left text.
 */
export function StockList({ items, t, locale, today, branchNames, showCost, adjustBranchId, inTransit }: StockListProps) {
  const nameOf = (branchId: string) => branchNames[branchId] ?? branchId.slice(0, 8);
  return (
    <ul aria-label={t('pharmacy.stock.title')} className="flex flex-col">
      {items.map((product) => {
        const detail = [product.strength, product.form].filter((part) => part.trim() !== '').join(' · ');
        const second = [product.genericName, product.barcode ?? ''].filter((part) => part.trim() !== '').join(' · ') || detail;
        const state = stockState(product, today);
        const many = product.branches.length > 1;
        const price = priceText(product, locale);
        return (
          <li key={product.productId} data-testid="stock-row" className="min-w-0">
            <details data-testid="stock-batches" className="min-w-0">
              <summary className={`${ROW} relative h-[52px] min-h-11 cursor-pointer list-none border-b border-ph-line hover:bg-ph-canvas [&::-webkit-details-marker]:hidden`}>
                <span aria-hidden className={`hidden size-[38px] place-items-center rounded-ph-xl md:grid [&_svg]:size-5 ${STATE_LOOK[state]}`}>
                  <Pill />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span dir="auto" data-testid="stock-name" className="truncate text-sm font-semibold text-ph-text">
                    {product.tradeName}
                  </span>
                  {second && (
                    <span dir="auto" className="truncate text-xs text-ph-muted">
                      {second}
                    </span>
                  )}
                </span>
                <span dir="auto" className="hidden truncate text-sm text-ph-muted md:block">
                  <span className="sr-only">{t('pharmacy.stock.head.unit')}: </span>
                  {product.baseUnit ?? '—'}
                </span>
                <span className="hidden truncate text-end text-sm tabular-nums text-ph-text md:block">
                  <span className="sr-only">{t('pharmacy.stock.head.price')}: </span>
                  {price ? <bdi dir="ltr">{price}</bdi> : <span className="text-ph-muted">{t('pharmacy.stock.noPrice')}</span>}
                </span>
                <span className="text-end text-sm font-bold tabular-nums text-ph-text">
                  <span className="sr-only">{t('pharmacy.stock.head.qty')}: </span>
                  <bdi dir="ltr" data-testid="stock-qty">
                    {formatNumber(sellableTotal(product))}
                  </bdi>
                </span>
                <span
                  data-state={state}
                  className={`inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold [&_svg]:size-3.5 [&_svg]:shrink-0 ${STATE_LOOK[state]}`}
                >
                  {STATE_ICON[state]}
                  {t(`pharmacy.stock.state.${state}`)}
                </span>
              </summary>

              <div className="flex min-w-0 flex-col gap-2 border-b border-ph-line bg-ph-canvas px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <div className="flex min-w-0 flex-col">
                    <span dir="auto" className="break-words text-base font-semibold text-ph-text [overflow-wrap:anywhere]">
                      {product.tradeName}
                    </span>
                    {detail && (
                      <span dir="auto" className="break-words text-sm text-ph-muted">
                        {detail}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/pharmacy/catalog/${product.productId}`}
                      className="inline-flex min-h-11 items-center gap-2 rounded-ph-xl px-2 text-sm font-medium text-ph-text underline underline-offset-2 hover:bg-ph-card"
                    >
                      <ExternalLink aria-hidden className="size-4 shrink-0" />
                      {t('pharmacy.stock.openProduct')}
                    </Link>
                    <Link
                      href={`/pharmacy/stock/movements?product=${encodeURIComponent(product.productId)}`}
                      className="inline-flex min-h-11 items-center gap-2 rounded-ph-xl px-2 text-sm font-medium text-ph-text underline underline-offset-2 hover:bg-ph-card"
                    >
                      <History aria-hidden className="size-4 shrink-0" />
                      {t('pharmacy.stock.history')}
                    </Link>
                  </div>
                </div>

                {product.branches.map((branch) => (
                  <div key={branch.branchId} className="flex flex-col gap-0.5">
                    {many && (
                      <span dir="auto" className="text-xs font-medium text-ph-muted">
                        {t('pharmacy.stock.col.branch')}: {nameOf(branch.branchId)}
                      </span>
                    )}
                    <Totals totals={branch} minQty={branch.minQty} t={t} />
                  </div>
                ))}

                {(inTransit?.[product.productId] ?? []).map((road) => (
                  <p key={road.toBranchId} data-testid="stock-in-transit" className="flex items-start gap-2 text-sm text-ph-text">
                    <Truck aria-hidden className="mt-px size-4 shrink-0 text-ph-muted" />
                    <span className="min-w-0">{t('pharmacy.transfers.stockInTransit', { branch: `⁨${nameOf(road.toBranchId)}⁩`, qty: formatNumber(road.qty) })}</span>
                  </p>
                ))}

                <p className="text-sm font-semibold text-ph-text">{t('pharmacy.stock.batches', { count: product.batches.length })}</p>
                {product.batches.length === 0 ? (
                  <p className="text-sm text-ph-muted">{t('pharmacy.stock.noBatches')}</p>
                ) : (
                  <ol className="flex flex-col rounded-ph-xl bg-ph-card">
                    {product.batches.map((batch) => (
                      <BatchRow
                        key={batch.batchId}
                        batch={batch}
                        t={t}
                        locale={locale}
                        today={today}
                        nameOf={nameOf}
                        showCost={showCost}
                        canAdjust={adjustBranchId !== null && batch.buckets.some((b) => b.branchId === adjustBranchId)}
                      />
                    ))}
                  </ol>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function BatchRow({
  batch,
  t,
  locale,
  today,
  nameOf,
  showCost,
  canAdjust,
}: {
  batch: BatchView;
  t: Translate;
  locale: Locale;
  today: string;
  nameOf: (branchId: string) => string;
  showCost: boolean;
  canAdjust: boolean;
}) {
  const chips = batchChips(batch, today);
  const cost = showCost && 'unitCostMinor' in batch ? money(batch, locale) : null;
  return (
    <li data-testid="batch-row" className="flex min-w-0 flex-col gap-1.5 border-t border-ph-line px-3 py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <span className="flex items-baseline gap-1.5">
          <span className="text-ph-muted">{t('pharmacy.stock.batch.lot')}</span>
          <bdi dir="ltr" data-testid="batch-lot" className="font-medium text-ph-text">
            {batch.lot}
          </bdi>
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-ph-muted">{t('pharmacy.stock.batch.expiry')}</span>
          <bdi dir="ltr" data-testid="batch-expiry" className="font-medium text-ph-text tabular-nums">
            {ltr(formatExpiry(batch))}
          </bdi>
        </span>
        {showCost && 'unitCostMinor' in batch && (
          <span className="flex items-baseline gap-1.5" data-cost>
            <span className="text-ph-muted">{t('pharmacy.stock.batch.cost')}</span>
            {cost ? <bdi dir="ltr" className="font-medium text-ph-text tabular-nums">{cost}</bdi> : <span className="text-ph-muted">{t('pharmacy.stock.batch.noCost')}</span>}
          </span>
        )}
        <span className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <StockChip key={chip} kind={chip} t={t} />
          ))}
        </span>
      </div>
      {batch.buckets.map((bucket: BatchBuckets) => (
        <div key={bucket.branchId} className="flex flex-col gap-0.5">
          {batch.buckets.length > 1 && (
            <span dir="auto" className="text-xs font-medium text-ph-muted">
              {t('pharmacy.stock.col.branch')}: {nameOf(bucket.branchId)}
            </span>
          )}
          <Totals totals={bucket} t={t} />
        </div>
      ))}
      {canAdjust && <BatchActions batchId={batch.batchId} lot={batch.lot} />}
    </li>
  );
}
