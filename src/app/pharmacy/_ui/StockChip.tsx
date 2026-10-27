import { Ban, CalendarClock, CalendarX, OctagonAlert, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import { expiryBand, type ExpiryBand } from '@/server/domain/pharmacy/expiry';
import type { BatchView } from '@/server/pharmacy/stock-reads';

export type BatchChip = 'expired' | 'expiringSoon' | 'recalled' | 'blocked' | 'quarantine';

const ICONS: Record<BatchChip, ReactNode> = {
  expired: <CalendarX aria-hidden />,
  expiringSoon: <CalendarClock aria-hidden />,
  recalled: <OctagonAlert aria-hidden />,
  blocked: <Ban aria-hidden />,
  quarantine: <ShieldAlert aria-hidden />,
};

/** Chips that are a warning in words and an icon; the red wash only repeats them. */
const LOUD: ReadonlySet<BatchChip> = new Set(['expired', 'recalled', 'blocked']);

const SOON: ReadonlySet<ExpiryBand> = new Set(['d30', 'd60', 'd90']);

/** The states a batch is in, worst first: expired, recalled or blocked, quarantine held, then expiring within 90 days. */
export function batchChips(batch: BatchView, today: string): BatchChip[] {
  const chips: BatchChip[] = [];
  if (batch.expired) chips.push('expired');
  else if (SOON.has(expiryBand(batch, today))) chips.push('expiringSoon');
  if (batch.status === 'RECALLED') chips.push('recalled');
  if (batch.status === 'BLOCKED') chips.push('blocked');
  if (batch.buckets.some((b) => b.quarantine > 0)) chips.push('quarantine');
  return chips;
}

/** One state of a batch: icon and word together, never a colour alone. */
export function StockChip({ kind, t }: { kind: BatchChip; t: Translate }) {
  return (
    <span
      data-chip={kind}
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0 ${
        LOUD.has(kind) ? 'border-transparent bg-danger-wash text-danger' : 'border-line-strong bg-surface text-text'
      }`}
    >
      {ICONS[kind]}
      {t(`pharmacy.stock.status.${kind}`)}
    </span>
  );
}
