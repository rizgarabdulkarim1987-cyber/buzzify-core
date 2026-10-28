'use client';

import { Ban, CircleAlert, CircleCheck, Hourglass, Lock, Printer, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { cancelSale, returnPreview } from '@/app/pharmacy/_actions/returns';
import type { StudioFailure } from '@/server/studio/framework/result';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Dialog } from '@/studio/ui/Dialog';
import { Field } from '@/studio/ui/Field';
import { Money } from './money-parts';
import { PrintDialog } from './PrintDialog';
import { WriteBlocked, type Writable } from './WriteBlocked';
import { phMessage } from './ph-failure';
import { FIELD, FieldInput, FieldSelect, Note, TOUCH_BTN, TOUCH_PRIMARY } from './sell-parts';
import { keyFor, outcomeUnknown, type KeyedAttempt } from './sell-logic';
import { refundMethodChoices, type RefundMethod } from './shifts-logic';

/** A return or cancel refusal in words, and whether the way forward is to open a shift. */
export function useReturnFailure() {
  const t = useT();
  const { locale } = useLocale();
  return (error: StudioFailure): { text: string; noShift: boolean } => ({
    text: outcomeUnknown(error) ? t('pharmacy.returns.unknown') : phMessage(t, locale, error, 'pharmacy.returns'),
    noShift: error.fields?.phCode === 'NO_OPEN_SHIFT' || error.fields?.phCode === 'SHIFT_CURRENCY',
  });
}

export interface SaleActionsProps {
  sale: { id: string; number: string | null; status: string };
  /** The person holds return.approve here, in a pharmacy that is open for writing. */
  mayReturn: boolean;
  /** The person's role never returns (a cashier): say so instead of showing nothing. */
  roleCannotReturn: boolean;
  returnable: boolean;
  returnWindow: { withinWindow: boolean; days: number; mayOverride: boolean } | null;
  /** Why return and cancel are not offered to a person who holds return.approve: a read-only pharmacy or support access. */
  writeBlocked: Writable | null;
  /** Every line with something left, whole: what a cancel gives back (for the refund shown before confirming). */
  cancelLines: { saleLineId: string; baseQty: number }[];
  currency: 'IQD' | 'USD';
  paid: RefundMethod[];
  defaultMethod: RefundMethod;
}

/**
 * What can be done with one sale: print or reprint its receipt, return part of it (the return screen), cancel what is
 * left. A cashier sees why they cannot return, in words with an icon; the server refuses them anyway.
 */
