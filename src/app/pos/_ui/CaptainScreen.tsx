'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { placeCaptainOrder } from '@/app/studio/_actions/pos-captain';
import { formatNumber } from '@/lib/pos-format';
import { amountDigits, needsSheet, pickName } from '@/lib/pos-view';
import type { Locale } from '@/lib/locale';
import { QR_LIMITS } from '@/server/domain/pos/customer-order-rules';
import type { PosRole } from '@/server/domain/pos/permissions';
import type { RequestDetail } from '@/server/pos/customer-orders';
import type { TillCatalog, TillProduct } from '@/server/pos/till-catalog';
import { useLocale, useT } from '@/studio/i18n';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Textarea } from '@/studio/ui/Textarea';
import { useLiveRefresh, useNow } from './live';
import { OptionsSheet, Stepper, type Chosen } from './OptionsSheet';
import { ProductPicker } from './ProductPicker';
import { BillCalls, RejectDialog, RequestCard, type BillCallView } from './RequestCard';
import { usePosCall } from './use-pos-call';

const REFRESH_MS = 5_000;

interface DraftLine extends Chosen {
  key: string;
  product: TillProduct;
}

/** The names of a dish's chosen size and options, for a line of the order being taken. */
function choiceLabel(product: TillProduct, chosen: Pick<Chosen, 'variantId' | 'optionIds'>, locale: Locale, fallback: Locale): string {
  const parts: string[] = [];
  if (product.variants.length > 1) {
    const variant = product.variants.find((v) => v.id === chosen.variantId);
    if (variant) parts.push(pickName(variant.names, locale, fallback));
  }
  for (const group of product.groups) for (const option of group.options) if (chosen.optionIds.includes(option.id)) parts.push(pickName(option.names, locale, fallback));
  return parts.join(locale === 'en' ? ', ' : '، ');
}

const sameChoice = (line: DraftLine, product: TillProduct, chosen: Chosen) =>
  line.product.id === product.id && line.variantId === chosen.variantId && line.note === chosen.note && line.optionIds.length === chosen.optionIds.length && line.optionIds.every((id) => chosen.optionIds.includes(id));

/**
 * The captain's screen: the guests' calls for the bill, the guest orders held for their approval, and an order taken by
 * mouth for a table. On a phone the approvals and the new order are two tabs; from lg up they sit side by side.
 */
