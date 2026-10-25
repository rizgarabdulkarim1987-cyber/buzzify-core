'use client';

import { useState } from 'react';
import { formatNumber } from '@/lib/pos-format';
import type { QueuedOp } from '@/lib/pos-sync/queue';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { Dialog } from '@/studio/ui/Dialog';
import { Textarea } from '@/studio/ui/Textarea';
import { useMoney } from '../money';
import { useSync } from './SyncProvider';

/** Every operation not yet applied (and the last few that were), with what the cashier can do about the ones that stopped. */
export function QueuePanel() {
  const t = useT();
  const sync = useSync();
  const money = useMoney();
  const [target, setTarget] = useState<QueuedOp | null>(null);
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState(false);

  const errorText = (q: QueuedOp): string | null => {
    const e = q.lastError;
    if (!e) return null;
    return t(`pos.offline.error.${e.code}`, {
      v: formatNumber(e.currentVersion ?? 0),
      status: e.orderStatus ?? '',
      expected: money(e.detail?.expectedTotal ?? 0),
      total: money(e.detail?.total ?? 0),
    });
  };

  const needsReason = target?.kind === 'payCash';

  return (
    <section className="flex flex-col gap-3" data-testid="queue-panel">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-text">{t('pos.offline.queue')}</h2>
        <Button className="min-h-12" onClick={() => sync.syncNow()} disabled={!sync.online || sync.syncing}>
          {t('pos.offline.syncNow')}
        </Button>
      </div>
      {sync.queue.length === 0 ? <p className="text-muted">{t('pos.offline.queueEmpty')}</p> : null}
      <ul className="flex flex-col gap-2">
        {sync.queue.map((q) => (
          <li key={q.operationId} data-state={q.state} className={cx('flex flex-col gap-2 rounded-lg border p-3', q.state === 'attention' ? 'border-danger bg-danger-wash' : 'border-line')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-text">
                {t(`pos.offline.kind.${q.kind}`)}
                {q.op.kind === 'payCash' ? ` · ${money(q.op.payload.amountReceived)}` : ''}
              </span>
              <span className="text-sm text-muted">{t(`pos.offline.state.${q.state}`)}</span>
            </div>
            {errorText(q) ? <p className="text-sm text-text">{errorText(q)}</p> : null}
            {q.state === 'attention' || q.state === 'blocked' ? (
              <div className="flex flex-wrap gap-2">
                {q.state === 'attention' ? (
                  <Button className="min-h-12" onClick={() => void sync.retry(q.operationId)}>
                    {t('pos.offline.retry')}
                  </Button>
                ) : null}
                {q.state === 'attention' && q.lastError?.code === 'stale' && q.lastError.currentVersion !== null ? (
                  <Button className="min-h-12" onClick={() => void sync.applyToCurrent(q.operationId, q.lastError!.currentVersion!)}>
                    {t('pos.offline.applyCurrent')}
                  </Button>
                ) : null}
                <Button
                  variant="danger"
                  className="min-h-12"
                  disabled={!sync.online}
                  onClick={() => (setReason(''), setFailed(false), setTarget(q))}
                >
                  {t('pos.offline.discard')}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <Dialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={t('pos.offline.discardTitle')}
        description={t('pos.offline.discardBody')}
        footer={
          <>
            <Button className="min-h-12" onClick={() => setTarget(null)}>
              {t('pos.offline.close')}
            </Button>
            <Button
              variant="danger"
              className="min-h-12"
              disabled={!sync.online || (needsReason && reason.trim() === '')}
              onClick={async () => {
                if (!target) return;
                const result = await sync.discard(target.operationId, reason.trim());
                if (result.ok) setTarget(null);
                else setFailed(true);
              }}
            >
              {t('pos.offline.discard')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {!sync.online ? <p className="text-sm text-text">{t('pos.offline.discardOnline')}</p> : null}
          {failed ? <p role="alert" className="text-sm text-text">{t('pos.offline.discardFailed')}</p> : null}
          <label className="flex flex-col gap-1 text-sm text-text">
            {t('pos.offline.reason')}
            <Textarea dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </label>
        </div>
      </Dialog>
    </section>
  );
}
