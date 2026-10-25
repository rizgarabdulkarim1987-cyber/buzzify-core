'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { currentKey, deriveLocalState, localTotals, type LocalOrder } from '@/lib/pos-sync/local-state';
import type { OpDraft } from '@/lib/pos-sync/queue';
import { formatNumber, ltr } from '@/lib/pos-format';
import { pickName, quickCash } from '@/lib/pos-view';
import { parseAmount } from '@/server/domain/pos/cash';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { Dialog } from '@/studio/ui/Dialog';
import { Input } from '@/studio/ui/Input';
import { Textarea } from '@/studio/ui/Textarea';
import { OptionsSheet, type Chosen } from '../OptionsSheet';
import { useMoney } from '../money';
import { QueuePanel } from './QueuePanel';
import { useSync } from './SyncProvider';

type Tab = 'tables' | 'queue';

/**
 * The till when the network is away, and the same screen online: tables, the order of a table, and the queue. Everything it
 * shows is derived from the saved snapshot plus the operations not yet applied, and everything it does is a queued operation.
 */
export function OfflineTill() {
  const t = useT();
  const sync = useSync();
  const [tab, setTab] = useState<Tab>(useSearchParams().get('view') === 'queue' ? 'queue' : 'tables');
  const [viewKey, setViewKey] = useState<string | null>(null);

  const snapshot = sync.snapshot;
  const local = useMemo(() => (snapshot ? deriveLocalState(snapshot, sync.queue) : null), [snapshot, sync.queue]);
  const order = local && viewKey ? (local.all.find((o) => o.key === currentKey(viewKey, sync.queue)) ?? null) : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-8">
      <h1 className="text-xl font-semibold text-text">{t('pos.offline.title')}</h1>
      <p role="status" data-testid="offline-banner" className={cx('rounded-md border px-3 py-2 text-sm', sync.online ? 'border-line text-muted' : 'border-accent bg-accent-wash text-text')}>
        {sync.online ? t('pos.offline.bannerOnline') : t('pos.offline.bannerOffline')}
      </p>
      <div role="tablist" className="flex gap-2">
        {(['tables', 'queue'] as const).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cx('min-h-12 rounded-md border px-4 text-base', tab === key ? 'border-ink bg-ink text-on-ink' : 'border-line text-text')}
          >
            {key === 'tables' ? t('pos.offline.back') : `${t('pos.offline.queue')}${sync.queue.some((q) => q.state !== 'done') ? ` (${formatNumber(sync.queue.filter((q) => q.state !== 'done').length)})` : ''}`}
          </button>
        ))}
      </div>
      {tab === 'queue' ? (
        <QueuePanel />
      ) : !sync.ready ? null : !snapshot || !local ? (
        <p className="text-muted">{t('pos.offline.noCopy')}</p>
      ) : order ? (
        <OrderView order={order} onBack={() => setViewKey(null)} />
      ) : (
        <Board onPick={setViewKey} local={local} />
      )}
    </div>
  );
}

