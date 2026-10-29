import { History, Truck } from 'lucide-react';
import Link from 'next/link';
import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import { formatNumber, ltr } from '@/lib/pos-format';
import { formatPhMoney } from '@/server/domain/pharmacy/money';
import { formatExpiry } from '@/server/domain/pharmacy/expiry';
import type { BatchBuckets, BatchView, BucketTotals, ProductBalance } from '@/server/pharmacy/stock-reads';
import { BatchActions } from './BatchActions';
import { batchChips, StockChip } from './StockChip';

const BUCKET_KEYS = ['available', 'sellable', 'reserved', 'quarantine', 'damaged'] as const;

/** The five numbers of one place, label and value side by side so they wrap on a phone and never scroll. */
function Totals({ totals, t, minQty }: { totals: BucketTotals; t: Translate; minQty?: number }) {
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {BUCKET_KEYS.map((key) => (
        <div key={key} className="flex items-baseline gap-1.5">
          <dt className="text-muted">{t(`pharmacy.stock.col.${key}`)}</dt>
          <dd className="font-medium text-text tabular-nums" dir="ltr">
            {formatNumber(totals[key])}
          </dd>
        </div>
      ))}
      {minQty !== undefined && minQty > 0 && (
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted">{t('pharmacy.stock.col.min')}</dt>
          <dd className="font-medium text-text tabular-nums" dir="ltr">
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

/**
 * One row per product with the totals of each branch shown, and its batches in the order the server gave: first to expire
 * first. Batches open with the browser's own disclosure (no animation). Each batch states its condition as an icon and a
 * word; lots, dates and numbers read left to right inside right-to-left text.
 */
export function StockList({ items, t, locale, today, branchNames, showCost, adjustBranchId, inTransit }: StockListProps) {
  const nameOf = (branchId: string) => branchNames[branchId] ?? branchId.slice(0, 8);
  return (
    <ul aria-label={t('pharmacy.stock.title')} className="flex flex-col border-t border-line">
      {items.map((product) => {
        const detail = [product.strength, product.form].filter((part) => part.trim() !== '').join(' · ');
        const low = product.branches.some((b) => b.minQty > 0 && b.sellable < b.minQty);
        const many = product.branches.length > 1;
        return (
          <li key={product.productId} data-testid="stock-row" className="flex min-w-0 flex-col gap-2 border-b border-line py-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <div className="flex min-w-0 flex-col">
                <Link href={`/pharmacy/catalog/${product.productId}`} className="inline-flex min-h-11 min-w-0 items-center rounded-sm text-base font-medium text-text underline-offset-2 hover:underline">
                  <span dir="auto" className="break-words [overflow-wrap:anywhere]">
                    {product.tradeName}
                  </span>
                </Link>
                {detail && (
                  <span dir="auto" className="break-words text-sm text-muted">
                    {detail}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {low && (
                  <span data-chip="low" className="inline-flex min-h-6 items-center rounded-sm border border-transparent bg-danger-wash px-1.5 py-0.5 text-xs font-medium text-danger">
                    {t('pharmacy.stock.lowBadge')}
                  </span>
                )}
                <Link
                  href={`/pharmacy/stock/movements?product=${encodeURIComponent(product.productId)}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover"
                >
                  <History aria-hidden className="size-4 shrink-0" />
                  {t('pharmacy.stock.history')}
                </Link>
              </div>
            </div>

            {product.branches.map((branch) => (
              <div key={branch.branchId} className="flex flex-col gap-0.5">
                {many && (
                  <span dir="auto" className="text-xs font-medium text-muted">
                    {t('pharmacy.stock.col.branch')}: {nameOf(branch.branchId)}
                  </span>
                )}
                <Totals totals={branch} minQty={branch.minQty} t={t} />
              </div>
            ))}

            {(inTransit?.[product.productId] ?? []).map((road) => (
              <p key={road.toBranchId} data-testid="stock-in-transit" className="flex items-start gap-2 text-sm text-text">
                <Truck aria-hidden className="mt-px size-4 shrink-0 text-muted" />
                <span className="min-w-0">{t('pharmacy.transfers.stockInTransit', { branch: nameOf(road.toBranchId), qty: formatNumber(road.qty) })}</span>
              </p>
            ))}

            <details data-testid="stock-batches" className="min-w-0">
              <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
                {t('pharmacy.stock.batches', { count: product.batches.length })}
              </summary>
              {product.batches.length === 0 ? (
                <p className="px-2 py-2 text-sm text-muted">{t('pharmacy.stock.noBatches')}</p>
              ) : (
                <ol className="mt-1 flex flex-col">
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
    <li data-testid="batch-row" className="flex min-w-0 flex-col gap-1.5 border-t border-line px-2 py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <span className="flex items-baseline gap-1.5">
          <span className="text-muted">{t('pharmacy.stock.batch.lot')}</span>
          <bdi dir="ltr" data-testid="batch-lot" className="font-medium text-text">
            {batch.lot}
          </bdi>
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-muted">{t('pharmacy.stock.batch.expiry')}</span>
          <bdi dir="ltr" data-testid="batch-expiry" className="font-medium text-text tabular-nums">
            {ltr(formatExpiry(batch))}
          </bdi>
        </span>
        {showCost && 'unitCostMinor' in batch && (
          <span className="flex items-baseline gap-1.5" data-cost>
            <span className="text-muted">{t('pharmacy.stock.batch.cost')}</span>
            {cost ? <bdi dir="ltr" className="font-medium text-text tabular-nums">{cost}</bdi> : <span className="text-muted">{t('pharmacy.stock.batch.noCost')}</span>}
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
            <span dir="auto" className="text-xs font-medium text-muted">
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
