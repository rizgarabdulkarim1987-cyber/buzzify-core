'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { openPosOrder } from '@/app/studio/_actions/pos';
import { elapsedLabel, elapsedMinutes, formatNumber, type ElapsedText } from '@/lib/pos-format';
import { tableTone, type TableTone } from '@/lib/pos-view';
import { ringProgress } from '@/server/domain/pos/table-status';
import type { BoardView } from '@/server/pos/board';
import { useLocale, useT } from '@/studio/i18n';
import { Alert } from '@/studio/ui/Alert';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { useLiveRefresh, useNow } from './live';
import { useMoney } from './money';
import { usePosCall } from './use-pos-call';

const REFRESH_MS = 10_000;
const TONE: Record<TableTone, string> = {
  free: 'border-line-strong bg-raised text-text',
  busy: 'border-accent bg-accent-wash text-text',
  ready: 'border-success bg-success-wash text-text',
  bill: 'border-danger bg-danger-wash text-text',
  pending: 'border-dashed border-line-strong bg-surface text-text',
};
const RING = 2 * Math.PI * 46;

export function TablesBoard({ board }: { board: BoardView }) {
  const t = useT();
  const { locale } = useLocale();
  const money = useMoney();
  const router = useRouter();
  const { call, pending } = usePosCall();
  const [areaId, setAreaId] = useState<string | null>(null);
  const now = useNow(new Date(board.readAt).getTime());
  useLiveRefresh(REFRESH_MS);

  const text: ElapsedText = useMemo(
    () => ({
      justNow: t('pos.time.justNow'),
      one: t('pos.time.one'),
      two: t('pos.time.two'),
      few: t('pos.time.few'),
      many: t('pos.time.many'),
      other: t('pos.time.other'),
      hours: t('pos.time.hours'),
    }),
    [t],
  );
  const tables = areaId === null ? board.tables : board.tables.filter((table) => table.areaId === areaId);
  const areaName = (id: string) => board.areas.find((area) => area.id === id)?.name ?? '';

  const tap = (table: BoardView['tables'][number]) => {
    if (table.orderId) {
      router.push(`/pos/orders/${table.orderId}`);
      return;
    }
    void call(() => openPosOrder({ tableId: table.id }), { onOk: (data) => router.push(`/pos/orders/${data.orderId}`) });
  };

  if (board.areas.length === 0 || board.tables.length === 0) {
    return <EmptyState title={t('pos.board.noTables')} body={t('pos.board.noTablesHint')} />;
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-8 sm:px-8">
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-base">
        <div className="flex gap-2">
          <dt className="text-muted">{t('pos.board.busy')}</dt>
          <dd className="font-semibold text-text">{formatNumber(board.busyCount)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">{t('pos.board.todaySales')}</dt>
          <dd className="font-semibold text-text">{money(board.todaySales)}</dd>
        </div>
      </dl>

      {board.areas.length > 1 ? (
        <div role="tablist" aria-label={t('pos.board.areas')} className="flex gap-1 overflow-x-auto">
          {[{ id: null, name: t('pos.board.allAreas'), busyCount: board.busyCount }, ...board.areas].map((area) => (
            <button
              key={area.id ?? 'all'}
              type="button"
              role="tab"
              aria-selected={areaId === area.id}
              onClick={() => setAreaId(area.id)}
              className={cx(
                'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border px-4 text-base whitespace-nowrap',
                areaId === area.id ? 'border-ink bg-ink text-on-ink' : 'border-line-strong text-text hover:bg-hover',
              )}
            >
              {area.name}
              {area.busyCount > 0 ? <span className="text-sm opacity-75">{formatNumber(area.busyCount)}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {pending ? <span className="sr-only" role="status">{t('common.loading')}</span> : null}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
        {tables.map((table) => {
          const tone = tableTone(table.status);
          const progress = table.seatedAt ? ringProgress(new Date(table.seatedAt), new Date(now), board.ringMinutes) : 0;
          const minutes = table.seatedAt ? elapsedMinutes(new Date(table.seatedAt).getTime(), now) : 0;
          return (
            <li key={table.id}>
              <button
                type="button"
                onClick={() => tap(table)}
                disabled={pending}
                className={cx('relative flex min-h-32 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 p-3 text-center transition-colors disabled:opacity-60', TONE[tone])}
                aria-label={t('pos.board.tableLabel', { n: formatNumber(table.number), state: t(`pos.board.state.${tone}`) })}
              >
                {table.orderId ? (
                  <svg aria-hidden viewBox="0 0 100 100" className="absolute inset-2 -rotate-90">
                    <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="3" />
                    <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={RING * (1 - progress)} />
                  </svg>
                ) : null}
                <span className="relative text-2xl font-semibold" dir="ltr">{formatNumber(table.number)}</span>
                <span className="relative text-sm text-muted">{areaId === null && board.areas.length > 1 ? areaName(table.areaId) : t(`pos.board.state.${tone}`)}</span>
                {table.orderId ? (
                  <span className="relative text-sm font-medium">
                    {money(table.total)} · {elapsedLabel(minutes, text, locale)}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      {tables.length === 0 ? <Alert>{t('pos.board.noTablesInArea')}</Alert> : null}
    </div>
  );
}
