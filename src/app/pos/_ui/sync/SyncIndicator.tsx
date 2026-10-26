'use client';

import Link from 'next/link';
import { formatNumber } from '@/lib/pos-format';
import type { IndicatorState } from '@/lib/pos-sync/indicator';
import { useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';
import { useSync } from './SyncProvider';

const TONE: Record<IndicatorState, string> = {
  online: 'text-muted',
  offline: 'border-accent bg-accent-wash text-text',
  syncing: 'border-info bg-info-wash text-text',
  attention: 'border-danger bg-danger-wash text-text',
  signedOut: 'border-danger bg-danger-wash text-text',
};

/**
 * The connection in one place on every till page. Online with nothing waiting it is a small dot, so a restaurant that never
 * goes offline sees no machinery; otherwise it says how many operations wait or need the cashier, and opens the queue.
 */
export function SyncIndicator() {
  const t = useT();
  const sync = useSync();
  const waiting = sync.counts.pending + sync.counts.blocked;
  const label =
    sync.state === 'attention'
      ? t('pos.sync.attention', { n: formatNumber(sync.counts.attention) })
      : sync.state === 'signedOut'
        ? t('pos.sync.signedOut')
        : sync.state === 'syncing'
          ? t('pos.sync.syncing', { n: formatNumber(waiting) })
          : sync.state === 'offline'
            ? t('pos.sync.offline', { n: formatNumber(waiting) })
            : t('pos.sync.online');
  const quiet = sync.state === 'online' && waiting === 0;
  return (
    <Link
      href="/pos/offline?view=queue"
      data-testid="sync-indicator"
      data-state={sync.state}
      aria-live="polite"
      className={cx('inline-flex min-h-12 items-center gap-2 rounded-md border px-3 text-sm', quiet ? 'border-transparent' : '', TONE[sync.state])}
    >
      <span aria-hidden className={cx('size-2.5 shrink-0 rounded-full', sync.state === 'online' ? 'bg-success' : sync.state === 'offline' ? 'bg-accent' : sync.state === 'syncing' ? 'bg-info' : 'bg-danger')} />
      <span className={cx(quiet && 'sr-only')}>{label}</span>
    </Link>
  );
}
