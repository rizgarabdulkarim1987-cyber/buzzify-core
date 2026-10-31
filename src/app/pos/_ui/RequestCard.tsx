'use client';

import { Lock } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { acceptPosRequest, addPosRequestLine, approvePosRequest, rejectPosRequest, removePosRequestLine, setPosRequestLineQuantity } from '@/app/studio/_actions/pos';
import { markBillCallSeen } from '@/app/studio/_actions/pos-captain';
import { elapsedLabel, elapsedMinutes, formatNumber, formatStamp, type ElapsedText } from '@/lib/pos-format';
import { lockedNote, requestActions } from '@/lib/pos-requests-model';
import { needsSheet } from '@/lib/pos-view';
import { QR_LIMITS } from '@/server/domain/pos/customer-order-rules';
import { canPos, type PosRole } from '@/server/domain/pos/permissions';
import type { RequestDetail, RequestLineView } from '@/server/pos/customer-orders';
import type { TillCatalog, TillProduct } from '@/server/pos/till-catalog';
import type { ActionResult } from '@/server/studio/framework/result';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Dialog } from '@/studio/ui/Dialog';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { useMoney } from './money';
import { OptionsSheet, type Chosen } from './OptionsSheet';
import { ProductPicker } from './ProductPicker';
import type { usePosCall } from './use-pos-call';

type Call = ReturnType<typeof usePosCall>['call'];

