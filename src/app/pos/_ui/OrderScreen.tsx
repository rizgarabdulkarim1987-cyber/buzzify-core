'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  addPosLine,
  cancelPosLine,
  cancelPosOrder,
  movePosOrderToTable,
  requestPosBill,
  sendPosToKitchen,
  setPosInvoiceDiscount,
  updatePosLine,
} from '@/app/studio/_actions/pos';
import { formatNumber } from '@/lib/pos-format';
import { needsSheet, pickName, visibleProducts } from '@/lib/pos-view';
import type { OrderView, OrderLineView } from '@/server/pos/orders';
import type { TillCatalog, TillProduct } from '@/server/pos/till-catalog';
import { useLocale, useT } from '@/studio/i18n';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { useMoney } from './money';
import { OptionsSheet, Stepper, type Chosen } from './OptionsSheet';
import { PayPanel } from './PayPanel';
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

type Dialogs = 'none' | 'pay' | 'invoiceDiscount' | 'cancelOrder' | 'move' | { line: OrderLineView; kind: 'cancel' | 'discount' };

export function OrderScreen({ order, catalog, can, freeTables }: { order: OrderView; catalog: TillCatalog | null; can: OrderCan; freeTables: FreeTable[] }) {
  const t = useT();
  const { locale } = useLocale();
  const money = useMoney();
  const router = useRouter();
  const { call, pending } = usePosCall();
  const [tab, setTab] = useState<'menu' | 'order'>('menu');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sheet, setSheet] = useState<TillProduct | null>(null);
  const [dialog, setDialog] = useState<Dialogs>('none');

  const fallback = catalog?.defaultLocale ?? 'en';
  const products = useMemo(() => (catalog ? visibleProducts(catalog, categoryId, search) : []), [catalog, categoryId, search]);
  const liveLines = order.lines.filter((line) => !line.cancelled);
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

  const reasonOf = (form: FormData) => String(form.get('reason') ?? '').trim();
  const failed = { message: t('pos.order.actionRefused') };

  return (
    <div className="flex flex-col gap-3 px-4 pb-24 sm:px-8 lg:pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-text">
          {order.tableNumber !== null
            ? t('pos.order.heading', { n: formatNumber(order.number), table: formatNumber(order.tableNumber) })
            : t('pos.order.headingNoTable', { n: formatNumber(order.number) })}
          {order.areaName ? <span className="ms-2 text-base font-normal text-muted">{order.areaName}</span> : null}
        </h1>
        <span className="text-sm text-muted">{t(`pos.order.status.${order.status}`)}</span>
      </div>

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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section aria-label={t('pos.order.tabMenu')} className={cx('flex min-w-0 flex-col gap-3', tab === 'order' && 'hidden lg:flex')}>
          {!catalog ? (
            <Alert>{t('pos.order.noCatalog')}</Alert>
          ) : (
            <>
              <Input
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
                      'min-h-11 shrink-0 rounded-md border px-4 text-base whitespace-nowrap',
                      categoryId === category.id ? 'border-ink bg-ink text-on-ink' : 'border-line-strong bg-raised text-text hover:bg-hover',
                    )}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
              {products.length === 0 ? (
                <EmptyState title={t('pos.order.noProducts')} />
              ) : (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
                  {products.map((product) => (
                    <li key={product.id}>
                      <button
                        type="button"
                        disabled={!canChange || pending || !product.available}
                        onClick={() => tapProduct(product)}
                        className="flex min-h-24 w-full flex-col items-start justify-between gap-1 rounded-lg border border-line-strong bg-raised p-3 text-start hover:bg-hover disabled:opacity-50"
                      >
                        <span className="text-base font-medium text-text">{pickName(product.names, locale, fallback)}</span>
                        <span className="text-sm text-muted">{product.available ? money(product.price) : t('pos.order.soldOut')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <section aria-label={t('pos.order.tabOrder')} className={cx('flex min-w-0 flex-col gap-3 rounded-lg border border-line p-3', tab === 'menu' && 'hidden lg:flex')}>
          {order.lines.length === 0 ? (
            <p className="py-6 text-center text-base text-muted">{t('pos.order.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {order.lines.map((line) => (
                <li key={line.id} className="flex flex-col gap-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={cx('text-base font-medium', line.cancelled ? 'text-muted line-through' : 'text-text')}>
                        {line.name}
                        {line.quantity > 1 && !canChange ? <span className="ms-2 text-muted">× {formatNumber(line.quantity)}</span> : null}
                      </p>
                      {line.options.length > 0 ? <p className="text-sm text-muted">{line.options.map((o) => o.name).join(' · ')}</p> : null}
                      {line.note ? <p className="text-sm text-muted">“{line.note}”</p> : null}
                      {line.discount ? (
                        <p className="text-sm text-muted">
                          {t('pos.order.lineDiscount')}: {line.discount.kind === 'PERCENT' ? `${formatNumber(line.discount.value)}%` : money(line.discount.value)}
                        </p>
                      ) : null}
                      {line.cancelled ? <p className="text-sm text-danger">{t('pos.order.cancelledBecause', { reason: line.cancelReason ?? '' })}</p> : null}
                      {!line.cancelled && line.sent ? <p className="text-sm text-muted">{line.ready ? t('pos.order.lineReady') : t('pos.order.lineSent')}</p> : null}
                    </div>
                    <span className={cx('shrink-0 text-base font-semibold', line.cancelled && 'text-muted line-through')}>{money(line.lineTotal)}</span>
                  </div>
                  {!line.cancelled && canChange ? (
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
                        <Button variant="ghost" size="lg" disabled={pending} onClick={() => setDialog({ line, kind: 'discount' })}>
                          {t('pos.order.discount')}
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="lg" disabled={pending} onClick={() => setDialog({ line, kind: 'cancel' })}>
                        {t('pos.order.cancelLine')}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <dl className="flex flex-col gap-1 border-t border-line pt-3 text-base">
            <Row label={t('pos.totals.subtotal')} value={money(order.totals.subtotal)} />
            {order.totals.invoiceDiscount > 0 ? <Row label={t('pos.totals.discount')} value={`− ${money(order.totals.invoiceDiscount)}`} /> : null}
            {order.totals.service > 0 ? <Row label={t('pos.totals.service')} value={money(order.totals.service)} /> : null}
            {order.totals.tax > 0 ? <Row label={t('pos.totals.tax')} value={money(order.totals.tax)} /> : null}
            <div className="flex items-baseline justify-between gap-3 text-xl font-semibold">
              <dt>{t('pos.totals.total')}</dt>
              <dd>{money(order.totals.total)}</dd>
            </div>
          </dl>

          {canChange ? (
            <div className="flex flex-wrap gap-2">
              {kitchenOn ? (
                <Button
                  variant="secondary"
                  size="lg"
                  className="min-h-12 flex-1"
                  disabled={pending || unsent.length === 0}
                  onClick={() => void call(() => sendPosToKitchen({ orderId: order.id, expectedVersion: order.version }))}
                >
                  {t('pos.order.send')} {unsent.length > 0 ? `(${formatNumber(unsent.length)})` : ''}
                </Button>
              ) : null}
              {order.status !== 'BILL_REQUESTED' ? (
                <Button variant="secondary" size="lg" className="min-h-12 flex-1" disabled={pending || liveLines.length === 0} onClick={() => void call(() => requestPosBill({ orderId: order.id, expectedVersion: order.version }))}>
                  {t('pos.order.bill')}
                </Button>
              ) : null}
              {can.pay ? (
                <Button size="lg" className="min-h-12 flex-1" disabled={pending || liveLines.length === 0} onClick={() => setDialog('pay')}>
                  {t('pos.order.pay')}
                </Button>
              ) : null}
              <div className="flex w-full flex-wrap gap-2">
                {can.discount ? (
                  <Button variant="ghost" size="lg" disabled={pending} onClick={() => setDialog('invoiceDiscount')}>
                    {t('pos.order.invoiceDiscount')}
                  </Button>
                ) : null}
                {order.tableId ? (
                  <Button variant="ghost" size="lg" disabled={pending || freeTables.length === 0} onClick={() => setDialog('move')}>
                    {t('pos.order.moveTable')}
                  </Button>
                ) : null}
                {can.cancel ? (
                  <Button variant="ghost" size="lg" disabled={pending} onClick={() => setDialog('cancelOrder')}>
                    {t('pos.order.cancelOrder')}
                  </Button>
                ) : null}
                {kitchenOn ? (
                  <a className="inline-flex min-h-12 items-center px-4 text-base text-muted underline underline-offset-2" href={`/pos/orders/${order.id}/kitchen`} target="_blank" rel="noreferrer">
                    {t('pos.order.printTicket')}
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <OptionsSheet product={sheet} fallback={fallback} pending={pending} onClose={() => setSheet(null)} onAdd={add} />

      <PayPanel open={dialog === 'pay'} onClose={() => setDialog('none')} orderId={order.id} version={order.version} total={order.totals.total} />

      <ConfirmDialog
        open={dialog === 'cancelOrder'}
        onOpenChange={(open) => !open && setDialog('none')}
        title={t('pos.order.cancelOrderTitle')}
        body={t('pos.order.cancelOrderBody')}
        confirmLabel={t('pos.order.cancelOrder')}
        onConfirm={async (form) => {
          const result = await call(() => cancelPosOrder({ orderId: order.id, expectedVersion: order.version, reason: reasonOf(form) }), { quiet: true });
          if (result.ok) {
            router.push('/pos/tables');
            return true;
          }
          return result.error.fields?.reason ? { fields: { reason: result.error.fields.reason } } : failed;
        }}
      >
        {(errors) => (
          <Field label={t('pos.order.reason')} error={errors.reason}>
            <Input name="reason" size="lg" maxLength={300} />
          </Field>
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
          const result = await call(() => cancelPosLine({ lineId: dialog.line.id, expectedVersion: order.version, reason: reasonOf(form) }), { quiet: true });
          return result.ok ? true : result.error.fields?.reason ? { fields: { reason: result.error.fields.reason } } : failed;
        }}
      >
        {(errors) => (
          <Field label={t('pos.order.reason')} error={errors.reason}>
            <Input name="reason" size="lg" maxLength={300} />
          </Field>
        )}
      </ConfirmDialog>

      <DiscountDialog
        open={dialog === 'invoiceDiscount' || (typeof dialog === 'object' && dialog.kind === 'discount')}
        title={dialog === 'invoiceDiscount' ? t('pos.order.invoiceDiscount') : t('pos.order.discount')}
        current={dialog === 'invoiceDiscount' ? order.invoiceDiscount : typeof dialog === 'object' ? dialog.line.discount : null}
        onClose={() => setDialog('none')}
        onSave={async (discount) => {
          const result = await call(
            () =>
              typeof dialog === 'object'
                ? updatePosLine({ lineId: dialog.line.id, expectedVersion: order.version, discount })
                : setPosInvoiceDiscount({ orderId: order.id, expectedVersion: order.version, discount }),
            { quiet: true },
          );
          return result.ok ? true : result.error.fields?.value ? { fields: { value: result.error.fields.value } } : failed;
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
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  current: Discount;
  onClose: () => void;
  onSave: (discount: Discount) => Promise<true | { message?: string; fields?: Record<string, string> }>;
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
        if (raw === '') return onSave(null);
        if (!/^\d+$/.test(raw)) return Promise.resolve({ fields: { value: t('pos.order.discountDigits') } });
        return onSave({ kind, value: Number(raw) });
      }}
    >
      {(errors) => (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('pos.order.discountKind')} className="w-40">
            <Select name="kind" size="lg" defaultValue={current?.kind ?? 'PERCENT'} options={[{ value: 'PERCENT', label: t('pos.order.percent') }, { value: 'AMOUNT', label: t('pos.order.amount') }]} />
          </Field>
          <Field label={t('pos.order.discountValue')} error={errors.value} className="w-40">
            <Input name="value" size="lg" inputMode="numeric" dir="ltr" defaultValue={current ? String(current.value) : ''} />
          </Field>
        </div>
      )}
    </ConfirmDialog>
  );
}
