'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { openPosOrder } from '@/app/studio/_actions/pos';
import { formatNumber, type ElapsedText } from '@/lib/pos-format';
import { SELECTING, type LayoutId } from '@/lib/pos-floor';
import type { BoardView } from '@/server/pos/board';
import type { OffPremiseCard } from '@/server/pos/off-premise';
import { useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Floor, type FloorTable } from './floor/Floor';
import { useLiveRefresh, useNow } from './live';
import { useMoney } from './money';
import { usePosCall } from './use-pos-call';

const REFRESH_MS = 10_000;

const LEGEND = [
  { status: 'FREE', key: 'pos.board.state.free' },
  { status: 'PENDING_APPROVAL', key: 'pos.calm.legendNew' },
  { status: 'BUSY', key: 'pos.calm.legendBusy' },
  { status: 'READY', key: 'pos.calm.ready' },
  { status: 'BILL_REQUESTED', key: 'pos.calm.legendBill' },
] as const;

type Props = {
  board: BoardView;
  /** This device's arrangement of the floor (the pos-layout cookie). */
  layout: LayoutId;
  /** Live takeaway and delivery orders, for the areas-as-rows layout. */
  offCards: OffPremiseCard[];
  offPremise: { takeaway: boolean; delivery: boolean };
};

/** The tables screen: today's figures, the area tabs and the floor in this device's layout, fitted to one screen. */
export function TablesBoard({ board, layout, offCards, offPremise }: Props) {
  const t = useT();
  const money = useMoney();
  const router = useRouter();
  const { call, pending } = usePosCall();
  const [areaId, setAreaId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const now = useNow(new Date(board.readAt).getTime());
  useLiveRefresh(REFRESH_MS);

  // The busy table whose bill shows, in the layouts with a bill area. Escape lets it go.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const elapsed: ElapsedText = useMemo(
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

  const showTabs = board.areas.length > 1 && layout !== 'zones';
  const tables = !showTabs || areaId === null ? board.tables : board.tables.filter((table) => table.areaId === areaId);

  const navigate = (table: FloorTable, href: string) => {
    setOpeningId(table.id);
    router.push(href);
  };

  const go = (table: FloorTable, pay = false) => {
    if (table.orderId) navigate(table, `/pos/orders/${table.orderId}${pay ? '?pay=1' : ''}`);
  };

  const press = (table: FloorTable) => {
    if (table.pendingRequests > 0) {
      navigate(table, '/pos/requests');
      return;
    }
    if (table.orderId) {
      // In a layout with a bill area the first press on a busy table shows its bill; the second opens it.
      if (SELECTING.has(layout) && selectedId !== table.id) {
        setSelectedId(table.id);
        return;
      }
      go(table);
      return;
    }
    setOpeningId(table.id);
    void call(() => openPosOrder({ tableId: table.id }), { onOk: (data) => router.push(`/pos/orders/${data.orderId}`), keepPage: true }).then((result) => {
      if (!result.ok) setOpeningId(null);
    });
  };

  if (board.areas.length === 0 || board.tables.length === 0) {
    return <EmptyState title={t('pos.board.noTables')} body={t('pos.board.noTablesHint')} />;
  }

  return (
    <div data-layout={layout} className="till-floor flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 sm:px-8">
      {/* One bar across the top: the title, the area tabs and today's two figures. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="shrink-0 text-3xl font-bold leading-tight sm:text-4xl">{t('pos.board.title')}</h1>
        {showTabs ? (
          <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
            <div role="tablist" aria-label={t('pos.board.areas')} className="till-tabs inline-flex min-w-max gap-1 rounded-2xl p-1.5">
              {[{ id: null, name: t('pos.board.allAreas'), busyCount: board.busyCount }, ...board.areas].map((area) => (
                <button
                  key={area.id ?? 'all'}
                  type="button"
                  role="tab"
                  aria-selected={areaId === area.id}
                  onClick={() => setAreaId(area.id)}
                  className="till-tab inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-base font-semibold whitespace-nowrap"
                >
                  <span className="max-w-[14ch] truncate">{area.name}</span>
                  <span className={cx('min-w-7 rounded-full px-2 text-center text-sm font-bold leading-6', area.busyCount > 0 ? 'bg-raised text-text' : 'bg-bg text-muted')}>{formatNumber(area.busyCount)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <span className="flex-1" />
        )}
        <dl className="flex shrink-0 gap-2">
          <div className="till-stat rounded-2xl px-4 py-1.5">
            <dt className="text-xs font-semibold text-muted">{t('pos.board.busy')}</dt>
            <dd className="flex items-baseline gap-1.5">
              <span className="text-2xl leading-tight font-bold">{formatNumber(board.busyCount)}</span>
              <span className="text-sm text-muted">{t('pos.calm.busyOf', { total: formatNumber(board.tables.length) })}</span>
            </dd>
          </div>
          <div className="till-stat rounded-2xl px-4 py-1.5">
            <dt className="text-xs font-semibold text-muted">{t('pos.board.todaySales')}</dt>
            <dd className="text-2xl leading-tight font-bold">{money(board.todaySales)}</dd>
          </div>
        </dl>
      </div>

      {pending ? (
        <span className="sr-only" role="status">
          {t('common.loading')}
        </span>
      ) : null}
      <Floor
        layout={layout}
        now={now}
        ringMinutes={board.ringMinutes}
        elapsed={elapsed}
        busy={pending || openingId !== null}
        openingId={openingId}
        selectedId={selectedId}
        tables={tables}
        allTables={board.tables}
        areas={board.areas}
        offCards={layout === 'zones' ? offCards : []}
        offPremise={offPremise}
        onPress={press}
        onGo={go}
        onClear={() => setSelectedId(null)}
      />
      <div className="flex shrink-0 flex-col">
        <h2 className="sr-only">{t('pos.calm.legend')}</h2>
        <ul className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm text-muted">
          {LEGEND.filter((item) => item.status !== 'PENDING_APPROVAL' || board.tables.some((x) => x.status === 'PENDING_APPROVAL')).map((item) => (
            <li key={item.status} className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="state-dot" data-status={item.status} />
              {t(item.key)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