function Board({ local, onPick }: { local: ReturnType<typeof deriveLocalState>; onPick: (key: string) => void }) {
  const t = useT();
  const sync = useSync();
  const [message, setMessage] = useState<string | null>(null);
  const snapshot = sync.snapshot!;

  const open = async (tableId: string) => {
    const result = await sync.enqueue({ kind: 'openOrder', payload: { tableId } });
    if (result.ok) onPick(`op:${result.op.operationId}`);
    else setMessage(t(`pos.offline.refuse.${result.reason}`));
  };

  return (
    <div className="flex flex-col gap-6">
      {message ? (
        <p role="alert" className="rounded-md border border-danger bg-danger-wash px-3 py-2 text-sm text-text">
          {message}
        </p>
      ) : null}
      {!snapshot.openShift ? <p className="text-muted">{t('pos.offline.noShift')}</p> : null}
      {snapshot.areas.map((area) => (
        <section key={area.id} className="flex flex-col gap-2">
          <h2 dir="auto" className="text-base font-semibold text-text">
            {area.name}
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {area.tables.map((table) => {
              const held = local.byTable.get(table.id);
              return (
                <li key={table.id}>
                  <button
                    data-testid={`offline-table-${table.number}`}
                    onClick={() => (held ? onPick(held.key) : void open(table.id))}
                    className={cx('flex min-h-24 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 p-3 text-center', held ? 'border-accent bg-accent-wash' : 'border-line')}
                  >
                    <span className="text-lg font-semibold text-text">{t('pos.offline.table', { n: formatNumber(table.number) })}</span>
                    <span className="text-sm text-muted">{held ? t('pos.offline.tableBusy') : t('pos.offline.tableFree')}</span>
                    {held && held.waiting > 0 ? <span className="text-sm text-text">{t('pos.offline.tableWaiting', { n: formatNumber(held.waiting) })}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function OrderView({ order, onBack }: { order: LocalOrder; onBack: () => void }) {
  const t = useT();
  const sync = useSync();
  const money = useMoney();
  const { locale } = useLocale();
  const snapshot = sync.snapshot!;
  const catalog = snapshot.catalog;
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'cancel' | 'pay' | null>(null);
  const [reason, setReason] = useState('');
  const [received, setReceived] = useState('');

  const totals = localTotals(order, snapshot.rates);
  const finished = order.paid !== null || order.cancelled;
  const ref = order.serverId ? { id: order.serverId } : { op: order.key.slice(3) };
  const product = catalog?.products.find((p) => p.id === picked) ?? null;

  const queue = async (draft: OpDraft): Promise<boolean> => {
    const result = await sync.enqueue(draft);
    if (!result.ok) setMessage(t(`pos.offline.refuse.${result.reason}`));
    else setMessage(null);
    return result.ok;
  };
  const withRef = <K extends 'sendToKitchen' | 'requestBill'>(kind: K): OpDraft => ({ kind, orderRef: ref, expectedVersion: order.version, payload: {} }) as OpDraft;

  const add = async (p: NonNullable<typeof product>, chosen: Chosen) => {
    const ok = await queue({
      kind: 'addLine',
      orderRef: ref,
      expectedVersion: order.version,
      payload: { productId: p.id, quantity: chosen.quantity, note: chosen.note, optionIds: chosen.optionIds, ...(chosen.variantId ? { variantId: chosen.variantId } : {}) },
    });
    if (ok) setPicked(null);
  };

  const amount = parseAmount(received);
  const canConfirmPay = amount !== null && amount >= totals.total;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button size="lg" variant="secondary" className="min-h-12" onClick={onBack}>
          {t('pos.offline.back')}
        </Button>
        <p data-testid="offline-order-number" className="text-base font-semibold text-text">
          {order.provisional && order.number === null ? t('pos.offline.provisional', { n: order.provisional }) : t('pos.offline.number', { n: formatNumber(order.number ?? 0) })}
        </p>
      </div>
      {message ? (
        <p role="alert" className="rounded-md border border-danger bg-danger-wash px-3 py-2 text-sm text-text">
          {message}
        </p>
      ) : null}

      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
        {order.lines.filter((l) => !l.cancelled).length === 0 ? <li className="p-3 text-muted">{t('pos.offline.noLines')}</li> : null}
        {order.lines
          .filter((l) => !l.cancelled)
          .map((line) => (
            <li key={line.id} className="flex items-center justify-between gap-3 p-3">
              <span dir="auto" className="min-w-0 break-words text-text">
                {formatNumber(line.quantity)} × {line.name}
                {line.options.length ? <span className="block text-sm text-muted">{line.options.map((o) => o.name).join(' · ')}</span> : null}
                {line.note ? (
                  <span dir="auto" className="block text-sm text-muted">
                    {line.note}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-text">{money((line.unitPrice + line.options.reduce((s, o) => s + o.priceDelta, 0)) * line.quantity)}</span>
            </li>
          ))}
      </ul>

      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm text-muted">
        <dt>{t('pos.offline.subtotal')}</dt>
        <dd>{money(totals.subtotal)}</dd>
        <dt>{t('pos.offline.service')}</dt>
        <dd>{money(totals.service)}</dd>
        <dt>{t('pos.offline.tax')}</dt>
        <dd>{money(totals.tax)}</dd>
        <dt className="text-base font-semibold text-text">{t('pos.offline.total')}</dt>
        <dd data-testid="offline-total" className="text-base font-semibold text-text">
          {money(totals.total)}
        </dd>
      </dl>

      {order.paid ? (
        <div className="flex flex-col gap-2 rounded-lg border border-success bg-success-wash p-3">
          <p data-testid="offline-paid" className="font-semibold text-text">
            {t('pos.offline.paid', { total: money(order.paid.total), change: money(order.paid.change) })}
          </p>
          <p className="text-sm text-muted">{t('pos.offline.paidProvisional')}</p>
          <Button size="lg" className="min-h-12 self-start print:hidden" onClick={() => window.print()}>
            {t('pos.offline.print')}
          </Button>
        </div>
      ) : null}

      {!finished ? (
        <>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button size="lg" className="min-h-12" onClick={() => void queue(withRef('sendToKitchen'))} disabled={!order.lines.some((l) => !l.sent && !l.cancelled)}>
              {t('pos.offline.send')}
            </Button>
            <Button size="lg" className="min-h-12" onClick={() => void queue(withRef('requestBill'))} disabled={order.lines.length === 0 || order.status === 'BILL_REQUESTED'}>
              {t('pos.offline.bill')}
            </Button>
            {snapshot.user.can.pay ? (
              <Button size="lg" variant="primary" className="min-h-12" disabled={order.lines.length === 0} onClick={() => (setReceived(''), setDialog('pay'))}>
                {t('pos.offline.pay')}
              </Button>
            ) : null}
            {snapshot.user.can.cancel ? (
              <Button size="lg" variant="danger" className="min-h-12" onClick={() => (setReason(''), setDialog('cancel'))}>
                {t('pos.offline.cancel')}
              </Button>
            ) : null}
          </div>

          {catalog ? (
            <section className="flex flex-col gap-3 print:hidden">
              <div className="flex flex-wrap gap-2">
                {[{ id: null as string | null, label: t('pos.offline.categoryAll') }, ...catalog.categories.map((c) => ({ id: c.id as string | null, label: pickName(c.names, locale, catalog.defaultLocale) }))].map((c) => (
                  <button
                    key={c.id ?? 'all'}
                    onClick={() => setCategoryId(c.id)}
                    aria-pressed={categoryId === c.id}
                    dir="auto"
                    className={cx('min-h-12 rounded-md border px-4', categoryId === c.id ? 'border-ink bg-ink text-on-ink' : 'border-line text-text')}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {catalog.products
                  .filter((p) => categoryId === null || p.categoryId === categoryId)
                  .map((p) => (
                    <li key={p.id}>
                      <button
                        data-testid={`offline-product-${p.id}`}
                        disabled={!p.available}
                        onClick={() => setPicked(p.id)}
                        className="flex min-h-20 w-full flex-col items-start gap-1 rounded-lg border border-line p-3 text-start disabled:opacity-50"
                      >
                        <span dir="auto" className="break-words font-medium text-text">
                          {pickName(p.names, locale, catalog.defaultLocale)}
                        </span>
                        <span className="text-sm text-muted">{p.available ? money(p.price) : t('pos.offline.unavailable')}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {catalog ? <OptionsSheet product={product} fallback={catalog.defaultLocale} pending={false} onClose={() => setPicked(null)} onAdd={(p, chosen) => void add(p, chosen)} /> : null}

      <Dialog
        open={dialog === 'cancel'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('pos.offline.cancelTitle')}
        footer={
          <>
            <Button className="min-h-12" onClick={() => setDialog(null)}>
              {t('pos.offline.close')}
            </Button>
            <Button
              variant="danger"
              className="min-h-12"
              disabled={reason.trim() === ''}
              onClick={async () => {
                if (await queue({ kind: 'cancelOrder', orderRef: ref, expectedVersion: order.version, payload: { reason: reason.trim() } })) setDialog(null);
              }}
            >
              {t('pos.offline.confirm')}
            </Button>
          </>
        }
      >
        <label className="flex flex-col gap-1 text-sm text-text">
          {t('pos.offline.reason')}
          <Textarea dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </label>
      </Dialog>

      <Dialog
        open={dialog === 'pay'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('pos.offline.pay')}
        description={`${t('pos.offline.total')}: ${money(totals.total)}`}
        footer={
          <>
            <Button className="min-h-12" onClick={() => setDialog(null)}>
              {t('pos.offline.close')}
            </Button>
            <Button
              variant="primary"
              className="min-h-12"
              disabled={!canConfirmPay}
              data-testid="offline-pay-confirm"
              onClick={async () => {
                if (amount !== null && (await queue({ kind: 'payCash', orderRef: ref, expectedVersion: order.version, payload: { expectedTotal: totals.total, amountReceived: amount } }))) setDialog(null);
              }}
            >
              {t('pos.offline.confirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {quickCash(totals.total).map((value) => (
              <Button key={value} className="min-h-12" onClick={() => setReceived(String(value))}>
                {ltr(formatNumber(value))}
              </Button>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-sm text-text">
            {t('pos.offline.amountReceived')}
            <Input inputMode="numeric" dir="ltr" value={received} onChange={(e) => setReceived(e.target.value)} data-testid="offline-received" />
          </label>
          {amount !== null && amount >= totals.total ? (
            <p className="text-sm text-muted">
              {t('pos.offline.change')}: {money(amount - totals.total)}
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
