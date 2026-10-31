import { CalendarClock, CalendarDays, CalendarX, CircleCheck, CircleDashed, Hourglass, PackageCheck, PackageMinus, Trash2, Truck, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import { formatNumber, ltr } from '@/lib/pos-format';
import { formatExpiry } from '@/server/domain/pharmacy/expiry';
import type { ExpiryRow, ExpiryStatus } from '@/server/pharmacy/expiry';
import { ExpiryFollowUp } from './ExpiryFollowUp';
import { StockChip } from './StockChip';

type Band = ExpiryRow['band'];

const BAND_ICONS: Record<Band, ReactNode> = {
  expired: <CalendarX aria-hidden />,
  d30: <CalendarClock aria-hidden />,
  d60: <CalendarClock aria-hidden />,
  d90: <CalendarDays aria-hidden />,
  d180: <CalendarDays aria-hidden />,
};

const STATUS_ICONS: Record<ExpiryStatus, ReactNode> = {
  NEW: <CircleDashed aria-hidden />,
  IN_PROGRESS: <Hourglass aria-hidden />,
  MOVED: <Truck aria-hidden />,
  DISPOSED: <Trash2 aria-hidden />,
  RETURNED: <PackageMinus aria-hidden />,
};

const CHIP = 'inline-flex min-h-6 items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0';

/** How near the expiry is: icon and words, never a colour alone. The red wash only repeats an expired batch. */
export function BandChip({ band, t }: { band: Band; t: Translate }) {
  return (
    <span data-band={band} className={`${CHIP} ${band === 'expired' ? 'border-transparent bg-danger-wash text-danger' : 'border-line-strong bg-surface text-text'}`}>
      {BAND_ICONS[band]}
      {t(`pharmacy.expiry.band.${band}`)}
    </span>
  );
}

function FollowChip({ status, t }: { status: ExpiryStatus; t: Translate }) {
  return (
    <span data-follow={status} className={`${CHIP} ${status === 'DISPOSED' || status === 'RETURNED' ? 'border-transparent bg-success-wash text-success' : 'border-line-strong bg-surface text-text'}`}>
      {STATUS_ICONS[status]}
      {t(`pharmacy.expiry.status.${status}`)}
    </span>
  );
}

/** The time left in words: "Expires today", "12 days left" or "Expired 5 days ago". */
export function leftText(t: Translate, days: number): string {
  if (days === 0) return t('pharmacy.expiry.left.today');
  return days > 0 ? t('pharmacy.expiry.left', { count: days }) : t('pharmacy.expiry.ago', { count: -days });
}

export interface ExpiryListProps {
  items: ExpiryRow[];
  t: Translate;
  userId: string;
  /** Show the follow-up form (a role with stock.adjust, an open pharmacy, one chosen branch). */
  canFollow: boolean;
  /** Branch names, shown on each row when the person looks at all branches. */
  branchNames: Record<string, string> | null;
}

/**
 * The batches that expire soon, soonest first. Each row: product, lot and expiry (left to right), the time left in words,
 * the band and the batch's own states as chips (icon and word), what is in stock, and the follow-up status with who has
 * it. A role that may adjust stock gets the follow-up form under the row. No motion.
 */
export function ExpiryList({ items, t, userId, canFollow, branchNames }: ExpiryListProps) {
  return (
    <ul aria-label={t('pharmacy.expiry.title')} className="flex flex-col border-t border-line">
      {items.map((row) => {
        const left = row.buckets.available + row.buckets.quarantine;
        const meta = [row.product.strength, row.product.form].filter((p) => p.trim() !== '').join(' · ');
        return (
          <li key={`${row.batch.batchId}:${row.branchId}`} data-testid="expiry-row" data-band={row.band} className="flex min-w-0 flex-col gap-2 border-b border-line px-1 py-3">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span dir="auto" className="min-w-0 break-words text-base font-semibold text-text">
                {row.product.tradeName}
              </span>
              {meta && (
                <span dir="auto" className="min-w-0 break-words text-sm text-muted">
                  {meta}
                </span>
              )}
              {branchNames && (
                <span dir="auto" className="text-xs font-medium text-muted">
                  {t('pharmacy.expiry.col.branch')}: {branchNames[row.branchId] ?? ''}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <span className="flex items-baseline gap-1.5">
                <span className="text-muted">{t('pharmacy.expiry.col.lot')}</span>
                <bdi dir="ltr" data-testid="expiry-lot" className="font-medium text-text">
                  {row.batch.lot}
                </bdi>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-muted">{t('pharmacy.expiry.col.expiry')}</span>
                <bdi dir="ltr" data-testid="expiry-date" className="font-medium tabular-nums text-text">
                  {ltr(formatExpiry({ expiryDate: row.batch.expiryDate, expiryPrecision: row.batch.expiryPrecision }))}
                </bdi>
              </span>
              <span data-testid="expiry-left" className="font-medium text-text">
                {leftText(t, row.daysToExpiry)}
              </span>
              <span className="flex flex-wrap gap-1.5">
                <BandChip band={row.band} t={t} />
                {row.batch.status === 'RECALLED' && <StockChip kind="recalled" t={t} />}
                {row.batch.status === 'BLOCKED' && <StockChip kind="blocked" t={t} />}
                {row.buckets.quarantine > 0 && <StockChip kind="quarantine" t={t} />}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-text">
              <span className="text-muted">{t('pharmacy.expiry.col.stock')}</span>
              {(['available', 'reserved', 'quarantine'] as const).map((bucket) => (
                <span key={bucket} className="flex items-baseline gap-1.5">
                  <span className="text-muted">{t(`pharmacy.stock.bucket.${bucket}`)}</span>
                  <bdi dir="ltr" className="font-medium tabular-nums">
                    {formatNumber(row.buckets[bucket])}
                  </bdi>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <span className="flex items-center gap-1.5">
                <span className="text-muted">{t('pharmacy.expiry.follow')}</span>
                <FollowChip status={row.action.status} t={t} />
              </span>
              {row.action.assigneeId && (
                <span className="flex items-center gap-1.5 text-text">
                  <UserRound aria-hidden className="size-4 shrink-0 text-muted" />
                  <span className="text-muted">{t('pharmacy.expiry.assignee')}</span>
                  <span>{t(row.action.assigneeId === userId ? 'pharmacy.expiry.assignee.you' : 'pharmacy.expiry.assignee.someone')}</span>
                </span>
              )}
              {row.action.note && (
                <span dir="auto" className="min-w-0 break-words text-muted">
                  {row.action.note}
                </span>
              )}
            </div>
            {canFollow && <ExpiryFollowUp batchId={row.batch.batchId} lot={row.batch.lot} userId={userId} current={row.action} left={left} />}
          </li>
        );
      })}
    </ul>
  );
}

/** The totals of the horizon: one chip per band, each a count with its words (icon and number, never colour alone). */
export function ExpiryTotalsRow({ totals, days, t }: { totals: Record<Band, number>; days: number; t: Translate }) {
  const bands = (['expired', 'd30', 'd60', 'd90', 'd180'] as const).filter((band) => band === 'expired' || Number(band.slice(1)) <= days);
  return (
    <ul aria-label={t('pharmacy.expiry.totals')} data-testid="expiry-totals" className="flex flex-wrap gap-2">
      {bands.map((band) => (
        <li key={band} data-total={band} className="flex min-h-11 items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-text [&_svg]:size-4 [&_svg]:shrink-0">
          {band === 'expired' ? <CalendarX aria-hidden /> : totals[band] === 0 ? <CircleCheck aria-hidden /> : <PackageCheck aria-hidden />}
          <span>{t(`pharmacy.expiry.band.${band}`)}</span>
          <bdi dir="ltr" className="font-semibold tabular-nums">
            {formatNumber(totals[band])}
          </bdi>
        </li>
      ))}
    </ul>
  );
}
