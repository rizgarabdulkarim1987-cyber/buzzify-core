'use client';

import { ArrowLeft, ArrowRightLeft, Ban, Merge, Percent, ReceiptText, SlidersHorizontal, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useMemo, useState } from 'react';
import {
  addPosLine,
  cancelPosLine,
  cancelPosOrder,
  mergePosOrders,
  movePosOrderToTable,
  requestPosBill,
  sendPosToKitchen,
  setPosInvoiceDiscount,
  updatePosLine,
} from '@/app/studio/_actions/pos';
import type { Approver } from '@/lib/pos-approval';
import { formatNumber } from '@/lib/pos-format';
import { evenGroups, partTotalOf, toggleLine, unpaidLineIds } from '@/lib/pos-split';
import type { Shortcut } from '@/lib/pos-shortcuts';
import { needsSheet, pickName, typedAmount, visibleProducts } from '@/lib/pos-view';
import type { DriverRow, ZoneRow } from '@/server/pos/delivery-setup';
import type { OrderView, OrderLineView } from '@/server/pos/orders';
import { offerPerUnit } from '@/server/domain/pos/line-offer';
import { productByBarcode } from '@/server/domain/pos/scan';
import type { TillCatalog, TillProduct } from '@/server/pos/till-catalog';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { ApprovalFields, approvalOf, DiscountReasonFields } from './ApprovalFields';
import { useMoney } from './money';
import { useProductOffer } from './offers';
import { OffPremiseBar } from './OffPremiseBar';
import { OptionsSheet, Stepper, type Chosen } from './OptionsSheet';
import { PayPanel } from './PayPanel';
import { usePrint } from './print/PrintProvider';
import { useBarcodeScanner } from './use-barcode-scanner';
import { Shortcuts } from './Shortcuts';
import { usePosCall } from './use-pos-call';

export interface OrderCan {
  discount: boolean;
  cancel: boolean;
  pay: boolean;
}

export interface FreeTable {
  id: string;
  number: number;
  areaName: string;
}

/** Another table's open order that this one can be merged into. */
export interface MergeTarget {
  orderId: string;
  version: number;
  number: number;
  areaName: string;
}

type Dialogs = 'none' | 'pay' | 'paySelected' | 'invoiceDiscount' | 'cancelOrder' | 'move' | 'merge' | { line: OrderLineView; kind: 'cancel' | 'discount' };

export interface DeliveryChoices {
  zones: ZoneRow[];
  drivers: DriverRow[];
}