/** The words of "sent 3 minutes ago", in the person's language. */
export function useElapsedText(): ElapsedText {
  const t = useT();
  return useMemo(
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
}

export interface BillCallView {
  id: string;
  tableNumber: number;
  /** `BILL` or `WAITER`. */
  kind: string;
  createdAt: Date;
}

/**
 * The guests' calls for the bill nobody has marked seen, at the top of the captain's and the cashier's screens. Seen by one
 * person, a call leaves both screens.
 */
export function BillCalls({ calls, now, call, pending }: { calls: BillCallView[]; now: number; call: Call; pending: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const text = useElapsedText();
  if (calls.length === 0) return null;
  return (
    <section aria-labelledby="bill-calls-title" className="flex flex-col gap-2" data-testid="bill-calls">
      <h2 id="bill-calls-title" className="text-lg font-bold text-text">
        {t('pos.billCalls.title')} · <span dir="ltr">{formatNumber(calls.length)}</span>
      </h2>
      <ul className="flex flex-col divide-y divide-line">
        {calls.map((bill) => (
          <li key={bill.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2">
            <p className="min-w-0">
              <span className="block text-lg font-semibold text-text">{t(bill.kind === 'WAITER' ? 'pos.billCalls.tableWaiter' : 'pos.billCalls.table', { n: formatNumber(bill.tableNumber) })}</span>
              <span className="text-sm text-muted">{elapsedLabel(elapsedMinutes(new Date(bill.createdAt).getTime(), now), text, locale)}</span>
            </p>
            <Button variant="primary" size="lg" className="min-h-12 min-w-28" disabled={pending} onClick={() => void call(() => markBillCallSeen({ id: bill.id }))}>
              {t('pos.billCalls.seen')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

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

/** What the picker is choosing for: a new dish on the order, or the dish that takes one line's place. */
type Picking = { kind: 'add' } | { kind: 'replace'; line: RequestLineView };

interface CardProps {
  request: RequestDetail;
  role: PosRole;
  /** The till catalog to add dishes from; null hides adding and replacing. */
  catalog: TillCatalog | null;
  now: number;
  call: Call;
  /** An action is running, or the page is leaving for the order: every button waits. */
  busy: boolean;
  onReject: (request: RequestDetail) => void;
  /** Accepting opens the order page; the screen stops taking taps meanwhile. */
  onLeave: () => void;
}

/**
 * One waiting guest order: its dishes, which whoever handles it may trim, add to or swap, and the decision the person's
 * role allows. Held for the captain, the cashier's accept is replaced by the reason it is locked.
 */
export function RequestCard({ request, role, catalog, now, call, busy, onReject, onLeave }: CardProps) {
  const t = useT();
  const { locale } = useLocale();
  const money = useMoney();
  const router = useRouter();
  const text = useElapsedText();
  const can = requestActions(role, request);
  const [picking, setPicking] = useState<Picking | null>(null);
  const [sheet, setSheet] = useState<TillProduct | null>(null);
  // Whoever cannot approve undoes a captain's approval by editing: they are told before, and after it happened.
  const editSendsBack = request.captainApproved && !canPos(role, 'request.approve');

  const edited = (result: ActionResult<{ sentBack: boolean }>) => {
    if (result.ok && result.data.sentBack) toast(t('pos.requests.sentBack'));
  };
  const edit = async (action: () => Promise<ActionResult<{ requestId: string; sentBack: boolean }>>) => edited(await call(action));

  const close = () => {
    setPicking(null);
    setSheet(null);
  };

  const add = async (product: TillProduct, chosen: Chosen) => {
    const target = picking;
    const added = await call(() =>
      addPosRequestLine({
        requestId: request.id,
        productId: product.id,
        quantity: chosen.quantity,
        ...(chosen.note ? { note: chosen.note } : {}),
        variantId: chosen.variantId ?? null,
        optionIds: chosen.optionIds,
      }),
    );
    if (!added.ok) return;
    close();
    edited(added);
    // A swap is an add, then the old line goes: if the add was refused, the guest's dish stays.
    if (target?.kind === 'replace') await edit(() => removePosRequestLine({ lineId: target.line.id }));
  };

  const pick = (product: TillProduct) => {
    if (needsSheet(product)) {
      setSheet(product);
      return;
    }
    const quantity = picking?.kind === 'replace' ? picking.line.quantity : 1;
    void add(product, { variantId: product.variants[0]?.id, optionIds: [], quantity, note: '' });
  };

  const accept = () =>
    void call(() => acceptPosRequest({ requestId: request.id, ...(request.liveOrderVersion !== null ? { expectedOrderVersion: request.liveOrderVersion } : {}) }), {
      // The list stays as it is until the order page opens, so no other card slides under the finger.
      onOk: (data) => {
        onLeave();
        router.push(`/pos/orders/${data.orderId}`);
      },
      keepPage: true,
    });

  const approve = () => void call(() => approvePosRequest({ requestId: request.id }), { onOk: () => toast.success(t('pos.requests.approvedToast')) });

  return (
    <li className="flex flex-col gap-3 rounded-lg border-2 border-info bg-raised p-4" data-testid="request-card" data-awaiting={request.awaitingCaptain || undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold text-text">{t('pos.requests.table', { n: formatNumber(request.tableNumber) })}</h2>
        <p className="text-sm text-muted">
          {t('pos.requests.sentAt', { time: elapsedLabel(elapsedMinutes(new Date(request.createdAt).getTime(), now), text, locale) })} ·{' '}
          <time dateTime={new Date(request.createdAt).toISOString()} dir="ltr">
            {formatStamp(request.createdAt)}
          </time>
        </p>
      </div>

      {request.awaitingCaptain ? (
        <p className="inline-flex w-fit items-center gap-2 rounded-full bg-ink px-3 text-base leading-8 font-semibold text-on-ink">
          <Lock size={16} aria-hidden />
          {t('pos.requests.awaitingCaptain')}
        </p>
      ) : request.captainApproved ? (
        <div className="flex flex-col gap-1">
          <p className="w-fit rounded-full border border-line-strong px-3 text-base leading-8 font-semibold text-text">{t('pos.requests.captainApproved')}</p>
          {editSendsBack && can.edit ? <p className="text-sm text-muted">{t('pos.requests.editSendsBack')}</p> : null}
        </div>
      ) : null}

      {request.liveOrderId ? (
        <p className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-info-wash px-3 py-2 text-sm text-text">
          <span>{t('pos.requests.joinBanner')}</span>
          {canPos(role, 'order.handle') ? (
            <Link href={`/pos/orders/${request.liveOrderId}`} className="inline-flex min-h-12 items-center font-medium underline underline-offset-2">
              {t('pos.requests.openOrder')}
            </Link>
          ) : null}
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
                    {line.options.map((option) => option.name).join(locale === 'en' ? ', ' : '، ')}
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
            {can.edit ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <QuantityStepper
                  value={line.quantity}
                  label={t('pos.requests.quantityOf', { name: line.name })}
                  disabled={busy}
                  onChange={(quantity) => void edit(() => setPosRequestLineQuantity({ lineId: line.id, quantity }))}
                />
                <div className="flex gap-1">
                  {catalog ? (
                    <Button variant="ghost" size="lg" className="min-h-12" disabled={busy} onClick={() => setPicking({ kind: 'replace', line })}>
                      {t('pos.requests.replace')}
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="lg" className="min-h-12" disabled={busy} onClick={() => void edit(() => removePosRequestLine({ lineId: line.id }))}>
                    {t('pos.requests.remove')}
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {can.edit && catalog ? (
        <Button variant="secondary" size="lg" className="min-h-12 w-full" disabled={busy || request.lines.length >= QR_LIMITS.maxLines} onClick={() => setPicking({ kind: 'add' })}>
          {t('pos.requests.add')}
        </Button>
      ) : null}

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

      <div className="flex flex-wrap gap-2">
        {can.reject ? (
          <Button variant="secondary" size="lg" className="min-h-12 flex-1" disabled={busy} onClick={() => onReject(request)}>
            {t('pos.requests.reject')}
          </Button>
        ) : null}
        {can.approve ? (
          <Button variant="primary" size="lg" className="min-h-12 flex-1" disabled={busy || request.lines.length === 0} onClick={approve}>
            {t('pos.requests.approve')}
          </Button>
        ) : can.accept ? (
          <Button variant="primary" size="lg" className="min-h-12 flex-1" disabled={busy || request.lines.length === 0} onClick={accept}>
            {t('pos.requests.accept')}
          </Button>
        ) : null}
      </div>
      {/* Nobody here can move it on: say who it waits for. */}
      {!can.approve && !can.accept ? (
        <p className="flex items-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-2 text-base text-text" data-testid="request-locked">
          <Lock size={18} aria-hidden className="shrink-0" />
          {t(lockedNote(request))}
        </p>
      ) : null}

      {catalog ? (
        <>
          <Dialog
            open={picking !== null && sheet === null}
            onOpenChange={(open) => !open && close()}
            title={picking?.kind === 'replace' ? t('pos.requests.replaceTitle', { name: picking.line.name }) : t('pos.requests.addTitle', { n: formatNumber(request.tableNumber) })}
            width="md"
          >
            <ProductPicker catalog={catalog} disabled={busy} onPick={pick} />
          </Dialog>
          <OptionsSheet
            product={sheet}
            fallback={catalog.defaultLocale}
            pending={busy}
            onClose={close}
            onAdd={(product, chosen) => void add(product, chosen)}
            initialQuantity={picking?.kind === 'replace' ? picking.line.quantity : 1}
          />
        </>
      ) : null}
    </li>
  );
}

/** Rejecting a guest order, with a reason the guest sees. */
export function RejectDialog({ request, onClose, call }: { request: RequestDetail | null; onClose: () => void; call: Call }) {
  const t = useT();
  return (
    <ConfirmDialog
      open={request !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('pos.requests.rejectTitle')}
      body={t('pos.requests.rejectBody')}
      confirmLabel={t('pos.requests.reject')}
      onConfirm={async (form) => {
        if (!request) return true;
        const reason = String(form.get('reason') ?? '');
        const result = await call(() => rejectPosRequest({ requestId: request.id, reason }), { quiet: true });
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
  );
}

