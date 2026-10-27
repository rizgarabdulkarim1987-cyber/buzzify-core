'use client';

import { Delete, X } from 'lucide-react';
import Link from 'next/link';
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { elapsedLabel, elapsedMinutes, formatNumber, type ElapsedText } from '@/lib/pos-format';
import { fitTiles, isLate, needOf, openFirst, queueOf, SELECTING, TILE_GAP_PX, type LayoutId, type Need, type TileFit } from '@/lib/pos-floor';
import type { BoardView } from '@/server/pos/board';
import type { OffPremiseCard } from '@/server/pos/off-premise';
import { useLocale, useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';
import { useMoney } from '../money';

export type FloorTable = BoardView['tables'][number];

/** What every arrangement of the floor gets: the tables to show, the state of the board and the three moves. */
export type FloorProps = {
  layout: LayoutId;
  now: number;
  ringMinutes: number;
  elapsed: ElapsedText;
  /** A table's page is loading: every press waits. */
  busy: boolean;
  /** The table whose page is loading. */
  openingId: string | null;
  /** The busy table whose bill shows (the layouts with a bill area). */
  selectedId: string | null;
  /** The tables of the chosen area tab. */
  tables: FloorTable[];
  /** Every table, for the layouts without area tabs (areas as rows, the keypad, the waiting list). */
  allTables: FloorTable[];
  areas: BoardView['areas'];
  /** Live takeaway and delivery orders, shown as their own row by the areas-as-rows layout. */
  offCards: OffPremiseCard[];
  /** Which of takeaway and delivery are switched on, for the "+ Takeaway" / "+ Delivery" links. */
  offPremise: { takeaway: boolean; delivery: boolean };
  /** The table's next step: a waiting request, a new order, its order, or (in a bill layout) selecting it. */
  onPress: (table: FloorTable) => void;
  /** Straight to the table's order page; `pay` opens it on the payment step. */
  onGo: (table: FloorTable, pay?: boolean) => void;
  onClear: () => void;
};

function minutesOf(p: FloorProps, table: FloorTable) {
  return table.seatedAt !== null ? elapsedMinutes(new Date(table.seatedAt).getTime(), p.now) : null;
}

/** The table's time as "12 min", and whether it passed the owner's ring minutes. */
function useTime(p: FloorProps) {
  const t = useT();
  return (table: FloorTable) => {
    const m = minutesOf(p, table);
    return { text: m === null ? null : t('pos.calm.minutes', { n: formatNumber(m) }), late: isLate(m, p.ringMinutes) };
  };
}

const STATE_KEY = { FREE: 'free', BUSY: 'busy', READY: 'ready', BILL_REQUESTED: 'bill', PENDING_APPROVAL: 'pending' } as const;

/** The short word on a tile that needs the cashier. */
const BADGE_KEY = { PENDING_APPROVAL: 'pos.calm.badgeNew', READY: 'pos.calm.badgeReady', BILL_REQUESTED: 'pos.calm.badgeBill' } as const;

function useTableButton(p: FloorProps) {
  const t = useT();
  const { locale } = useLocale();
  const money = useMoney();
  return (table: FloorTable) => {
    const parts = [t('pos.board.tableLabel', { n: formatNumber(table.number), state: t(`pos.board.state.${STATE_KEY[table.status]}`) })];
    if (table.orderId) parts.push(money(table.total));
    const minutes = minutesOf(p, table);
    if (minutes !== null) parts.push(elapsedLabel(minutes, p.elapsed, locale));
    if (table.pendingRequests > 0 && table.status !== 'PENDING_APPROVAL') parts.push(t('pos.board.newOrder'));
    const selecting = SELECTING.has(p.layout) && table.orderId !== null;
    return {
      type: 'button' as const,
      'data-status': table.status,
      'data-table-number': table.number,
      'aria-label': parts.join('، '),
      'aria-pressed': selecting ? p.selectedId === table.id : undefined,
      'aria-busy': p.openingId === table.id || undefined,
      disabled: p.busy,
      onClick: () => p.onPress(table),
    };
  };
}

/** A square table: the number large, then its state word or its time and amount. Sizes follow the tile (container units). */
function Tile({ p, table, style }: { p: FloorProps; table: FloorTable; style?: CSSProperties }) {
  const t = useT();
  const button = useTableButton(p);
  const time = useTime(p)(table);
  const tag = table.status === 'FREE' || table.status === 'BUSY' ? null : t(BADGE_KEY[table.status]);
  const sub = table.status === 'FREE' ? t('pos.calm.free') : [time.text, table.orderId ? formatNumber(table.total) : null].filter(Boolean).join(' · ');
  const count = table.pendingRequests > (table.status === 'PENDING_APPROVAL' ? 1 : 0) ? table.pendingRequests : 0;
  return (
    <button {...button(table)} style={style} className="s-keep-radius tile relative select-none p-3">
      <span aria-hidden="true" className="tile-no font-bold leading-none" dir="ltr" style={{ fontSize: 'max(22px, 40cqmin)' }}>
        {formatNumber(table.number)}
      </span>
      <span aria-hidden="true" className="flex min-w-0 flex-col gap-[2cqmin] leading-tight" style={{ fontSize: 'max(12px, 12cqmin)' }}>
        {tag ? <span className="tile-tag truncate font-bold">{tag}</span> : null}
        <span dir="auto" data-late={(table.status !== 'FREE' && time.late) || undefined} className="tile-sub truncate font-semibold">
          {sub}
        </span>
      </span>
      {count > 0 ? (
        <span aria-hidden="true" className="absolute end-2 top-2 grid min-w-7 place-items-center rounded-full bg-raised px-1.5 text-sm font-bold leading-7 text-info">
          {formatNumber(count)}
        </span>
      ) : null}
    </button>
  );
}

/** Measures the box (never the grid, so the grid's size cannot feed back) and fits the tiles into it. */
function useFitTiles<T extends HTMLElement>(count: number) {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const fit: TileFit | null = box ? fitTiles(count, box.w, box.h) : null;
  return { ref, fit };
}

/** The tables fitted to their box as the biggest squares that fit; a floor too big for one screen scrolls in its box. */
function TileGrid({ p, tables }: { p: FloorProps; tables: FloorTable[] }) {
  const t = useT();
  const { ref, fit } = useFitTiles<HTMLDivElement>(tables.length);
  return (
    <div ref={ref} data-overflow={fit?.overflow || undefined} className="min-h-[60dvh] min-w-0 flex-1 overflow-y-auto [scrollbar-width:thin] md:min-h-0">
      {tables.length === 0 ? (
        <p className="till-card grid h-full place-items-center rounded-2xl px-5 text-base text-muted">{t('pos.board.noTablesInArea')}</p>
      ) : fit ? (
        <ul className="grid min-h-full place-content-center" style={{ gridTemplateColumns: `repeat(${fit.cols}, ${fit.side}px)`, gridAutoRows: `${fit.side}px`, gap: TILE_GAP_PX }}>
          {tables.map((table) => (
            <li key={table.id} className="grid">
              <Tile p={p} table={table} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The one button that answers a waiting table: view the QR order, take the payment, or open it. */
function NeedAction({ p, table, need, className }: { p: FloorProps; table: FloorTable; need: Need; className?: string }) {
  const t = useT();
  if (need === 'PENDING_APPROVAL') {
    return (
      <button type="button" className={cx('btn-new min-h-12 shrink-0 rounded-xl px-4 text-md font-bold', className)} disabled={p.busy} onClick={() => p.onPress(table)}>
        {t('pos.calm.view')}
      </button>
    );
  }
  if (need === 'BILL_REQUESTED') {
    return (
      <button type="button" className={cx('btn-bill min-h-12 shrink-0 rounded-xl px-4 text-md font-bold', className)} disabled={p.busy} onClick={() => p.onGo(table, true)}>
        {t('pos.calm.pay')}
      </button>
    );
  }
  return (
    <button type="button" className={cx('btn-plain min-h-12 shrink-0 rounded-xl px-4 text-md font-bold', className)} disabled={p.busy} onClick={() => p.onGo(table)}>
      {t('pos.calm.open')}
    </button>
  );
}

const REASON = { PENDING_APPROVAL: 'pos.calm.newRequest', BILL_REQUESTED: 'pos.calm.billAsked', READY: 'pos.calm.ready' } as const;

/** One waiting item: the table, why it waits, and the one button that answers it. */
function QueueItem({ p, table, need, row = false }: { p: FloorProps; table: FloorTable; need: Need; row?: boolean }) {
  const t = useT();
  const money = useMoney();
  const time = useTime(p)(table);
  return (
    <li data-status={need} data-testid="queue-item" className={cx('queue-item flex items-center gap-3 rounded-xl px-3 py-2', row && 'min-w-64 shrink-0')}>
      <span className="w-12 shrink-0 text-center text-3xl font-bold leading-none" dir="ltr">
        {formatNumber(table.number)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-md font-bold">{t(REASON[need])}</span>
        <span className="truncate text-sm text-muted">
          {time.text ? (
            <span className="time" data-late={time.late || undefined}>
              {time.text}
            </span>
          ) : null}
          {time.text && table.orderId ? ' · ' : null}
          {table.orderId ? money(table.total) : null}
        </span>
      </span>
      <NeedAction p={p} table={table} need={need} />
    </li>
  );
}

function Queue({ p, row = false }: { p: FloorProps; row?: boolean }) {
  const t = useT();
  const items = queueOf(p.allTables);
  if (row) {
    return items.length === 0 ? (
      <p className="till-card flex min-h-16 shrink-0 items-center rounded-2xl px-4 text-base text-muted">{t('pos.calm.nothingWaiting')}</p>
    ) : (
      <ul aria-label={t('pos.calm.waiting')} className="flex shrink-0 gap-2 overflow-x-auto [scrollbar-width:thin]">
        {items.map((item) => (
          <QueueItem key={item.table.id} p={p} table={item.table} need={item.need} row />
        ))}
      </ul>
    );
  }
  return (
    <section aria-label={t('pos.calm.waiting')} className="flex min-h-0 flex-1 flex-col gap-2">
      <h2 className="flex items-center justify-between text-md font-bold">
        {t('pos.calm.waiting')}
        <span className="rounded-full bg-hover px-2.5 text-sm leading-6">{formatNumber(items.length)}</span>
      </h2>
      {items.length === 0 ? (
        <p className="py-6 text-center text-base text-muted">{t('pos.calm.nothingWaiting')}</p>
      ) : (
        <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto [scrollbar-width:thin]">
          {items.map((item) => (
            <QueueItem key={item.table.id} p={p} table={item.table} need={item.need} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** "+ Takeaway" / "+ Delivery": the tabs that hold the new-order form, when those order types are on. */
function OffPremiseLinks({ p, className }: { p: FloorProps; className?: string }) {
  const t = useT();
  if (!p.offPremise.takeaway && !p.offPremise.delivery) return null;
  return (
    <div className={cx('grid shrink-0 grid-flow-col gap-2', className)}>
      {p.offPremise.takeaway ? (
        <Link href="/pos/tables?area=takeaway" className="btn-plain inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-md font-bold">
          {t('pos.calm.newTakeaway')}
        </Link>
      ) : null}
      {p.offPremise.delivery ? (
        <Link href="/pos/tables?area=delivery" className="btn-plain inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-md font-bold">
          {t('pos.calm.newDelivery')}
        </Link>
      ) : null}
    </div>
  );
}

/** The selected table's bill: its items, total and the two ways on. */
function Bill({ p, table, horizontal = false }: { p: FloorProps; table: FloorTable; horizontal?: boolean }) {
  const t = useT();
  const money = useMoney();
  const time = useTime(p)(table);
  const title = t('pos.calm.table', { n: formatNumber(table.number) });
  const head = (
    <div className="flex items-start justify-between gap-2">
      <div className="flex flex-col leading-tight">
        <span className="text-2xl font-bold">{title}</span>
        <span className="flex items-center gap-2 text-sm text-muted">
          <span aria-hidden="true" className="state-dot" data-status={table.status} />
          {t(`pos.board.state.${STATE_KEY[table.status]}`)}
          {time.text ? (
            <span className="time" data-late={time.late || undefined}>
              · {time.text}
            </span>
          ) : null}
        </span>
      </div>
      <button type="button" onClick={p.onClear} aria-label={t('pos.calm.close')} title={t('pos.calm.close')} className="grid size-12 shrink-0 place-items-center rounded-xl hover:bg-hover">
        <X size={20} aria-hidden="true" />
      </button>
    </div>
  );
  const lines =
    table.lines.length === 0 ? (
      <p className="text-base text-muted">{t('pos.calm.noLines')}</p>
    ) : (
      <ul className={horizontal ? 'flex min-w-0 flex-1 flex-wrap content-start gap-x-4 gap-y-1 overflow-hidden' : 'flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-width:thin]'}>
        {table.lines.map((line, i) => (
          <li key={i} className={cx('flex items-baseline gap-2 text-md', !horizontal && 'slip-line py-2')}>
            <span className="shrink-0 font-bold" dir="ltr">
              {formatNumber(line.quantity)}×
            </span>
            <span dir="auto" className="min-w-0 truncate">
              {line.name}
            </span>
          </li>
        ))}
      </ul>
    );
  const actions = (
    <div className="flex shrink-0 flex-col gap-2">
      {!horizontal ? (
        <div className="flex items-baseline justify-between text-md">
          <span className="font-semibold text-muted">{t('pos.calm.total')}</span>
          <span className="text-2xl font-bold">{money(table.total)}</span>
        </div>
      ) : null}
      <div className={cx('grid gap-2', horizontal ? 'grid-flow-col' : 'grid-cols-2')}>
        <button type="button" disabled={p.busy} onClick={() => p.onGo(table)} className="btn-plain min-h-14 rounded-xl px-4 text-md font-bold">
          {t('pos.calm.openOrder')}
        </button>
        <button
          type="button"
          disabled={p.busy}
          onClick={() => p.onGo(table, true)}
          data-testid="bill-pay"
          className={cx('min-h-14 rounded-xl px-4 text-md font-bold', table.status === 'BILL_REQUESTED' ? 'btn-bill' : 'btn-main')}
        >
          {horizontal ? t('pos.calm.payAmount', { amount: money(table.total) }) : t('pos.calm.pay')}
        </button>
      </div>
    </div>
  );
  if (horizontal) {
    return (
      <section aria-label={title} data-testid="table-bill" className="flex min-h-0 flex-1 items-center gap-6">
        <div className="w-56 shrink-0">{head}</div>
        {lines}
        {actions}
      </section>
    );
  }
  return (
    <section aria-label={title} data-testid="table-bill" className="flex min-h-0 flex-1 flex-col gap-3">
      {head}
      {lines}
      {actions}
    </section>
  );
}

function selectedOf(p: FloorProps) {
  return p.selectedId ? (p.allTables.find((t) => t.id === p.selectedId && t.orderId !== null) ?? null) : null;
}

/** The fixed column beside the board: the selected table's bill, or what is waiting. */
function SideColumn({ p }: { p: FloorProps }) {
  const table = selectedOf(p);
  return (
    <aside className="till-panel flex min-h-[16rem] shrink-0 flex-col gap-3 rounded-2xl p-3 md:min-h-0 md:w-[min(360px,34%)]">
      {table ? <Bill p={p} table={table} /> : <Queue p={p} />}
      {!table ? <OffPremiseLinks p={p} /> : null}
    </aside>
  );
}

/** Free tables as small number chips. */
function FreeChips({ p, tables }: { p: FloorProps; tables: FloorTable[] }) {
  const t = useT();
  const button = useTableButton(p);
  const free = tables.filter((x) => x.status === 'FREE' && x.pendingRequests === 0);
  if (free.length === 0) return null;
  return (
    <section aria-label={t('pos.calm.free')} className="flex shrink-0 flex-col gap-2">
      <h2 className="text-sm font-bold text-muted">{t('pos.calm.free')}</h2>
      <ul className="flex max-h-[7.5rem] flex-wrap gap-2 overflow-y-auto [scrollbar-width:thin]">
        {free.map((table) => (
          <li key={table.id}>
            <button {...button(table)} className="s-keep-radius tile grid h-14 min-w-14 place-items-center px-3 text-xl font-bold">
              <span className="tile-no" aria-hidden="true" dir="ltr">
                {formatNumber(table.number)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The register: one line per table with its state, time and amount, in two columns. */
function Register({ p }: { p: FloorProps }) {
  const t = useT();
  const button = useTableButton(p);
  const timeOf = useTime(p);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
      <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 content-start gap-2 overflow-y-auto [scrollbar-width:thin] lg:grid-cols-2">
        {openFirst(p.tables).map((table) => {
          const time = timeOf(table);
          return (
            <li key={table.id}>
              <button {...button(table)} className="tile flex min-h-14 w-full !flex-row items-center gap-3 px-3 py-2">
                <span aria-hidden="true" className="state-dot" data-status={needOf(table) ?? table.status} />
                <span aria-hidden="true" className="tile-no w-10 text-2xl font-bold" dir="ltr">
                  {formatNumber(table.number)}
                </span>
                <span aria-hidden="true" className="min-w-0 flex-1 truncate text-md font-semibold">
                  {t(`pos.board.state.${STATE_KEY[table.status]}`)}
                </span>
                <span aria-hidden="true" className="tile-sub w-16 text-sm" data-late={time.late || undefined}>
                  {time.text}
                </span>
                <span aria-hidden="true" className="w-24 text-end text-md font-bold" dir="ltr">
                  {table.orderId ? formatNumber(table.total) : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <SideColumn p={p} />
    </div>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const;

/** The keypad: the number of the table to open, typed; beside it what is waiting and the open tables. */
function Keypad({ p }: { p: FloorProps }) {
  const t = useT();
  const [typed, setTyped] = useState('');
  const [missing, setMissing] = useState(false);
  function key(k: (typeof KEYS)[number]) {
    setMissing(false);
    if (k === 'clear') setTyped('');
    else if (k === 'back') setTyped((v) => v.slice(0, -1));
    else setTyped((v) => (v.length < 4 ? v + k : v));
  }
  function go() {
    const table = p.allTables.find((x) => x.number === Number(typed));
    if (!table) {
      setMissing(true);
      return;
    }
    setTyped('');
    p.onPress(table);
  }
  const open = p.allTables.filter((x) => x.orderId !== null).sort((a, b) => a.number - b.number);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="till-panel flex max-h-[45%] min-h-0 flex-col rounded-2xl p-3">
          <Queue p={p} />
        </div>
        <section aria-label={t('pos.calm.openTables')} className="flex min-h-0 flex-1 flex-col gap-2">
          <h2 className="text-sm font-bold text-muted">{t('pos.calm.openTables')}</h2>
          <ul className="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(96px,1fr))] content-start gap-2 overflow-y-auto [scrollbar-width:thin]">
            {open.map((table) => (
              <li key={table.id} className="h-24">
                <Tile p={p} table={table} style={{ height: '100%', width: '100%' }} />
              </li>
            ))}
          </ul>
        </section>
        <FreeChips p={p} tables={p.allTables} />
      </div>
      <form
        className="till-panel flex shrink-0 flex-col gap-2 rounded-2xl p-3 md:w-[min(340px,40%)]"
        onSubmit={(event) => {
          event.preventDefault();
          go();
        }}
      >
        <label htmlFor="keypad-number" className="text-sm font-bold text-muted">
          {t('pos.calm.tableNumber')}
        </label>
        <input
          id="keypad-number"
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          value={typed}
          onChange={(event) => {
            setMissing(false);
            setTyped(event.target.value.replace(/\D/g, '').slice(0, 4));
          }}
          aria-invalid={missing || undefined}
          aria-describedby={missing ? 'keypad-missing' : undefined}
          className="h-16 rounded-xl border border-line bg-raised px-4 text-center text-4xl font-bold"
        />
        <p id="keypad-missing" role="alert" className="min-h-6 text-sm font-semibold text-danger">
          {missing ? t('pos.calm.noSuchTable') : ''}
        </p>
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-2">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => key(k)}
              aria-label={k === 'clear' ? t('pos.calm.clear') : k === 'back' ? t('pos.calm.erase') : undefined}
              className="keypad-key grid min-h-12 place-items-center text-2xl font-bold"
            >
              {k === 'clear' ? <span className="text-md">{t('pos.calm.clear')}</span> : k === 'back' ? <Delete size={22} aria-hidden="true" /> : k}
            </button>
          ))}
        </div>
        <button type="submit" disabled={typed === '' || p.busy} className="btn-main min-h-14 rounded-xl text-lg font-bold">
          {t('pos.calm.open')}
        </button>
      </form>
    </div>
  );
}

/** Busy and free: every table in use as a big card with its one action; the free ones as a row of chips. */
function Groups({ p }: { p: FloorProps }) {
  const t = useT();
  const money = useMoney();
  const button = useTableButton(p);
  const timeOf = useTime(p);
  const busy = openFirst(p.tables).filter((x) => x.status !== 'FREE' || x.pendingRequests > 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ul className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(200px,1fr))] content-start gap-3 overflow-y-auto [scrollbar-width:thin]">
        {busy.length === 0 ? <li className="col-span-full py-10 text-center text-base text-muted">{t('pos.calm.nothingWaiting')}</li> : null}
        {busy.map((table) => {
          const need = needOf(table);
          const time = timeOf(table);
          return (
            <li key={table.id} data-status={need ?? table.status} className="slip flex flex-col gap-2 rounded-2xl p-3">
              <button {...button(table)} className="flex items-baseline justify-between gap-2 text-start">
                <span aria-hidden="true" className="text-4xl font-bold leading-none" dir="ltr">
                  {formatNumber(table.number)}
                </span>
                <span aria-hidden="true" className="time text-sm text-muted" data-late={time.late || undefined}>
                  {time.text}
                </span>
              </button>
              <span className="flex items-baseline justify-between gap-2 text-md">
                <span className="truncate font-semibold">{need === 'PENDING_APPROVAL' ? t('pos.calm.newRequest') : t(`pos.board.state.${STATE_KEY[table.status]}`)}</span>
                <span className="font-bold">{table.orderId ? money(table.total) : ''}</span>
              </span>
              <NeedAction p={p} table={table} need={need ?? 'READY'} />
            </li>
          );
        })}
      </ul>
      <FreeChips p={p} tables={p.tables} />
    </div>
  );
}

/** A thin rail of every table: the order-first layout's way to switch tables (also beside the order page). */
function Rail({ p }: { p: FloorProps }) {
  const t = useT();
  return (
    <ul aria-label={t('pos.board.title')} className="grid w-24 shrink-0 auto-rows-[72px] content-start gap-2 overflow-y-auto [scrollbar-width:thin]">
      {[...p.allTables]
        .sort((a, b) => a.number - b.number)
        .map((table) => (
          <li key={table.id} className="grid">
            <Tile p={p} table={table} />
          </li>
        ))}
    </ul>
  );
}

const ZONE_TILE = 96;

/** Areas as rows: every area's tables in one wrapping row, then takeaway and delivery as cards. No tabs. */
function Zones({ p }: { p: FloorProps }) {
  const t = useT();
  const money = useMoney();
  const rows = p.areas
    .map((area) => ({ area, tables: p.allTables.filter((x) => x.areaId === area.id).sort((a, b) => a.number - b.number) }))
    .filter((r) => r.tables.length > 0);
  const showOff = p.offCards.length > 0 || p.offPremise.takeaway || p.offPremise.delivery;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto [scrollbar-width:thin]">
      {rows.map(({ area, tables }) => (
        <section key={area.id} aria-label={area.name} className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-md font-bold">
            {area.name}
            <span className="rounded-full bg-hover px-2 text-sm leading-6 text-muted" dir="ltr">
              {formatNumber(area.busyCount)}/{formatNumber(area.tableCount)}
            </span>
          </h2>
          <ul className="flex flex-wrap gap-2.5">
            {tables.map((table) => (
              <li key={table.id} className="grid" style={{ width: ZONE_TILE, height: ZONE_TILE }}>
                <Tile p={p} table={table} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {showOff ? (
        <section aria-label={t('pos.calm.offPremise')} className="flex flex-col gap-2">
          <h2 className="text-md font-bold">{t('pos.calm.offPremise')}</h2>
          <ul className="flex flex-wrap gap-2.5">
            {p.offCards.map((card) => (
              <li key={card.orderId}>
                <Link href={`/pos/orders/${card.orderId}`} className="tile flex h-24 w-44 flex-col justify-between p-3">
                  <span className="truncate text-sm font-bold">
                    {card.kind === 'DELIVERY' ? t('pos.offp.tabDelivery') : t('pos.offp.tabTakeaway')} · {t('pos.offp.queue', { n: formatNumber(card.queueNumber) })}
                  </span>
                  <span className="tile-sub truncate text-sm">{t(`pos.offp.state.${card.fulfillment}`)}</span>
                  <span className="text-md font-bold">{money(card.total)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <OffPremiseLinks p={p} className="max-w-md" />
        </section>
      ) : null}
    </div>
  );
}

const SLIP_LINES = 5;

/** Slips: each open table a paper ticket with its items and total; the free tables below. */
function Slips({ p }: { p: FloorProps }) {
  const t = useT();
  const money = useMoney();
  const button = useTableButton(p);
  const timeOf = useTime(p);
  const open = openFirst(p.tables).filter((x) => x.orderId !== null || x.pendingRequests > 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ul className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(220px,1fr))] content-start gap-3 overflow-y-auto [scrollbar-width:thin]">
        {open.length === 0 ? <li className="col-span-full py-10 text-center text-base text-muted">{t('pos.calm.nothingWaiting')}</li> : null}
        {open.map((table) => {
          const need = needOf(table);
          const time = timeOf(table);
          const shown = table.lines.slice(0, SLIP_LINES);
          const rest = table.lines.length - shown.length;
          return (
            <li key={table.id} className="grid">
              <button {...button(table)} data-status={need ?? table.status} className="slip flex flex-col gap-2 rounded-xl p-3 text-start">
                <span aria-hidden="true" className="flex items-baseline justify-between gap-2">
                  <span className="text-3xl font-bold leading-none" dir="ltr">
                    {formatNumber(table.number)}
                  </span>
                  <span className="time text-sm text-muted" data-late={time.late || undefined}>
                    {time.text}
                  </span>
                </span>
                <span aria-hidden="true" className="text-sm font-bold text-muted">
                  {need === 'PENDING_APPROVAL' ? t('pos.calm.newRequest') : t(`pos.board.state.${STATE_KEY[table.status]}`)}
                </span>
                <span aria-hidden="true" className="flex flex-1 flex-col">
                  {shown.length === 0 ? <span className="text-sm text-muted">{t('pos.calm.noLines')}</span> : null}
                  {shown.map((line, i) => (
                    <span key={i} className="slip-line flex gap-2 py-1 text-sm">
                      <span className="font-bold" dir="ltr">
                        {formatNumber(line.quantity)}×
                      </span>
                      <span dir="auto" className="truncate">
                        {line.name}
                      </span>
                    </span>
                  ))}
                  {rest > 0 ? <span className="py-1 text-sm text-muted">{t('pos.calm.more', { n: formatNumber(rest) })}</span> : null}
                </span>
                <span aria-hidden="true" className="flex items-baseline justify-between text-md">
                  <span className="font-semibold text-muted">{t('pos.calm.total')}</span>
                  <span className="font-bold">{table.orderId ? money(table.total) : '—'}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <FreeChips p={p} tables={p.tables} />
    </div>
  );
}

/** The floor in the device's chosen arrangement (docs/superpowers/specs/2026-10-26-pos-calm-layouts-design.md). */
export function Floor(p: FloorProps) {
  switch (p.layout) {
    case 'strip':
      return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <Queue p={p} row />
          <TileGrid p={p} tables={p.tables} />
        </div>
      );
    case 'register':
      return <Register p={p} />;
    case 'keypad':
      return <Keypad p={p} />;
    case 'dock': {
      const table = selectedOf(p);
      return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <TileGrid p={p} tables={p.tables} />
          <div className="till-panel flex shrink-0 flex-col gap-3 rounded-2xl px-4 py-3 md:h-36 md:flex-row md:items-center">
            {table ? (
              <Bill p={p} table={table} horizontal />
            ) : (
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
                <Queue p={p} row />
              </div>
            )}
            {!table ? <OffPremiseLinks p={p} className="md:w-56" /> : null}
          </div>
        </div>
      );
    }
    case 'groups':
      return <Groups p={p} />;
    case 'order':
      return (
        <div className="flex min-h-0 flex-1 gap-3">
          <Rail p={p} />
          <div className="till-panel flex min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-2xl p-4">
            <Queue p={p} />
            <OffPremiseLinks p={p} />
          </div>
        </div>
      );
    case 'zones':
      return <Zones p={p} />;
    case 'slips':
      return <Slips p={p} />;
    case 'tiles':
    case 'night':
    default:
      return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
          <TileGrid p={p} tables={p.tables} />
          <SideColumn p={p} />
        </div>
      );
  }
}
