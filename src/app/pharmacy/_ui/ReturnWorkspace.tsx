'use client';

import { CircleAlert, CircleCheck, Hourglass, Info, Lock, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createReturn, returnPreview } from '@/app/pharmacy/_actions/returns';
import type { Returnable } from '@/server/pharmacy/returns-reads';
import type { ReturnResult } from '@/server/pharmacy/returns';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Field } from '@/studio/ui/Field';
import { Money } from './money-parts';
import { PrintButton } from './PrintDialog';
import { useReturnFailure } from './SaleActions';
import { phMessage } from './ph-failure';
import { FIELD, FieldInput, FieldSelect, Note, Num, TOUCH_BTN, TOUCH_PRIMARY } from './sell-parts';
import { keyFor, outcomeUnknown, type KeyedAttempt } from './sell-logic';
import { parseReturnQty, previewCurrent, refundMethodChoices, returnRequest, returnSignature, type RefundMethod } from './shifts-logic';

export interface ReturnWorkspaceProps {
  data: Returnable;
  /** Whether the person has an open shift in this branch in the sale's currency (the refund is posted into it). */
  shiftOk: boolean;
}

/**
 * The return flow of one sale. Per line: how much was sold, already returned and what remains, and a quantity to give back
 * (whole base units, Arabic digits read). The refund shown is the SERVER's figure for exactly those quantities
 * (`ph.returns.preview`), never worked out here; the return itself judges again. The method is limited to those the sale
 * was paid with. One key per request: a retry after a dropped connection repeats it, a changed request gets a new one.
 */
