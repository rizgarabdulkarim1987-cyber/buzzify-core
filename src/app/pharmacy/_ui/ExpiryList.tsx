import { CalendarClock, CalendarDays, CalendarX, CircleCheck, CircleDashed, Hourglass, PackageCheck, PackageMinus, Trash2, Truck, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import { formatNumber, ltr } from '@/lib/pos-format';
import { formatExpiry, urgencyDays } from '@/server/domain/pharmacy/expiry';
import type { ExpiryRow, ExpiryStatus } from '@/server/pharmacy/expiry';
import { ExpiryFollowUp } from './ExpiryFollowUp';
import { groupByUrgency, urgencyGroup, urgencyTone, URGENCY_GROUPS, type UrgencyTone } from './expiry-groups';
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

const CHIP = 'inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0';

/** How near the expiry is: icon and words, never a colour alone. The red wash only repeats an expired batch. */
export function BandChip({ band, t }: { band: Band; t: Translate }) {
  return (
    <span data-band={band} className={`${CHIP} ${band === 'expired' ? 'border-transparent bg-ph-red-wash text-ph-red' : 'border-ph-line bg-ph-card text-ph-text'}`}>
      {BAND_ICONS[band]}
      {t(`pharmacy.expiry.band.${band}`)}
    </span>
  );
}

function FollowChip({ status, t }: { status: ExpiryStatus; t: Translate }) {
  return (
    <span data-follow={status} className={`${CHIP} ${status === 'DISPOSED' || status === 'RETURNED' ? 'border-transparent bg-ph-g1 text-ph-g6' : 'border-ph-line bg-ph-card text-ph-text'}`}>
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
  /** The list's name for a screen reader (a group's heading); the screen's title when absent. */
  label?: string;
}

/**
 * The batches that expire soon, soonest first. Each row: product, lot and expiry (left to right), the time left in words,
 * the band and the batch's own states as chips (icon and word), what is in stock, and the follow-up status with who has
 * it. A role that may adjust stock gets the follow-up form under the row. No motion.
 */
export function ExpiryList({ items, t, userId, canFollow, branchNames, label }: ExpiryListProps) {
  return (
    <ul aria-label={label ?? t('pharmacy.expiry.title')} className="flex flex-col divide-y divide-ph-line">
      {items.map((row) => {
        const left = row.buckets.available + row.buckets.quarantine;
        const meta = [row.product.strength, row.product.form].filter((p) => p.trim() !== '').join(' · ');
        return (
          <li key={`${row.batch.batchId}:${row.branchId}`} data-testid="expiry-row" data-band={row.band} className="flex min-w-0 flex-col gap-2 px-4 py-3">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span dir="auto" className="min-w-0 break-words text-base font-semibold text-ph-text">
                {row.product.tradeName}
              </span>
              {meta && (
                <span dir="auto" className="min-w-0 break-words text-sm text-ph-muted">
                  {meta}
                </span>
              )}
              {branchNames && (
                <span dir="auto" className="text-xs font-medium text-ph-muted">
                  {t('pharmacy.expiry.col.branch')}: {branchNames[row.branchId] ?? ''}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <span className="flex items-baseline gap-1.5">
                <span className="text-ph-muted">{t('pharmacy.expiry.col.lot')}</span>
                <bdi dir="ltr" data-testid="expiry-lot" className="font-medium text-ph-text">
                  {row.batch.lot}
                </bdi>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-ph-muted">{t('pharmacy.expiry.col.expiry')}</span>
                <bdi dir="ltr" data-testid="expiry-date" className="font-medium tabular-nums text-ph-text">
                  {ltr(formatExpiry({ expiryDate: row.batch.expiryDate, expiryPrecision: row.batch.expiryPrecision }))}
                </bdi>
              </span>
              <span data-testid="expiry-left" className="font-medium text-ph-text">
                {leftText(t, row.daysToExpiry)}
              </span>
              <span className="flex flex-wrap gap-1.5">
                <BandChip band={row.band} t={t} />
                {row.batch.status === 'RECALLED' && <StockChip kind="recalled" t={t} />}
                {row.batch.status === 'BLOCKED' && <StockChip kind="blocked" t={t} />}
                {row.buckets.quarantine > 0 && <StockChip kind="quarantine" t={t} />}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ph-text">
              <span className="text-ph-muted">{t('pharmacy.expiry.col.stock')}</span>
              {(['available', 'reserved', 'quarantine'] as const).map((bucket) => (
                <span key={bucket} className="flex items-baseline gap-1.5">
                  <span className="text-ph-muted">{t(`pharmacy.stock.bucket.${bucket}`)}</span>
                  <bdi dir="ltr" className="font-medium tabular-nums">
                    {formatNumber(row.buckets[bucket])}
                  </bdi>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <span className="flex items-center gap-1.5">
                <span className="text-ph-muted">{t('pharmacy.expiry.follow')}</span>
                <FollowChip status={row.action.status} t={t} />
              </span>
              {row.action.assigneeId && (
                <span className="flex items-center gap-1.5 text-ph-text">
                  <UserRound aria-hidden className="size-4 shrink-0 text-ph-muted" />
                  <span className="text-ph-muted">{t('pharmacy.expiry.assignee')}</span>
                  <span>{t(row.action.assigneeId === userId ? 'pharmacy.expiry.assignee.you' : 'pharmacy.expiry.assignee.someone')}</span>
                </span>
              )}
              {row.action.note && (
                <span dir="auto" className="min-w-0 break-words text-ph-muted">
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
        <li key={band} data-total={band} className="flex min-h-11 items-center gap-2 rounded-ph-xl border border-ph-line bg-ph-card px-3 py-1.5 text-sm text-ph-text [&_svg]:size-4 [&_svg]:shrink-0">
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

const DOT: Record<UrgencyTone | 'later', string> = { red: 'bg-ph-red', amber: 'bg-ph-amber-ink', blue: 'bg-ph-blue', later: 'bg-ph-muted' };
const GROUP_DAYS = { expired: -1, d30: 0, d60: 31, d90: 61 } as const;

/** "One batch expires within 90 days, one already expired": the horizon's totals, over every page. */
export function ExpirySummary({ totals, days, t }: { totals: Record<Band, number>; days: number; t: Translate }) {
  const within = (['d30', 'd60', 'd90', 'd180'] as const).filter((band) => Number(band.slice(1)) <= days).reduce((sum, band) => sum + totals[band], 0);
  return (
    <p data-testid="expiry-summary" className="text-sm font-medium text-ph-text">
      {t('pharmacy.expiry.summary', { count: within, n: formatNumber(within), days: formatNumber(days) })}
      {totals.expired > 0 && (
        <>
          {t('pharmacy.expiry.summary.sep')}
          {t('pharmacy.expiry.summary.expired', { count: totals.expired, n: formatNumber(totals.expired) })}
        </>
      )}
    </p>
  );
}

export interface ExpiryGroupsProps extends Omit<ExpiryListProps, 'label'> {
  today: string;
}

/**
 * The rows of a page in their urgency groups (expired, 30, 60, 90 days; a group with no batch is not drawn), each under a
 * heading with its coloured dot and in its own card. A MONTH batch is grouped from the start of its month, as its band and
 * Home's colour. What lies beyond 90 days (the 180-day horizon) follows in a last group of its own.
 */
export function ExpiryGroups({ items, today, ...list }: ExpiryGroupsProps) {
  const rows = items.map((row) => ({ row, daysLeft: urgencyDays({ expiryDate: row.batch.expiryDate, expiryPrecision: row.batch.expiryPrecision }, today) }));
  const groups = groupByUrgency(rows);
  const later = rows.filter((r) => urgencyGroup(r.daysLeft) === null).sort((a, b) => a.daysLeft - b.daysLeft);
  const sections = [
    ...URGENCY_GROUPS.map((group) => ({ group, rows: groups[group], dot: DOT[urgencyTone(GROUP_DAYS[group])], title: list.t(`pharmacy.expiry.band.${group}`) })),
    { group: 'd180' as const, rows: later, dot: DOT.later, title: list.t('pharmacy.expiry.band.d180') },
  ].filter((section) => section.rows.length > 0);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {sections.map((section) => (
        <section key={section.group} data-testid="expiry-group" data-group={section.group} aria-labelledby={`expiry-group-${section.group}`} className="flex min-w-0 flex-col gap-2">
          <h2 id={`expiry-group-${section.group}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-bold text-ph-text">
            <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${section.dot}`} />
            <span>{section.title}</span>
            <span className="text-sm font-medium text-ph-muted tabular-nums">{list.t('pharmacy.expiry.group.count', { n: formatNumber(section.rows.length) })}</span>
          </h2>
          <div className="min-w-0 rounded-ph-2xl bg-ph-card">
            <ExpiryList {...list} items={section.rows.map((r) => r.row)} label={section.title} />
          </div>
        </section>
      ))}
    </div>
  );
}
