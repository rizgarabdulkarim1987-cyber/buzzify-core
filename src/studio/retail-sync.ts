import type { RetailSyncState } from '@/server/retail/sync-state';
import { formatDateTime } from '@/studio/format';
import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import type { StatusTone } from '@/studio/ui/StatusBadge';

/** The sentence and badge tone for a shop's delivery state, in the reader's language. */
export function syncLabel(sync: RetailSyncState, t: Translate, locale: Locale): { text: string; tone: StatusTone } {
  switch (sync.kind) {
    case 'synced':
      return { text: t('retail.sync.synced', { version: sync.version }), tone: 'success' };
    case 'waitingOwner':
      return { text: t('retail.sync.waitingOwner'), tone: 'neutral' };
    case 'waitingSubscription':
      return { text: t('retail.sync.waitingSubscription'), tone: 'neutral' };
    case 'retrying':
      return { text: t('retail.sync.retrying', { attempts: sync.attempts, time: formatDateTime(sync.nextAttemptAt.toISOString(), locale) }), tone: 'neutral' };
    case 'failed':
      return { text: t('retail.sync.failed', { code: sync.code ?? t('retail.sync.noCode') }), tone: 'danger' };
    case 'queued':
      return { text: t('retail.sync.queued'), tone: 'neutral' };
    case 'notProvisioned':
      return { text: t('retail.preparing'), tone: 'neutral' };
  }
}
