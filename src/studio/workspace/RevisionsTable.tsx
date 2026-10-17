'use client';

import { CalendarClock, Eye, History, RotateCcw, Undo2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { cancelScheduledPublish, restoreRevision, rollbackRevision } from '@/app/studio/_actions/revisions';
import type { Locale } from '@/lib/locale';
import { formatInZone } from '@/server/domain/schedule-time';
import { numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { useRefuse } from '@/studio/refuse';

import { Button, buttonClasses } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { StatusBadge, type StatusTone } from '@/studio/ui/StatusBadge';

export interface RevisionRow {
  id: string;
  number: number;
  state: 'live' | 'past' | 'scheduled' | 'cancelled';
  createdAt: string;
  createdBy: string | null;
  note: string;
  goLiveAt: string | null;
  wentLiveAt: string | null;
  cancelledAt: string | null;
}

export interface RevisionsTableProps {
  menuId: string;
  defaultLocale: Locale;
  rows: RevisionRow[];
  pending: { number: number; goLiveAt: string } | null;
  timezone: string;
  draftHash: string | null;
  canRollback: boolean;
  canSchedule: boolean;
}

const TONES: Record<RevisionRow['state'], StatusTone> = { live: 'success', past: 'neutral', scheduled: 'ink', cancelled: 'neutral' };

type Confirm = { kind: 'rollback' | 'restore'; row: RevisionRow } | { kind: 'cancel'; revisionId: string; number: number };

/**
 * The Revisions tab (spec 10.6): what is waiting to go live, then every revision newest first with who made it and
 * when, on the menu's clock. A past revision can go live again at once (Roll back) or come back as the draft to work
 * from (Restore to draft, which replaces unpublished changes); each is confirmed first.
 */
export function RevisionsTable({ menuId, defaultLocale, rows, pending, timezone, draftHash, canRollback, canSchedule }: RevisionsTableProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const refuse = useRefuse();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const number = numberFormat(locale);
  const at = (iso: string) => formatInZone(new Date(iso), timezone, locale);
  const pendingRow = pending ? rows.find((row) => row.number === pending.number) : undefined;

  const when = (row: RevisionRow) => {
    if (row.state === 'scheduled' && row.goLiveAt) return t('revisions.when.scheduled', { time: at(row.goLiveAt) });
    if (row.state === 'cancelled' && row.cancelledAt) return t('revisions.when.cancelled', { time: at(row.cancelledAt) });
    if (row.wentLiveAt) return t('revisions.when.live', { time: at(row.wentLiveAt) });
    return t('revisions.when.created', { time: at(row.createdAt) });
  };

  return (
    <div className="flex max-w-5xl flex-col gap-6 px-8 pb-10 pt-6">
      {pending && (
        <section aria-labelledby="pending-title" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-accent-wash px-4 py-3">
          <div className="flex items-start gap-3">
            <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0 text-text" />
            <div className="flex flex-col gap-0.5">
              <h2 id="pending-title" className="text-base font-semibold text-text">
                {t('revisions.pendingTitle')}
              </h2>
              <p className="text-sm text-text">
                {t('revisions.pendingBody', { number: number.format(pending.number), time: at(pending.goLiveAt) })}{' '}
                <span className="text-muted">({timezone})</span>
              </p>
            </div>
          </div>
          {canSchedule && pendingRow && (
            <Button size="sm" icon={<X aria-hidden />} onClick={() => setConfirm({ kind: 'cancel', revisionId: pendingRow.id, number: pending.number })}>
              {t('revisions.cancelSchedule')}
            </Button>
          )}
        </section>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={<History aria-hidden />} title={t('revisions.emptyTitle')} body={t('revisions.emptyBody')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-raised">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t('revisions.caption')}</caption>
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th scope="col" className="h-9 w-16 px-3 ps-4 text-start font-medium">
                  {t('revisions.number')}
                </th>
                <th scope="col" className="h-9 px-3 text-start font-medium">
                  {t('revisions.state')}
                </th>
                <th scope="col" className="h-9 px-3 text-start font-medium">
                  {t('revisions.whenColumn')}
                </th>
                <th scope="col" className="h-9 px-3 text-start font-medium">
                  {t('revisions.by')}
                </th>
                <th scope="col" className="h-9 px-3 text-start font-medium">
                  {t('revisions.note')}
                </th>
                <th scope="col" className="h-9 px-3 pe-4 text-end font-medium">
                  <span className="sr-only">{t('revisions.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={cx('border-b border-line last:border-b-0', row.state === 'live' && 'bg-success-wash/40')}>
                  <td className="h-11 px-3 ps-4 font-medium tabular-nums text-text">{number.format(row.number)}</td>
                  <td className="px-3">
                    <StatusBadge tone={TONES[row.state]}>{t(`revisions.stateName.${row.state}`)}</StatusBadge>
                  </td>
                  <td className="px-3 text-text">{when(row)}</td>
                  <td className="px-3 text-muted">{row.createdBy ?? t('revisions.system')}</td>
                  <td className="max-w-56 truncate px-3 text-muted" title={row.note || undefined}>
                    {row.note}
                  </td>
                  <td className="px-3 pe-4">
                    <div className="flex justify-end gap-1">
                      <a
                        href={`/studio/preview/${menuId}/${defaultLocale}?revision=${row.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonClasses('ghost', 'sm')}
                        aria-label={t('revisions.previewLabel', { number: row.number })}
                      >
                        <Eye aria-hidden />
                        {t('revisions.preview')}
                      </a>
                      {canRollback && row.state === 'past' && (
                        <Button size="sm" variant="ghost" icon={<Undo2 aria-hidden />} onClick={() => setConfirm({ kind: 'rollback', row })}>
                          {t('revisions.rollback')}
                        </Button>
                      )}
                      {canRollback && row.state !== 'cancelled' && (
                        <Button size="sm" variant="ghost" icon={<RotateCcw aria-hidden />} onClick={() => setConfirm({ kind: 'restore', row })}>
                          {t('revisions.restore')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirm?.kind === 'rollback'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('revisions.rollbackTitle', { number: confirm?.kind === 'rollback' ? confirm.row.number : 0 })}
        body={t('revisions.rollbackBody')}
        confirmLabel={t('revisions.rollbackConfirm')}
        tone="primary"
        onConfirm={async () => {
          if (confirm?.kind !== 'rollback') return true;
          const result = await rollbackRevision({ menuId, revisionId: confirm.row.id });
          if (!result.ok) return refuse(result);
          toast.success(t('revisions.rolledBack', { number: result.data.number }));
          router.refresh();
          return true;
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === 'restore'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('revisions.restoreTitle', { number: confirm?.kind === 'restore' ? confirm.row.number : 0 })}
        body={t('revisions.restoreBody')}
        confirmLabel={t('revisions.restoreConfirm')}
        onConfirm={async () => {
          if (confirm?.kind !== 'restore') return true;
          const result = await restoreRevision({ menuId, revisionId: confirm.row.id, expectedDraftHash: draftHash });
          if (!result.ok) return refuse(result);
          toast.success(t('revisions.restored', { number: result.data.number }));
          router.refresh();
          return true;
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === 'cancel'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('revisions.cancelTitle', { number: confirm?.kind === 'cancel' ? confirm.number : 0 })}
        body={t('revisions.cancelBody')}
        confirmLabel={t('revisions.cancelConfirm')}
        onConfirm={async () => {
          if (confirm?.kind !== 'cancel') return true;
          const result = await cancelScheduledPublish({ menuId, revisionId: confirm.revisionId });
          if (!result.ok) return refuse(result);
          toast.success(t('revisions.cancelled'));
          router.refresh();
          return true;
        }}
      />
    </div>
  );
}
