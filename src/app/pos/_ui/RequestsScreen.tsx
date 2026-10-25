'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { acceptPosRequest, rejectPosRequest, removePosRequestLine, setPosRequestLineQuantity } from '@/app/studio/_actions/pos';
import { elapsedLabel, elapsedMinutes, formatNumber, formatStamp, type ElapsedText } from '@/lib/pos-format';
import { QR_LIMITS } from '@/server/domain/pos/customer-order-rules';
import type { RequestDetail } from '@/server/pos/customer-orders';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { useLiveRefresh, useNow } from './live';
import { useMoney } from './money';
import { usePosCall } from './use-pos-call';

const REFRESH_MS = 5_000;

function QuantityStepper({ value, label, disabled, onChange }: { value: number; label: string; disabled: boolean; onChange: (next: number) => void }) {
  const t = useT();
  const button = 'size-12 rounded-md border border-line-strong bg-raised text-xl hover:bg-hover disabled:opacity-40';
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-1">
      <button type="button" aria-label={t('pos.order.stepperMinus')} disabled={disabled || value <= 1} onClick={() => onChange(value - 1)} className={button}>
        −
      </button>
      <output className="min-w-10 text-center text-lg font-semibold" dir="ltr">
        {formatNumber(value)}
      </output>
      <button type="button" aria-label={t('pos.order.stepperPlus')} disabled={disabled || value >= QR_LIMITS.maxQuantity} onClick={() => onChange(value + 1)} className={button}>
        +
      </button>
    </div>
  );
}

/** The guests' QR orders, oldest first. The cashier trims them, then accepts (into the table's order) or rejects. */
export function RequestsScreen({ requests, readAt }: { requests: RequestDetail[]; readAt: Date }) {
  const t = useT();
  const { locale } = useLocale();
  const money = useMoney();
  const router = useRouter();
  const { call, pending } = usePosCall();
  const [rejecting, setRejecting] = useState<RequestDetail | null>(null);
  const now = useNow(new Date(readAt).getTime());
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

  if (requests.length === 0) {
    return (
      <div className="px-4 pb-8 sm:px-8">
        <EmptyState title={t('pos.requests.empty')} body={t('pos.requests.emptyHint')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-8 sm:px-8">
      <ul className="grid gap-4 lg:grid-cols-2">
        {requests.map((request) => (
          <li key={request.id} className="flex flex-col gap-3 rounded-lg border-2 border-info bg-raised p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-semibold text-text">{t('pos.requests.table', { n: formatNumber(request.tableNumber) })}</h2>
              <p className="text-sm text-muted">
                {t('pos.requests.sentAt', { time: elapsedLabel(elapsedMinutes(new Date(request.createdAt).getTime(), now), text, locale) })} ·{' '}
                <time dateTime={new Date(request.createdAt).toISOString()} dir="ltr">
                  {formatStamp(request.createdAt)}
                </time>
              </p>
            </div>

            {request.liveOrderId ? (
              <p className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-info-wash px-3 py-2 text-sm text-text">
                <span>{t('pos.requests.joinBanner')}</span>
                <Link href={`/pos/orders/${request.liveOrderId}`} className="inline-flex min-h-12 items-center font-medium underline underline-offset-2">
                  {t('pos.requests.openOrder')}
                </Link>
              </p>
            ) : null}

            {request.lines.length === 0 ? <p className="text-sm text-muted">{t('pos.requests.noLines')}</p> : null}
            <ul className="flex flex-col divide-y divide-line">
              {request.lines.map((line) => (
                <li key={line.id} className="flex flex-col gap-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-medium text-text" dir="auto">
                        {line.name}
                      </p>
                      {line.options.length > 0 ? (
                        <p className="break-words text-sm text-muted" dir="auto">
                          {line.options.map((option) => option.name).join('، ')}
                        </p>
                      ) : null}
                      {line.note ? (
                        <p className="whitespace-pre-line break-words text-sm text-text" dir="auto">
                          {line.note}
                        </p>
                      ) : null}
                      {line.promoDiscountPerUnit > 0 ? (
                        <p className="text-sm text-muted">
                          {t('pos.requests.offer')} {money(-line.promoDiscountPerUnit * line.quantity)}
                        </p>
                      ) : null}
                    </div>
                    <p className="shrink-0 font-medium text-text">{money(line.lineTotal)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <QuantityStepper
                      value={line.quantity}
                      label={t('pos.requests.quantityOf', { name: line.name })}
                      disabled={pending}
                      onChange={(quantity) => void call(() => setPosRequestLineQuantity({ lineId: line.id, quantity }))}
                    />
                    <Button variant="ghost" size="lg" className="min-h-12" disabled={pending} onClick={() => void call(() => removePosRequestLine({ lineId: line.id }))}>
                      {t('pos.requests.remove')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>

            {request.customerNote ? (
              <div className="rounded-md bg-surface px-3 py-2 text-sm">
                <p className="text-muted">{t('pos.requests.guestNote')}</p>
                <p className="whitespace-pre-line break-words text-text" dir="auto">
                  {request.customerNote}
                </p>
              </div>
            ) : null}

            <div className="flex items-baseline justify-between text-lg font-semibold text-text">
              <span>{t('pos.requests.total')}</span>
              <span>{money(request.total)}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="lg" className="min-h-12 flex-1" disabled={pending} onClick={() => setRejecting(request)}>
                {t('pos.requests.reject')}
              </Button>
              <Button
                variant="primary"
                size="lg"
                className="min-h-12 flex-1"
                disabled={pending || request.lines.length === 0}
                onClick={() =>
                  void call(() => acceptPosRequest({ requestId: request.id, ...(request.liveOrderVersion !== null ? { expectedOrderVersion: request.liveOrderVersion } : {}) }), {
                    onOk: (data) => router.push(`/pos/orders/${data.orderId}`),
                  })
                }
              >
                {t('pos.requests.accept')}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={rejecting !== null}
        onOpenChange={(open) => !open && setRejecting(null)}
        title={t('pos.requests.rejectTitle')}
        body={t('pos.requests.rejectBody')}
        confirmLabel={t('pos.requests.reject')}
        onConfirm={async (form) => {
          if (!rejecting) return true;
          const reason = String(form.get('reason') ?? '');
          const result = await call(() => rejectPosRequest({ requestId: rejecting.id, reason }), { quiet: true });
          if (result.ok) return true;
          return result.error.fields?.reason ? { fields: { reason: result.error.fields.reason } } : { message: t('pos.order.actionRefused') };
        }}
      >
        {(errors) => (
          <Field label={t('pos.requests.reason')} error={errors.reason}>
            <Input name="reason" size="lg" maxLength={200} dir="auto" />
          </Field>
        )}
      </ConfirmDialog>
    </div>
  );
}