export function CaptainScreen({
  requests,
  billCalls,
  catalog,
  role,
  qrOrdering,
  readAt,
}: {
  requests: RequestDetail[];
  billCalls: BillCallView[];
  catalog: TillCatalog | null;
  role: PosRole;
  qrOrdering: boolean;
  readAt: Date;
}) {
  const t = useT();
  const { call, pending } = usePosCall();
  const [rejecting, setRejecting] = useState<RequestDetail | null>(null);
  const [leaving, setLeaving] = useState(false);
  const now = Math.max(useNow(new Date(readAt).getTime()), new Date(readAt).getTime());
  useLiveRefresh(REFRESH_MS);
  const busy = pending || leaving;
  const awaiting = requests.filter((request) => request.awaitingCaptain);
  const [tab, setTab] = useState<'approvals' | 'order'>(() => (awaiting.length > 0 ? 'approvals' : 'order'));

  return (
    <div className="flex flex-col gap-4 px-4 pb-8 sm:px-8">
      <BillCalls calls={billCalls} now={now} call={call} pending={busy} />

      <div role="tablist" className="flex gap-1 lg:hidden">
        {(['approvals', 'order'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={`captain-${key}`}
            onClick={() => setTab(key)}
            className={cx('min-h-12 flex-1 rounded-md border px-2 text-base font-medium', tab === key ? 'border-ink bg-ink text-on-ink' : 'border-line-strong text-text')}
          >
            {key === 'approvals' ? `${t('pos.captain.awaiting')} (${formatNumber(awaiting.length)})` : t('pos.captain.newOrder')}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <section id="captain-approvals" aria-labelledby="captain-approvals-title" className={cx('flex min-w-0 flex-col gap-3', tab !== 'approvals' && 'hidden lg:flex')}>
          <h2 id="captain-approvals-title" className="text-xl font-bold text-text">
            {t('pos.captain.awaiting')}
          </h2>
          {awaiting.length === 0 ? (
            <EmptyState title={t('pos.captain.awaitingEmpty')} body={t('pos.captain.awaitingEmptyHint')} />
          ) : (
            <ul className="flex flex-col gap-4">
              {awaiting.map((request) => (
                <RequestCard key={request.id} request={request} role={role} catalog={catalog} now={now} call={call} busy={busy} onReject={setRejecting} onLeave={() => setLeaving(true)} />
              ))}
            </ul>
          )}
        </section>

        <section id="captain-order" aria-labelledby="captain-order-title" className={cx('flex min-w-0 flex-col gap-3', tab !== 'order' && 'hidden lg:flex')}>
          <h2 id="captain-order-title" className="text-xl font-bold text-text">
            {t('pos.captain.newOrder')}
          </h2>
          {!qrOrdering ? <Alert>{t('pos.captain.qrOff')}</Alert> : !catalog ? <Alert>{t('pos.order.noCatalog')}</Alert> : <NewOrder catalog={catalog} />}
        </section>
      </div>

      <RejectDialog request={rejecting} onClose={() => setRejecting(null)} call={call} />
    </div>
  );
}

/** An order taken by mouth: the table, the dishes and a note. It reaches the cashier already approved. */
function NewOrder({ catalog }: { catalog: TillCatalog }) {
  const t = useT();
  const { locale } = useLocale();
  const { call, pending } = usePosCall();
  const fallback = catalog.defaultLocale;
  const [table, setTable] = useState('');
  const [tableError, setTableError] = useState<string | undefined>();
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [note, setNote] = useState('');
  const [sheet, setSheet] = useState<TillProduct | null>(null);
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);

  const add = (product: TillProduct, chosen: Chosen) => {
    setSheet(null);
    setLines((current) => {
      const same = current.find((line) => sameChoice(line, product, chosen));
      if (same) return current.map((line) => (line === same ? { ...line, quantity: Math.min(QR_LIMITS.maxQuantity, line.quantity + chosen.quantity) } : line));
      if (current.length >= QR_LIMITS.maxLines) return current;
      return [...current, { ...chosen, product, key: `${product.id}-${Date.now()}-${current.length}` }];
    });
  };

  const pick = (product: TillProduct) => {
    if (needsSheet(product)) setSheet(product);
    else add(product, { variantId: product.variants[0]?.id, optionIds: [], quantity: 1, note: '' });
  };

  const send = () => {
    const number = Number(table);
    if (!table || !Number.isInteger(number) || number < 1) {
      setTableError(t('pos.captain.tableRequired'));
      document.getElementById('captain-table')?.focus();
      return;
    }
    setTableError(undefined);
    void call(
      () =>
        placeCaptainOrder({
          tableNumber: number,
          lines: lines.map((line) => ({
            productId: line.product.id,
            quantity: line.quantity,
            ...(line.note ? { note: line.note } : {}),
            variantId: line.variantId ?? null,
            optionIds: line.optionIds,
          })),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      {
        onOk: () => {
          toast.success(t('pos.captain.sent', { n: formatNumber(number) }));
          setLines([]);
          setNote('');
          setTable('');
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label={t('pos.captain.tableNumber')} error={tableError}>
        <Input
          id="captain-table"
          size="lg"
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          value={table}
          onChange={(event) => setTable(amountDigits(event.target.value))}
          className="max-w-40 text-center text-xl font-bold"
        />
      </Field>

      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-muted">{t('pos.captain.pick')}</h3>
        <ProductPicker catalog={catalog} disabled={pending} onPick={pick} />
      </div>

      <div className="flex flex-col gap-2 rounded-lg border-2 border-line-strong bg-raised p-3" data-testid="captain-ticket">
        <h3 className="text-lg font-bold text-text">
          {t('pos.captain.items')} · <span dir="ltr">{formatNumber(count)}</span>
        </h3>
        {lines.length === 0 ? (
          <p className="text-base text-muted">{t('pos.captain.noItems')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {lines.map((line) => {
              const label = choiceLabel(line.product, line, locale, fallback);
              const name = pickName(line.product.names, locale, fallback);
              return (
                <li key={line.key} className="flex flex-col gap-2 py-2">
                  <div className="min-w-0">
                    <p className="font-medium break-words text-text">{name}</p>
                    {label ? <p className="text-sm break-words text-muted">{label}</p> : null}
                    {line.note ? (
                      <p className="text-sm whitespace-pre-line break-words text-text" dir="auto">
                        {line.note}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Stepper
                      value={line.quantity}
                      label={t('pos.requests.quantityOf', { name })}
                      disabled={pending}
                      onChange={(quantity) => setLines((current) => current.map((other) => (other.key === line.key ? { ...other, quantity: Math.min(QR_LIMITS.maxQuantity, quantity) } : other)))}
                    />
                    <Button variant="ghost" size="lg" className="min-h-12" disabled={pending} onClick={() => setLines((current) => current.filter((other) => other.key !== line.key))}>
                      {t('pos.requests.remove')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <label className="flex flex-col gap-1.5 text-base font-medium text-text">
          {t('pos.captain.note')}
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={QR_LIMITS.maxNote} rows={2} dir="auto" />
        </label>
      </div>

      {/* Kept in reach at the foot of a phone screen while the dishes are picked. */}
      <div className="sticky bottom-0 bg-bg py-3">
        <Button variant="primary" size="lg" className="min-h-14 w-full text-lg" disabled={pending || lines.length === 0} onClick={send} data-testid="captain-send">
          {t('pos.captain.send')} · {formatNumber(count)}
        </Button>
      </div>

      <OptionsSheet product={sheet} fallback={fallback} pending={pending} onClose={() => setSheet(null)} onAdd={add} />
    </div>
  );
}