export function OrderScreen({
  order,
  catalog,
  can,
  freeTables,
  mergeTargets = [],
  delivery,
  approvers,
  initialPaying = false,
}: {
  order: OrderView;
  catalog: TillCatalog | null;
  can: OrderCan;
  /** Managers who can approve a cashier's discount or cancel; null when the person needs no approval. */
  approvers: Approver[] | null;
  freeTables: FreeTable[];
  /** Other tables with an open order, to merge this one into. */
  mergeTargets?: MergeTarget[];
  delivery: DeliveryChoices;
  /** Open on the payment step (the board's "Pay", `?pay=1`). Ignored without the payment permission or a live line. */
  initialPaying?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const money = useMoney();
  const router = useRouter();
  const { call, pending } = usePosCall();
  const { printKitchenRound } = usePrint();
  const [tab, setTab] = useState<'menu' | 'order'>('menu');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sheet, setSheet] = useState<TillProduct | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(() => (initialPaying && can.pay && order.lines.some((line) => !line.cancelled) ? 'pay' : 'none'));

  const fallback = catalog?.defaultLocale ?? 'en';
  const offerFor = useProductOffer(catalog);
  const products = useMemo(() => (catalog ? visibleProducts(catalog, categoryId, search) : []), [catalog, categoryId, search]);
  // With every category showing (and no search), the menu is cut into one titled section per category.
  const sections = useMemo(() => {
    if (!catalog || categoryId !== null || search.trim() !== '' || catalog.categories.length < 2) return [{ id: categoryId, label: null as string | null, products }];
    return [...catalog.categories]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((category) => ({ id: category.id as string | null, label: pickName(category.names, locale, fallback) as string | null, products: products.filter((product) => product.categoryId === category.id) }))
      .filter((section) => section.products.length > 0);
  }, [catalog, categoryId, search, products, locale, fallback]);
  const liveLines = order.lines.filter((line) => !line.cancelled);
  // Split bill: the guest's lines are ticked and paid on their own; the share includes a part of the discount, service and tax.
  const [splitting, setSplitting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const stillUnpaid = unpaidLineIds(order.lines);
  const picked = selected.filter((id) => stillUnpaid.includes(id));
  const pickedTotal = partTotalOf(order.totals, order.taken, order.lines, picked, order.roundingStep);
  const leaveSplit = () => {
    setSplitting(false);
    setSelected([]);
  };
  /** How many of each product are on the order now, for the count on its button. */
  const onOrder = useMemo(() => {
    const counts = new Map<string, number>();
    for (const line of order.lines) if (!line.cancelled && line.productId) counts.set(line.productId, (counts.get(line.productId) ?? 0) + line.quantity);
    return counts;
  }, [order.lines]);
  const unsent = liveLines.filter((line) => !line.sent);
  const kitchenOn = order.kitchen.print || order.kitchen.screen;
  const itemCount = liveLines.reduce((sum, line) => sum + line.quantity, 0);
  const canChange = order.status === 'OPEN' || order.status === 'READY' || order.status === 'BILL_REQUESTED';

  const add = (product: TillProduct, chosen: Chosen) =>
    void call(
      () =>
        addPosLine({
          orderId: order.id,
          productId: product.id,
          quantity: chosen.quantity,
          note: chosen.note,
          variantId: chosen.variantId,
          optionIds: chosen.optionIds,
          expectedVersion: order.version,
        }),
      { onOk: () => setSheet(null) },
    );

  const tapProduct = (product: TillProduct) => {
    if (needsSheet(product)) setSheet(product);
    else add(product, { variantId: product.variants[0]?.id, optionIds: [], quantity: 1, note: '' });
  };

  // A scanned barcode adds the product like a tap on it; a code nobody has, or a sold-out product, says so.
  useBarcodeScanner((code) => {
    const id = catalog ? productByBarcode(catalog.products, code) : null;
    const scanned = catalog?.products.find((p) => p.id === id);
    if (!scanned) toast.error(t('pos.scan.unknown'));
    else if (!scanned.available) toast.error(t('pos.scan.soldOut'));
    else tapProduct(scanned);
  }, canChange && dialog === 'none' && sheet === null);

  const reasonOf = (form: FormData) => String(form.get('reason') ?? '').trim();
  const failed = { message: t('pos.order.actionRefused') };
  /** A refusal for a dialog: a manager's approval that failed goes under the PIN field, the rest as before. */
  const problemOf = (error: Parameters<typeof describeFailure>[2], field: 'reason' | 'value'): { message?: string; fields?: Record<string, string> } => {
    if (error.code === 'FORBIDDEN') return { fields: { approvalPin: describeFailure(t, locale, error).message } };
    if (error.fields?.note) return { fields: { note: error.fields.note } };
    return error.fields?.[field] ? { fields: { [field]: error.fields[field] } } : failed;
  };

  const onShortcut = (shortcut: Shortcut) => {
    if (shortcut === 'search') {
      setTab('menu');
      // The search box is on screen only after the menu tab shows, so focus it on the next frame.
      requestAnimationFrame(() => document.getElementById('pos-menu-search')?.focus());
    } else if (shortcut === 'pay') {
      if (can.pay && canChange && stillUnpaid.length > 0 && dialog === 'none' && !pending) setDialog('pay');
    } else if (dialog !== 'none') {
      setDialog('none');
    } else if (splitting) {
      leaveSplit();
    } else if (search !== '') {
      setSearch('');
    }
  };

  return (
    <div className="flex flex-col gap-3 px-4 pb-24 pt-4 sm:px-8 lg:min-h-0 lg:flex-1 lg:pb-4">
      <Shortcuts onShortcut={onShortcut} />
      <p className="hidden text-sm text-muted lg:block">{t('pos.shortcuts.help')}</p>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href="/pos/tables" aria-label={t('pos.calm.backToTables')} className="grid size-14 place-items-center rounded-2xl border border-line bg-raised text-text hover:bg-hover">
          <ArrowLeft size={26} aria-hidden className="rtl:rotate-180" />
        </Link>
        <h1 className="text-3xl font-bold sm:text-4xl">
          {order.offPremise
            ? t(order.kind === 'DELIVERY' ? 'pos.offp.headingDelivery' : 'pos.offp.headingTakeaway', { n: formatNumber(order.number), q: formatNumber(order.offPremise.queueNumber) })
            : order.tableNumber !== null
              ? t('pos.calm.table', { n: formatNumber(order.tableNumber) })
              : t('pos.order.headingNoTable', { n: formatNumber(order.number) })}
        </h1>
        <span data-status={order.status} className={cx('rounded-full px-3.5 text-base leading-8 font-bold', order.status === 'BILL_REQUESTED' ? 'bg-danger text-on-status' : 'bg-hover text-text')}>
          {t(`pos.order.status.${order.status}`)}
        </span>
        {order.tableNumber !== null && !order.offPremise ? <span className="text-base text-muted">{t('pos.calm.orderNo', { n: formatNumber(order.number) })}</span> : null}
        {canChange && can.cancel ? (
          <button type="button" disabled={pending} onClick={() => setDialog('cancelOrder')} className="ms-auto inline-flex min-h-12 items-center gap-2 rounded-xl px-4 text-base font-semibold text-danger hover:bg-hover disabled:opacity-60">
            <Ban size={20} aria-hidden />
            {t('pos.order.cancelOrder')}
          </button>
        ) : null}
      </header>

      <OffPremiseBar order={order} zones={delivery.zones} drivers={delivery.drivers} editable={canChange} />

      <div role="tablist" className="flex gap-1 lg:hidden">
        {(['menu', 'order'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cx('min-h-12 flex-1 rounded-md border text-base font-medium', tab === key ? 'border-ink bg-ink text-on-ink' : 'border-line-strong text-text')}
          >
            {key === 'menu' ? t('pos.order.tabMenu') : `${t('pos.order.tabOrder')} (${formatNumber(itemCount)})`}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-[minmax(0,1fr)]">
        <section aria-label={t('pos.order.tabMenu')} className={cx('flex min-w-0 flex-col gap-3 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pe-1 [&>*]:shrink-0', tab === 'order' && 'hidden lg:flex')}>
          {!catalog ? (
            <Alert>{t('pos.order.noCatalog')}</Alert>
          ) : (
            <>
              <Input
                id="pos-menu-search"
                type="search"
                size="lg"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('pos.order.search')}
                aria-label={t('pos.order.search')}
              />
              <div role="tablist" aria-label={t('pos.order.categories')} className="flex gap-1 overflow-x-auto pb-1">
                {[{ id: null, label: t('pos.board.allAreas') }, ...catalog.categories.map((c) => ({ id: c.id, label: pickName(c.names, locale, fallback) }))].map((category) => (
                  <button
                    key={category.id ?? 'all'}
                    type="button"
                    role="tab"
                    aria-selected={categoryId === category.id}
                    onClick={() => setCategoryId(category.id)}
                    className={cx(
                      'min-h-12 shrink-0 rounded-full border px-5 text-base font-semibold whitespace-nowrap',
                      categoryId === category.id ? 'border-ink bg-ink text-on-ink' : 'border-line bg-raised text-text hover:bg-hover',
                    )}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
              {products.length === 0 ? (
                <EmptyState title={t('pos.order.noProducts')} />
              ) : (
                <div className="flex flex-col gap-6">
                  {sections.map((section) => (
                    <section key={section.id ?? 'all'} aria-label={section.label ?? undefined}>
                      {section.label ? <h2 className="mb-3 text-lg font-bold text-muted">{section.label}</h2> : null}
                      <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
                        {section.products.map((product) => {
                          const count = onOrder.get(product.id) ?? 0;
                          const offer = offerFor(product);
                          return (
                            <li key={product.id} className="flex">
                              <button
                                type="button"
                                disabled={!canChange || pending || !product.available}
                                onClick={() => tapProduct(product)}
                                className={cx(
                                  's-keep-radius relative flex min-h-28 w-full flex-col items-start gap-2 rounded-3xl border bg-raised p-4 text-start hover:bg-hover disabled:opacity-60',
                                  count > 0 ? 'border-ink ring-2 ring-ink ring-inset' : 'border-line',
                                )}
                              >
                                <span className="line-clamp-2 text-lg leading-snug font-bold text-text">{pickName(product.names, locale, fallback)}</span>
                                <span className="mt-auto flex w-full flex-wrap items-end justify-between gap-2">
                                  <span className="flex flex-wrap items-baseline gap-x-2">
                                    <span className="text-xl font-bold text-text">{!product.available ? t('pos.order.soldOut') : money(product.price - offerPerUnit(product.price, offer))}</span>
                                    {product.available && offer ? (
                                      <>
                                        <span className="text-sm text-muted line-through">{money(product.price)}</span>
                                        <span data-testid={`offer-cue-${product.id}`} className="rounded-full bg-ink px-2 text-sm font-bold text-on-ink">
                                          −{formatNumber(offer.percent)}%
                                        </span>
                                      </>
                                    ) : null}
                                  </span>
                                  {count > 0 ? (
                                    <span aria-label={t('pos.calm.onOrder', { n: formatNumber(count) })} className="grid min-w-8 place-items-center rounded-full bg-ink px-2 text-base leading-8 font-bold text-on-ink">
                                      {formatNumber(count)}
                                    </span>
                                  ) : needsSheet(product) ? (
                                    <SlidersHorizontal size={18} aria-hidden className="text-muted" />
                                  ) : null}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <section aria-label={t('pos.order.tabOrder')} className={cx('flex min-w-0 flex-col gap-3 rounded-[28px] border border-line bg-raised p-5 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain [&>*]:shrink-0', tab === 'menu' && 'hidden lg:flex')}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-2xl font-bold">{t('pos.calm.ticket')}</h2>
            <span className="text-base text-muted">{t('pos.calm.items', { n: formatNumber(itemCount) })}</span>
          </div>
          {order.lines.length === 0 ? (
            <p className="py-6 text-center text-base text-muted">{t('pos.order.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {order.lines.map((line) => (
                <li key={line.id} className="flex flex-col gap-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    {splitting && !line.cancelled && !line.paid ? (
                      <input
                        type="checkbox"
                        checked={picked.includes(line.id)}
                        onChange={() => setSelected((now) => toggleLine(now, line.id))}
                        aria-label={t('pos.split.pick', { name: line.name })}
                        className="mt-1 size-7 shrink-0 accent-[var(--color-ink)]"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className={cx('text-lg font-bold', line.cancelled ? 'text-muted line-through' : 'text-text')}>
                        {line.name}
                        {line.quantity > 1 && !canChange ? <span className="ms-2 text-muted">× {formatNumber(line.quantity)}</span> : null}
                      </p>
                      {line.options.length > 0 ? <p className="text-sm text-muted">{line.options.map((o) => o.name).join(' · ')}</p> : null}
                      {line.note ? <p className="text-sm text-muted">“{line.note}”</p> : null}
                      {line.offerPerUnit > 0 ? (
                        <p data-testid="line-offer" className="text-sm text-muted">
                          {t('pos.requests.offer')}: {money(-line.offerPerUnit * line.quantity)}
                        </p>
                      ) : null}
                      {line.discount ? (
                        <p className="text-sm text-muted">
                          {t('pos.order.lineDiscount')}: {line.discount.kind === 'PERCENT' ? `${formatNumber(line.discount.value)}%` : money(line.discount.value)}
                        </p>
                      ) : null}
                      {line.cancelled ? <p className="text-sm text-danger">{t('pos.order.cancelledBecause', { reason: line.cancelReason ?? '' })}</p> : null}
                      {line.paid ? <p className="text-sm font-semibold text-success">{t('pos.split.linePaid')}</p> : null}
                      {!line.cancelled && line.sent ? <p className="text-sm text-muted">{line.ready ? t('pos.order.lineReady') : t('pos.order.lineSent')}</p> : null}
                    </div>
                    <span className={cx('shrink-0 text-lg font-bold', line.cancelled && 'text-muted line-through')}>{money(line.lineTotal)}</span>
                  </div>
                  {!line.cancelled && !line.paid && !splitting && canChange ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {line.sent ? (
                        <span className="text-base font-medium" dir="ltr">
                          × {formatNumber(line.quantity)}
                        </span>
                      ) : (
                        <Stepper
                          value={line.quantity}
                          disabled={pending}
                          label={t('pos.order.quantity')}
                          onChange={(next) => void call(() => updatePosLine({ lineId: line.id, expectedVersion: order.version, quantity: next }))}
                        />
                      )}
                      <span className="flex-1" />
                      {can.discount && !line.sent ? (
                        <button type="button" disabled={pending} onClick={() => setDialog({ line, kind: 'discount' })} className="inline-flex min-h-12 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-muted hover:bg-hover disabled:opacity-60">
                          <Percent size={20} aria-hidden />
                          {t('pos.order.discount')}
                        </button>
                      ) : null}
                      <button type="button" disabled={pending} onClick={() => setDialog({ line, kind: 'cancel' })} aria-label={t('pos.order.cancelLine')} title={t('pos.order.cancelLine')} className="grid size-12 place-items-center rounded-xl text-danger hover:bg-hover disabled:opacity-60">
                        <Trash2 size={20} aria-hidden />
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <dl className="flex flex-col gap-1 border-t border-line pt-3 text-base">
            <Row label={t('pos.calm.subtotal')} value={money(order.totals.subtotal)} />
            {order.totals.invoiceDiscount > 0 ? <Row label={t('pos.totals.discount')} value={`− ${money(order.totals.invoiceDiscount)}`} /> : null}
            {order.totals.service > 0 ? <Row label={t('pos.totals.service')} value={money(order.totals.service)} /> : null}
            {order.totals.tax > 0 ? <Row label={t('pos.totals.tax')} value={money(order.totals.tax)} /> : null}
            {order.totals.deliveryFee > 0 ? <Row label={t('pos.totals.deliveryFee')} value={money(order.totals.deliveryFee)} /> : null}
            {order.totals.rounding !== 0 ? <Row label={t('pos.totals.rounding')} value={`${order.totals.rounding > 0 ? '+' : '−'} ${money(Math.abs(order.totals.rounding))}`} /> : null}
            <div className="mt-2 flex items-baseline justify-between gap-3 rounded-2xl bg-hover px-4 py-3">
              <dt className="text-lg font-bold">{t('pos.calm.finalTotal')}</dt>
              <dd className="text-3xl font-bold tracking-tight">{money(order.totals.total)}</dd>
            </div>
            {order.parts.length > 0 ? (
              <>
                <Row label={t('pos.split.paidSoFar')} value={money(order.parts.reduce((sum, part) => sum + part.total, 0))} />
                <div className="flex items-baseline justify-between gap-3 px-4">
                  <dt className="text-base font-semibold">{t('pos.split.leftToPay')}</dt>
                  <dd className="text-2xl font-bold">{money(order.leftToPay)}</dd>
                </div>
              </>
            ) : null}
          </dl>

          {canChange ? (
            <div className="flex flex-col gap-2">
              {kitchenOn ? (
                <button type="button" className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-hover px-4 text-base font-semibold text-text hover:bg-pressed disabled:opacity-60" disabled={pending || unsent.length === 0} onClick={() => void call(() => sendPosToKitchen({ orderId: order.id, expectedVersion: order.version }), { onOk: () => { if (order.kitchen.print) void printKitchenRound(order.id); } })}>
                  {t('pos.order.send')} {unsent.length > 0 ? `(${formatNumber(unsent.length)})` : ''}
                </button>
              ) : null}
              {can.discount ? (
                <button type="button" className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-hover px-4 text-base font-semibold text-text hover:bg-pressed disabled:opacity-60" disabled={pending} onClick={() => setDialog('invoiceDiscount')}>
                  <Percent size={20} aria-hidden />
                  {t('pos.calm.invoiceDiscount')}
                </button>
              ) : null}
              {order.tableId ? (
                <button type="button" className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-hover px-4 text-base font-semibold text-text hover:bg-pressed disabled:opacity-60" disabled={pending || freeTables.length === 0} onClick={() => setDialog('move')}>
                  <ArrowRightLeft size={20} aria-hidden />
                  {t('pos.calm.moveTo')}
                </button>
              ) : null}
              {order.tableId && order.parts.length === 0 && mergeTargets.length > 0 ? (
                <button type="button" className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-hover px-4 text-base font-semibold text-text hover:bg-pressed disabled:opacity-60" disabled={pending} onClick={() => setDialog('merge')}>
                  <Merge size={20} aria-hidden />
                  {t('pos.merge.button')}
                </button>
              ) : null}
              {order.status !== 'BILL_REQUESTED' ? (
                <button type="button" className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-hover px-4 text-base font-semibold text-text hover:bg-pressed disabled:opacity-60" disabled={pending || liveLines.length === 0} onClick={() => void call(() => requestPosBill({ orderId: order.id, expectedVersion: order.version }))}>
                  <ReceiptText size={20} aria-hidden />
                  {t('pos.order.bill')}
                </button>
              ) : null}
              {kitchenOn ? (
                <a className="inline-flex min-h-12 items-center justify-center px-4 text-base text-muted underline underline-offset-2" href={`/pos/orders/${order.id}/kitchen`} target="_blank" rel="noreferrer">
                  {t('pos.order.printTicket')}
                </a>
              ) : null}
              {can.pay && stillUnpaid.length > 1 ? (
                <button
                  type="button"
                  aria-pressed={splitting}
                  className={cx('inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border px-4 text-base font-semibold disabled:opacity-60', splitting ? 'border-ink bg-ink text-on-ink' : 'border-line bg-hover text-text hover:bg-pressed')}
                  disabled={pending}
                  onClick={() => (splitting ? leaveSplit() : setSplitting(true))}
                >
                  <Users size={20} aria-hidden />
                  {splitting ? t('pos.split.cancel') : t('pos.split.start')}
                </button>
              ) : null}
              {splitting ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base text-muted">{t('pos.split.evenly')}</span>
                    {[2, 3, 4].map((guests) => (
                      <button key={guests} type="button" className="min-h-12 rounded-md border border-line-strong bg-raised px-4 text-base font-medium hover:bg-hover" onClick={() => setSelected(evenGroups(order.lines, guests)[0] ?? [])}>
                        {formatNumber(guests)}
                      </button>
                    ))}
                  </div>
                  {can.pay ? (
                    <Button variant="primary" size="lg" className="min-h-16 w-full text-xl" disabled={pending || picked.length === 0} onClick={() => setDialog('paySelected')}>
                      {t('pos.split.paySelected')} · {money(pickedTotal)}
                    </Button>
                  ) : null}
                </>
              ) : can.pay ? (
                <Button variant="primary" size="lg" className="min-h-16 w-full text-xl" disabled={pending || stillUnpaid.length === 0} onClick={() => setDialog('pay')}>
                  {t('pos.calm.payButton')}
                  {order.parts.length > 0 ? ` · ${money(order.leftToPay)}` : ''}
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <OptionsSheet product={sheet} fallback={fallback} pending={pending} onClose={() => setSheet(null)} onAdd={add} offer={sheet ? offerFor(sheet) : null} />

      <PayPanel open={dialog === 'pay'} onClose={() => setDialog('none')} orderId={order.id} version={order.version} total={order.parts.length > 0 ? order.leftToPay : order.totals.total} methods={order.paymentMethods} usd={order.usd} />
      <PayPanel open={dialog === 'paySelected'} onClose={() => setDialog('none')} orderId={order.id} version={order.version} total={pickedTotal} methods={order.paymentMethods} usd={order.usd} lineIds={picked} />

      <ConfirmDialog
        open={dialog === 'cancelOrder'}
        onOpenChange={(open) => !open && setDialog('none')}
        title={t('pos.order.cancelOrderTitle')}
        body={t('pos.order.cancelOrderBody')}
        confirmLabel={t('pos.order.cancelOrder')}
        onConfirm={async (form) => {
          const result = await call(() => cancelPosOrder({ orderId: order.id, expectedVersion: order.version, reason: reasonOf(form), approval: approvalOf(form) }), { quiet: true });
          if (result.ok) {
            router.push('/pos/tables');
            return true;
          }
          return problemOf(result.error, 'reason');
        }}
      >
        {(errors) => (
          <div className="flex flex-col gap-3">
            <Field label={t('pos.order.reason')} error={errors.reason}>
              <Input name="reason" size="lg" maxLength={300} />
            </Field>
            {approvers && liveLines.length > 0 ? <ApprovalFields approvers={approvers} errors={errors} /> : null}
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={typeof dialog === 'object' && dialog.kind === 'cancel'}
        onOpenChange={(open) => !open && setDialog('none')}
        title={t('pos.order.cancelLineTitle')}
        body={typeof dialog === 'object' ? dialog.line.name : undefined}
        confirmLabel={t('pos.order.cancelLine')}
        onConfirm={async (form) => {
          if (typeof dialog !== 'object') return true;
          const result = await call(() => cancelPosLine({ lineId: dialog.line.id, expectedVersion: order.version, reason: reasonOf(form), approval: approvalOf(form) }), { quiet: true });
          return result.ok ? true : problemOf(result.error, 'reason');
        }}
      >
        {(errors) => (
          <div className="flex flex-col gap-3">
            <Field label={t('pos.order.reason')} error={errors.reason}>
              <Input name="reason" size="lg" maxLength={300} />
            </Field>
            {approvers && typeof dialog === 'object' && dialog.line.sent ? <ApprovalFields approvers={approvers} errors={errors} /> : null}
          </div>
        )}
      </ConfirmDialog>

      <DiscountDialog
        open={dialog === 'invoiceDiscount' || (typeof dialog === 'object' && dialog.kind === 'discount')}
        title={dialog === 'invoiceDiscount' ? t('pos.order.invoiceDiscount') : t('pos.order.discount')}
        current={dialog === 'invoiceDiscount' ? order.invoiceDiscount : typeof dialog === 'object' ? dialog.line.discount : null}
        onClose={() => setDialog('none')}
        approvers={approvers}
        onSave={async (discount, form) => {
          const given = discount && { ...discount, reason: String(form.get('reason') ?? 'MANAGER_DECISION'), note: String(form.get('note') ?? '').trim() || undefined };
          const approval = approvalOf(form);
          const result = await call(
            () =>
              typeof dialog === 'object'
                ? updatePosLine({ lineId: dialog.line.id, expectedVersion: order.version, discount: given, approval })
                : setPosInvoiceDiscount({ orderId: order.id, expectedVersion: order.version, discount: given, approval }),
            { quiet: true },
          );
          return result.ok ? true : problemOf(result.error, 'value');
        }}
      />

      <ConfirmDialog
        open={dialog === 'move'}
        onOpenChange={(open) => !open && setDialog('none')}
        title={t('pos.order.moveTable')}
        confirmLabel={t('pos.order.moveTable')}
        tone="primary"
        onConfirm={async (form) => {
          const result = await call(() => movePosOrderToTable({ orderId: order.id, expectedVersion: order.version, tableId: String(form.get('tableId') ?? '') }), { quiet: true });
          return result.ok ? true : failed;
        }}
      >
        <Field label={t('pos.order.toTable')}>
          <Select name="tableId" size="lg" options={freeTables.map((table) => ({ value: table.id, label: `${formatNumber(table.number)} · ${table.areaName}` }))} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'merge'}
        onOpenChange={(open) => !open && setDialog('none')}
        title={t('pos.merge.title')}
        body={t('pos.merge.body')}
        confirmLabel={t('pos.merge.confirm')}
        tone="primary"
        onConfirm={async (form) => {
          const target = mergeTargets.find((x) => x.orderId === String(form.get('intoOrderId') ?? ''));
          if (!target) return failed;
          const result = await call(() => mergePosOrders({ fromOrderId: order.id, intoOrderId: target.orderId, fromVersion: order.version, intoVersion: target.version }), { quiet: true });
          if (!result.ok) return failed;
          router.push(`/pos/orders/${target.orderId}`);
          return true;
        }}
      >
        <Field label={t('pos.merge.into')}>
          <Select name="intoOrderId" size="lg" options={mergeTargets.map((target) => ({ value: target.orderId, label: `${formatNumber(target.number)} · ${target.areaName}` }))} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-muted">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

type Discount = { kind: 'AMOUNT' | 'PERCENT'; value: number } | null;

/** A percent or an amount off a line or the invoice; clearing the value removes the discount. */
function DiscountDialog({
  open,
  title,
  current,
  approvers,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  current: Discount;
  /** Managers who can approve a cashier's discount; null when the person needs no approval. */
  approvers: Approver[] | null;
  onClose: () => void;
  onSave: (discount: Discount, form: FormData) => Promise<true | { message?: string; fields?: Record<string, string> }>;
}) {
  const t = useT();
  return (
    <ConfirmDialog
      key={open ? 'open' : 'closed'}
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={title}
      body={t('pos.order.discountHint')}
      confirmLabel={t('common.save')}
      tone="primary"
      onConfirm={(form) => {
        const raw = String(form.get('value') ?? '').trim();
        const kind = form.get('kind') === 'AMOUNT' ? 'AMOUNT' : 'PERCENT';
        if (raw === '') return onSave(null, form);
        const value = typedAmount(raw);
        if (value === null) return Promise.resolve({ fields: { value: t('pos.order.discountDigits') } });
        return onSave({ kind, value }, form);
      }}
    >
      {(errors) => (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('pos.order.discountKind')} className="w-40">
              <Select name="kind" size="lg" defaultValue={current?.kind ?? 'PERCENT'} options={[{ value: 'PERCENT', label: t('pos.order.percent') }, { value: 'AMOUNT', label: t('pos.order.amount') }]} />
            </Field>
            <Field label={t('pos.order.discountValue')} error={errors.value} className="w-40">
              <Input name="value" size="lg" inputMode="numeric" dir="ltr" defaultValue={current ? String(current.value) : ''} />
            </Field>
          </div>
          <DiscountReasonFields errors={errors} />
          {approvers ? <ApprovalFields approvers={approvers} errors={errors} /> : null}
        </div>
      )}
    </ConfirmDialog>
  );
}