export function ReturnWorkspace({ data, shiftOk }: ReturnWorkspaceProps) {
  const t = useT();
  const { locale } = useLocale();
  const failure = useReturnFailure();
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<RefundMethod>(data.defaultRefundMethod);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; noShift: boolean } | null>(null);
  const [done, setDone] = useState<ReturnResult | null>(null);
  const [preview, setPreview] = useState<{ refundMinor: string; isFinal: boolean } | null>(null);
  const [previewProblem, setPreviewProblem] = useState<string | null>(null);
  // The quantities the figure (or the refusal) shown was asked for: the return cannot be sent while a newer choice is still being asked.
  const [settledWire, setSettledWire] = useState<string | null>(null);
  const attempt = useRef<KeyedAttempt | null>(null);

  const rows = data.lines.map((l) => ({ saleLineId: l.id, remaining: l.remainingBaseQty, text: texts[l.id] ?? '' }));
  const request = returnRequest(rows);
  const wire = JSON.stringify(request.lines);
  const choices = refundMethodChoices(data.paidMethods, data.defaultRefundMethod);
  const fresh = !request.ok || previewCurrent(settledWire, wire);
  const shown = fresh ? preview : null;

  useEffect(() => {
    let cancelled = false;
    const lines = JSON.parse(wire) as { saleLineId: string; baseQty: number }[];
    if (!request.ok || lines.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nothing valid chosen: the old figure is no longer the server's answer for this request
      setPreview(null);
      setPreviewProblem(null);
      setSettledWire(null);
      return;
    }
    const timer = setTimeout(() => {
      void settle(() => returnPreview({ saleId: data.saleId, lines })).then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setPreview(result.data as { refundMinor: string; isFinal: boolean });
          setPreviewProblem(null);
        } else {
          setPreview(null);
          setPreviewProblem(phMessage(t, locale, result.error, 'pharmacy.returns'));
        }
        setSettledWire(wire);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the figure is asked again only when the chosen quantities change
  }, [wire, data.saleId, locale]);

  if (done) {
    return (
      <section aria-labelledby="return-done" className="flex max-w-[34rem] flex-col gap-4" data-testid="return-done">
        <h2 id="return-done" className="flex items-center gap-2 text-lg font-semibold text-text">
          <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
          {t(done.replayed ? 'pharmacy.returns.done.replayed' : 'pharmacy.returns.done.title')}
        </h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm text-text">
          <dt className="text-muted">{t('pharmacy.returns.number')}</dt>
          <dd className="text-end" data-testid="done-number"><Num>{done.number ?? ''}</Num></dd>
          <dt className="text-muted">{t('pharmacy.returns.refund')}</dt>
          <dd className="text-end font-semibold" data-testid="done-refund"><Money minor={done.refundMinor} currency={done.currency} /></dd>
          <dt className="text-muted">{t('pharmacy.returns.method')}</dt>
          <dd className="text-end">{t(`pharmacy.method.${done.refundMethod}`)}</dd>
        </dl>
        <Note icon={<CircleCheck aria-hidden />} tone="success" role="status">
          {t('pharmacy.returns.done.quarantine')}
        </Note>
        <div className="flex flex-wrap gap-2">
          <PrintButton target={{ kind: 'return', id: done.id, number: done.number }} label={t('pharmacy.returns.slip.open')} />
          <Link href={`/pharmacy/sales/${done.saleId}`} className={TOUCH_BTN} data-testid="back-to-sale">
            {t('pharmacy.returns.backToSale')}
          </Link>
          <Link href={`/pharmacy/returns/${done.id}`} className={TOUCH_BTN}>
            {t('pharmacy.returns.openReturn')}
          </Link>
        </div>
      </section>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !request.ok || !fresh || reason.trim().length < 3 || !shiftOk) return;
    setBusy(true);
    setProblem(null);
    attempt.current = keyFor(attempt.current, returnSignature(data.saleId, request.lines, reason, method), 'ret');
    const clientKey = attempt.current.key;
    const result = await settle(() => createReturn({ saleId: data.saleId, lines: request.lines, reason: reason.trim(), refundMethod: method, clientKey }));
    setBusy(false);
    if (!result.ok) {
      if (!outcomeUnknown(result.error)) attempt.current = null;
      setProblem(failure(result.error));
      return;
    }
    attempt.current = null;
    setDone(result.data as ReturnResult);
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex min-w-0 flex-col gap-5" data-testid="return-form">
      {!shiftOk && (
        <Note icon={<Lock aria-hidden />} tone="danger" role="status" testId="return-no-shift">
          <span>
            {t('pharmacy.returns.fail.NO_OPEN_SHIFT')}{' '}
            <Link href="/pharmacy/shifts" className="font-medium underline underline-offset-2" data-testid="open-shift-link">
              {t('pharmacy.returns.openShiftLink')}
            </Link>
          </span>
        </Note>
      )}
      {data.onAccount && (
        <Note icon={<Info aria-hidden />} tone="info" role="status" testId="return-on-account">
          {t('pharmacy.credit.returnNote')}
        </Note>
      )}
      {!data.window.withinWindow && (
        <Note icon={<CircleAlert aria-hidden />} role="status" testId="return-late">
          {t('pharmacy.returns.lateManager', { days: data.window.days })}
        </Note>
      )}
      <ul className="flex flex-col border-t border-line" data-testid="return-lines">
        {data.lines.map((l) => {
          const text = texts[l.id] ?? '';
          const { error } = parseReturnQty(text, l.remainingBaseQty);
          return (
            <li key={l.id} data-testid="return-line" className="flex min-w-0 flex-col gap-2 border-b border-line py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="min-w-0 break-words font-medium text-text" dir="auto">
                  {l.productName} <span className="text-muted">({l.unitLabel})</span>
                </span>
              </div>
              <p className="text-muted" data-testid="line-counts">
                {t('pharmacy.returns.counts', { sold: l.soldBaseQty, returned: l.returnedBaseQty, remaining: l.remainingBaseQty })}
              </p>
              {l.remainingBaseQty > 0 ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={t('pharmacy.returns.qtyFor', { product: l.productName })} error={error === 'over' ? t('pharmacy.returns.fail.RETURN_LIMIT') : error === 'invalid' ? t('pharmacy.returns.qtyInvalid') : undefined}>
                    <FieldInput
                      className={`${FIELD} max-w-40`}
                      dir="ltr"
                      inputMode="numeric"
                      autoComplete="off"
                      value={text}
                      placeholder="0"
                      data-testid="return-qty"
                      onChange={(event) => setTexts({ ...texts, [l.id]: event.target.value })}
                    />
                  </Field>
                  <button type="button" className={TOUCH_BTN} data-testid="return-all" onClick={() => setTexts({ ...texts, [l.id]: String(l.remainingBaseQty) })}>
                    {t('pharmacy.returns.all')}
                  </button>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-text">
                  <CircleCheck aria-hidden className="size-4 shrink-0" />
                  {t('pharmacy.returns.lineDone')}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <Field label={t('pharmacy.returns.reason')} hint={t('pharmacy.returns.reasonHint')}>
        <FieldInput className={FIELD} dir="auto" autoComplete="off" maxLength={300} value={reason} data-testid="return-reason" onChange={(event) => setReason(event.target.value)} />
      </Field>
      <Field label={t('pharmacy.returns.method')} hint={t('pharmacy.returns.methodHint')}>
        <FieldSelect className={`${FIELD} max-w-72 pe-8`} value={method} data-testid="return-method" onChange={(event) => setMethod(event.target.value as RefundMethod)}>
          {choices.map((m) => (
            <option key={m} value={m}>
              {t(`pharmacy.method.${m}`)}
            </option>
          ))}
        </FieldSelect>
      </Field>

      <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface px-3 py-2.5" data-testid="return-preview">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-md font-semibold text-text">
          <span>{t('pharmacy.returns.refundPreview')}</span>
          <span data-testid="preview-refund">{shown ? <Money minor={shown.refundMinor} currency={data.currency} /> : <span aria-label={t('pharmacy.returns.noPreview')}>—</span>}</span>
        </p>
        <p className="text-xs text-muted">{shown?.isFinal ? t('pharmacy.returns.previewFinal') : t('pharmacy.returns.previewNote')}</p>
        {fresh && previewProblem && (
          <Note icon={<CircleAlert aria-hidden />} tone="danger" role="status" testId="preview-problem">
            {previewProblem}
          </Note>
        )}
      </div>

      {problem && (
        <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="return-problem">
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
      <div>
        <button type="submit" className={TOUCH_PRIMARY} data-testid="return-confirm" disabled={busy || !request.ok || !fresh || reason.trim().length < 3 || !shiftOk}>
          {busy ? <Hourglass aria-hidden className="size-4" /> : <Undo2 aria-hidden className="size-4" />}
          {busy ? t('pharmacy.sell.pay.saving') : t('pharmacy.returns.confirm')}
        </button>
      </div>
    </form>
  );
}