export function SaleActions({ sale, mayReturn, roleCannotReturn, returnable, returnWindow, writeBlocked, cancelLines, currency, paid, defaultMethod }: SaleActionsProps) {
  const t = useT();
  const [printing, setPrinting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const blocked = returnWindow !== null && !returnWindow.withinWindow && !returnWindow.mayOverride;
  return (
    <div className="flex flex-col gap-3" data-testid="sale-actions">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={TOUCH_BTN} data-testid="sale-print" onClick={() => setPrinting(true)} disabled={sale.status === 'HELD' || sale.status === 'HOLD_EXPIRED'}>
          <Printer aria-hidden className="size-4" />
          {t('pharmacy.sales.receipt.open')}
        </button>
        {mayReturn && returnable && !blocked && (
          <>
            <Link href={`/pharmacy/returns/new?sale=${encodeURIComponent(sale.id)}`} className={TOUCH_BTN} data-testid="sale-return">
              <Undo2 aria-hidden className="size-4" />
              {t('pharmacy.sales.return')}
            </Link>
            <button type="button" className={TOUCH_BTN} data-testid="sale-cancel" onClick={() => setCancelling(true)}>
              <Ban aria-hidden className="size-4" />
              {t('pharmacy.sales.cancel')}
            </button>
          </>
        )}
      </div>
      {roleCannotReturn && (
        <Note icon={<Lock aria-hidden />} testId="return-hidden">
          {t('pharmacy.returns.roleCannot')}
        </Note>
      )}
      {writeBlocked && <WriteBlocked writable={writeBlocked} scope="sales" />}
      {mayReturn && blocked && returnWindow && (
        <Note icon={<Lock aria-hidden />} tone="danger" role="status" testId="return-window">
          {t('pharmacy.returns.fail.RETURN_WINDOW_PASSED', { days: returnWindow.days })}
        </Note>
      )}
      {mayReturn && !returnable && sale.status !== 'HELD' && (
        <Note icon={<CircleCheck aria-hidden />} role="status" testId="nothing-to-return">
          {t('pharmacy.returns.fail.NOTHING_TO_RETURN')}
        </Note>
      )}
      <PrintDialog target={printing ? { kind: 'sale', id: sale.id, number: sale.number } : null} onClose={() => setPrinting(false)} />
      <CancelDialog open={cancelling} onClose={() => setCancelling(false)} sale={sale} lines={cancelLines} currency={currency} paid={paid} defaultMethod={defaultMethod} />
    </div>
  );
}

/** Cancel what is left of a sale: a full return, with a reason, by a method the sale was paid with. Asks before it acts. */
function CancelDialog({ open, onClose, sale, lines, currency, paid, defaultMethod }: { open: boolean; onClose: () => void; sale: { id: string; number: string | null }; lines: { saleLineId: string; baseQty: number }[]; currency: 'IQD' | 'USD'; paid: RefundMethod[]; defaultMethod: RefundMethod }) {
  const t = useT();
  const router = useRouter();
  const failure = useReturnFailure();
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<RefundMethod>(defaultMethod);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; noShift: boolean } | null>(null);
  const attempt = useRef<KeyedAttempt | null>(null);
  // The server's refund for everything that is left, asked each time the dialog opens (the figure may have moved).
  const [refund, setRefund] = useState<{ state: 'loading' } | { state: 'none' } | { state: 'ok'; minor: string }>({ state: 'loading' });
  const wire = JSON.stringify(lines);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- each opening asks the server again; the old figure is not shown meanwhile
    setRefund({ state: 'loading' });
    void settle(() => returnPreview({ saleId: sale.id, lines: JSON.parse(wire) as { saleLineId: string; baseQty: number }[] })).then((result) => {
      if (cancelled) return;
      setRefund(result.ok ? { state: 'ok', minor: (result.data as { refundMinor: string }).refundMinor } : { state: 'none' });
    });
    return () => {
      cancelled = true;
    };
  }, [open, sale.id, wire]);
  const choices = refundMethodChoices(paid, defaultMethod);
  const ready = reason.trim().length >= 3;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    attempt.current = keyFor(attempt.current, JSON.stringify([sale.id, reason.trim(), method]), 'cancel');
    const clientKey = attempt.current.key;
    const result = await settle(() => cancelSale({ saleId: sale.id, reason: reason.trim(), refundMethod: method, clientKey }));
    setBusy(false);
    if (!result.ok) {
      if (!outcomeUnknown(result.error)) attempt.current = null;
      setProblem(failure(result.error));
      return;
    }
    attempt.current = null;
    onClose();
    router.refresh();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !busy && onClose()}
      width="md"
      title={t('pharmacy.sales.cancel.title')}
      description={t('pharmacy.sales.cancel.body')}
      footer={
        <>
          <button type="button" className={TOUCH_BTN} onClick={onClose} disabled={busy}>
            {t('pharmacy.sales.cancel.keep')}
          </button>
          <button type="submit" form="cancel-form" className={TOUCH_PRIMARY} data-testid="cancel-confirm" disabled={!ready || busy}>
            {busy ? <Hourglass aria-hidden className="size-4" /> : <Ban aria-hidden className="size-4" />}
            {busy ? t('pharmacy.sell.pay.saving') : t('pharmacy.sales.cancel.confirm')}
          </button>
        </>
      }
    >
      <form id="cancel-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <p className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2.5 text-md font-semibold text-text" data-testid="cancel-refund" role="status">
          {refund.state === 'loading' ? <Hourglass aria-hidden className="size-4 shrink-0" /> : refund.state === 'none' ? <CircleAlert aria-hidden className="size-4 shrink-0" /> : <CircleCheck aria-hidden className="size-4 shrink-0" />}
          <span className="min-w-0">
            {refund.state === 'loading' && t('pharmacy.sales.cancel.refundLoading')}
            {refund.state === 'none' && t('pharmacy.sales.cancel.refundNone')}
            {refund.state === 'ok' && `${t('pharmacy.sales.cancel.refund')} `}
            {refund.state === 'ok' && <Money minor={refund.minor} currency={currency} />}
          </span>
        </p>
        <Field label={t('pharmacy.returns.reason')} hint={t('pharmacy.returns.reasonHint')}>
          <FieldInput className={FIELD} dir="auto" autoComplete="off" autoFocus maxLength={300} value={reason} data-testid="cancel-reason" onChange={(event) => setReason(event.target.value)} />
        </Field>
        <Field label={t('pharmacy.returns.method')}>
          <FieldSelect className={`${FIELD} pe-8`} value={method} data-testid="cancel-method" onChange={(event) => setMethod(event.target.value as RefundMethod)}>
            {choices.map((m) => (
              <option key={m} value={m}>
                {t(`pharmacy.method.${m}`)}
              </option>
            ))}
          </FieldSelect>
        </Field>
        {problem && (
          <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="cancel-problem">
            <span>
              {problem.text}
              {problem.noShift && (
                <>
                  {' '}
                  <Link href="/pharmacy/shifts" className="font-medium underline underline-offset-2" data-testid="open-shift-link">
                    {t('pharmacy.returns.openShiftLink')}
                  </Link>
                </>
              )}
            </span>
          </Note>
        )}
      </form>
    </Dialog>
  );
}
