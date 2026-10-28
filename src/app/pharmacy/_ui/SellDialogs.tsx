'use client';

import { Banknote, CircleAlert, CircleCheck, CreditCard, Hourglass, Landmark, PackageOpen, Play, Printer, Receipt, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { listHolds } from '@/app/pharmacy/_actions/sales';
import { reprintReceipt, saleReceipt } from '@/app/pharmacy/_actions/receipts';
import type { ReceiptResult } from '@/server/pharmacy/receipt-print';
import type { HoldSummary } from '@/server/pharmacy/holds';
import type { SaleResult } from '@/server/pharmacy/sales';
import { formatDateTime } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Dialog } from '@/studio/ui/Dialog';
import { Field } from '@/studio/ui/Field';
import { phMessage } from './ph-failure';
import { Num, Note, FIELD, TOUCH_BTN, TOUCH_PRIMARY, FieldInput, FieldSelect } from './sell-parts';
import { cashShortcuts, formatMinor, keyFor, outcomeUnknown, paymentPreview, plainMinor, type Currency, type KeyedAttempt, type PayDraft, type PayMethod } from './sell-logic';

// Pay -----------------------------------------------------------------------------------------------------------------

const METHODS: { method: PayMethod; icon: ReactNode }[] = [
  { method: 'CASH', icon: <Banknote aria-hidden /> },
  { method: 'CARD_MANUAL', icon: <CreditCard aria-hidden /> },
  { method: 'TRANSFER_MANUAL', icon: <Landmark aria-hidden /> },
];

export interface PayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: Currency;
  /** The estimate of the total; the sale's own total comes back with the answer. */
  totalMinor: bigint;
  busy: boolean;
  /** The last refusal or network failure, in words. */
  problem: string | null;
  offline: boolean;
  /** The payment of an attempt whose outcome is unknown, to fill in again exactly as it was sent (so its keys still match). */
  initial?: PayDraft | null;
  onSubmit: (draft: PayDraft, amountMinor: bigint) => void;
}

/**
 * Takes the payment: cash with the amount handed over and the change, or a card or transfer recorded by hand for exactly
 * the total. The amount defaults to the exact total, so a plain Enter completes a no-change sale. The attempt's keys are
 * the caller's: a retry after a failure sends the same ones.
 */
export function PayDialog({ open, onOpenChange, currency, totalMinor, busy, problem, offline, initial = null, onSubmit }: PayDialogProps) {
  const t = useT();
  const form = useId();
  const [draft, setDraft] = useState<PayDraft>({ method: 'CASH', tendered: '', reference: '' });
  const [opened, setOpened] = useState(false);
  if (open && !opened) {
    setOpened(true);
    setDraft(initial ?? { method: 'CASH', tendered: '', reference: '' });
  }
  if (!open && opened) setOpened(false);

  const preview = paymentPreview(draft, totalMinor, currency);
  const exact = draft.tendered.trim() === '';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || offline || !preview.ok || preview.amountMinor === null) return;
    onSubmit(draft, preview.amountMinor);
  };
  const fieldError = preview.amountMinor === null ? t('pharmacy.sell.pay.invalidAmount') : !preview.ok ? t(draft.method === 'CASH' ? 'pharmacy.sell.pay.short' : 'pharmacy.sell.pay.exactOnly') : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !busy && onOpenChange(next)}
      width="md"
      title={t('pharmacy.sell.pay.title')}
      description={
        <span data-testid="pay-total">
          {t('pharmacy.sell.pay.total')}: <strong className="text-text"><Num>{formatMinor(totalMinor, currency)}</Num> {currency}</strong> · {t('pharmacy.sell.estimate')}
        </span>
      }
      footer={
        <>
          <button type="button" className={TOUCH_BTN} onClick={() => onOpenChange(false)} disabled={busy}>
            {t('pharmacy.sell.pay.cancel')}
          </button>
          <button type="submit" form={form} data-testid="pay-confirm" className={TOUCH_PRIMARY} disabled={busy || offline || !preview.ok}>
            {busy ? <Hourglass aria-hidden className="size-4" /> : <CircleCheck aria-hidden className="size-4" />}
            {busy ? t('pharmacy.sell.pay.saving') : t('pharmacy.sell.pay.confirm')}
          </button>
        </>
      }
    >
      <form id={form} onSubmit={submit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-text">{t('pharmacy.sell.pay.method')}</legend>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map(({ method, icon }) => (
              <label
                key={method}
                className={`flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-center text-sm font-medium [&_svg]:size-4 ${
                  draft.method === method ? 'border-ink bg-ink text-on-ink' : 'border-line-strong bg-raised text-text hover:bg-hover'
                } has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink`}
              >
                <input type="radio" name="method" value={method} checked={draft.method === method} onChange={() => setDraft({ ...draft, method, tendered: '' })} className="sr-only" data-testid={`pay-${method}`} />
                {icon}
                {t(`pharmacy.sell.pay.method.${method}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <Field label={t(draft.method === 'CASH' ? 'pharmacy.sell.pay.tendered' : 'pharmacy.sell.pay.amount')} hint={exact ? t('pharmacy.sell.pay.exactHint') : undefined} error={fieldError}>
          <FieldInput
            className={FIELD}
            dir="ltr"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            data-testid="pay-tendered"
            value={draft.tendered}
            placeholder={plainMinor(totalMinor, currency)}
            onChange={(event) => setDraft({ ...draft, tendered: event.target.value })}
          />
        </Field>

        {draft.method === 'CASH' && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('pharmacy.sell.pay.quick')}>
            <button type="button" className={TOUCH_BTN} data-testid="pay-exact" aria-pressed={exact} onClick={() => setDraft({ ...draft, tendered: '' })}>
              {t('pharmacy.sell.pay.exact')}
            </button>
            {cashShortcuts(totalMinor, currency).map((amount) => (
              <button key={amount.toString()} type="button" className={TOUCH_BTN} onClick={() => setDraft({ ...draft, tendered: plainMinor(amount, currency) })}>
                <Num>{formatMinor(amount, currency)}</Num>
              </button>
            ))}
          </div>
        )}

        {draft.method === 'CASH' ? (
          <p data-testid="pay-change" className="flex items-baseline justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2.5 text-md font-semibold text-text">
            <span>{t('pharmacy.sell.pay.change')}</span>
            <span><Num>{formatMinor(preview.changeMinor, currency)}</Num> {currency}</span>
          </p>
        ) : (
          <Field label={t('pharmacy.sell.pay.reference')} optional>
            <FieldInput className={FIELD} dir="auto" autoComplete="off" maxLength={200} value={draft.reference} onChange={(event) => setDraft({ ...draft, reference: event.target.value })} />
          </Field>
        )}

        {offline && <Note icon={<TriangleAlert aria-hidden />} tone="danger" role="alert">{t('pharmacy.sell.offline.pay')}</Note>}
        {problem && <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="pay-problem">{problem}</Note>}
      </form>
    </Dialog>
  );
}

// Holds ---------------------------------------------------------------------------------------------------------------

export interface HoldsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A held cart can be taken only into an empty cart. */
  cartEmpty: boolean;
  /** Resolves null when it worked, else the refusal in words. */
  onResume: (id: string) => Promise<string | null>;
  onDiscard: (id: string) => Promise<string | null>;
}

export function HoldsDialog({ open, onOpenChange, cartEmpty, onResume, onDiscard }: HoldsDialogProps) {
  const t = useT();
  const { locale } = useLocale();
  const [items, setItems] = useState<HoldSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);

  const load = async () => {
    setItems(null);
    const result = await settle(() => listHolds({}));
    if (!result.ok) {
      setProblem(phMessage(t, locale, result.error, 'pharmacy.sell'));
      setItems([]);
      return;
    }
    setProblem(null);
    setItems((result.data as { items: HoldSummary[] }).items);
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the branch's holds from the server each time the dialog opens
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on each opening only
  }, [open]);

  const act = async (id: string, run: (id: string) => Promise<string | null>, reload: boolean) => {
    setBusyId(id);
    const failed = await run(id);
    setBusyId(null);
    setAsking(null);
    if (failed) setProblem(failed);
    else if (reload) await load();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} width="md" title={t('pharmacy.sell.holds.title')} description={t('pharmacy.sell.holds.body')}>
      <div className="flex flex-col gap-3 pb-1" data-testid="holds-list">
        {!cartEmpty && <Note icon={<CircleAlert aria-hidden />} tone="info">{t('pharmacy.sell.holds.needEmpty')}</Note>}
        {problem && <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert">{problem}</Note>}
        {items === null && <Note icon={<Hourglass aria-hidden />} role="status">{t('pharmacy.sell.loading')}</Note>}
        {items?.length === 0 && !problem && (
          <p className="flex items-center gap-2.5 py-4 text-sm text-muted">
            <PackageOpen aria-hidden className="size-4 shrink-0" />
            {t('pharmacy.sell.holds.empty')}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {items?.map((hold) => (
            <li key={hold.id} data-testid="hold-row" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-line px-3 py-2">
              <p className="flex min-w-0 flex-col text-sm text-text">
                <span className="font-semibold">
                  <Num>{formatMinor(BigInt(hold.totalPreviewMinor), hold.currency)}</Num> {hold.currency}
                </span>
                <span className="text-muted">
                  {t('pharmacy.sell.holds.lines', { count: hold.lineCount })} · {hold.mine ? t('pharmacy.sell.holds.mine') : t('pharmacy.sell.holds.other')} · <Num>{formatDateTime(hold.createdAt, locale)}</Num>
                </span>
              </p>
              {asking === hold.id ? (
                <span className="flex w-full flex-col gap-2" data-testid="hold-discard-ask">
                  <Note icon={<TriangleAlert aria-hidden />} tone="danger" role="alert">
                    {t('pharmacy.sell.holds.discardAsk')}
                  </Note>
                  <span className="flex flex-wrap gap-2">
                    <button type="button" className={TOUCH_BTN} data-testid="hold-discard-keep" disabled={busyId !== null} onClick={() => setAsking(null)}>
                      {t('pharmacy.sell.holds.discardKeep')}
                    </button>
                    <button type="button" className={TOUCH_PRIMARY} data-testid="hold-discard-confirm" disabled={busyId !== null} onClick={() => void act(hold.id, onDiscard, true)}>
                      <Trash2 aria-hidden className="size-4" />
                      {t('pharmacy.sell.holds.discard')}
                    </button>
                  </span>
                </span>
              ) : (
                <span className="flex flex-wrap gap-2">
                  <button type="button" data-testid="hold-resume" className={TOUCH_BTN} disabled={!cartEmpty || busyId !== null} onClick={() => void act(hold.id, onResume, false)}>
                    <Play aria-hidden className="size-4" />
                    {t('pharmacy.sell.holds.resume')}
                  </button>
                  <button type="button" data-testid="hold-discard" className={TOUCH_BTN} disabled={busyId !== null} onClick={() => setAsking(hold.id)}>
                    <Trash2 aria-hidden className="size-4" />
                    {t('pharmacy.sell.holds.discard')}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

// Receipt -------------------------------------------------------------------------------------------------------------

export interface ReceiptDialogProps {
  sale: SaleResult | null;
  onClose: () => void;
}

/**
 * The finished sale and its receipt. The receipt is the server's rendering of the STORED sale (never of the screen),
 * shown in a sandboxed frame and printed from it with the browser's print. A printer that fails shows a sentence here and
 * changes nothing about the sale; a reprint is marked COPY and logged.
 */
export function ReceiptDialog({ sale, onClose }: ReceiptDialogProps) {
  const t = useT();
  const { locale } = useLocale();
  const frame = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState<'80' | '58'>('80');
  const [receipt, setReceipt] = useState<ReceiptResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [printFailed, setPrintFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const reprintKey = useRef<KeyedAttempt | null>(null);
  const saleId = sale?.id ?? null;

  useEffect(() => {
    if (!saleId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new sale or width starts from a blank receipt while the server's rendering loads
    setReceipt(null);
    setProblem(null);
    setPrintFailed(false);
    void settle(() => saleReceipt({ saleId, width, locale })).then((result) => {
      if (cancelled) return;
      if (result.ok) setReceipt(result.data as ReceiptResult);
      else setProblem(phMessage(t, locale, result.error, 'pharmacy.sell'));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the receipt is read again only for another sale or width
  }, [saleId, width, locale]);

  const print = () => {
    setPrintFailed(false);
    try {
      const target = frame.current?.contentWindow;
      if (!target) throw new Error('no frame');
      target.focus();
      target.print();
    } catch {
      setPrintFailed(true);
    }
  };

  const reprint = async () => {
    if (!saleId || busy) return;
    setBusy(true);
    setProblem(null);
    // One key per copy asked for: a repeat after a dropped connection sends the same key (the server returns the same copy);
    // once a copy is made or refused, the next click asks for a new one.
    reprintKey.current = keyFor(reprintKey.current, `${saleId}:${width}`, 'rp');
    const key = reprintKey.current.key;
    const result = await settle(() => reprintReceipt({ saleId, width, locale, clientKey: key }));
    setBusy(false);
    if (result.ok) {
      reprintKey.current = null;
      setReceipt(result.data as ReceiptResult);
    } else {
      if (!outcomeUnknown(result.error)) reprintKey.current = null;
      setProblem(phMessage(t, locale, result.error, 'pharmacy.sell'));
    }
  };

  const cur = sale?.currency ?? 'IQD';
  const money = (text: string) => (
    <>
      <Num>{formatMinor(BigInt(text), cur)}</Num> {cur}
    </>
  );

  return (
    <Dialog
      open={sale !== null}
      onOpenChange={(next) => !next && onClose()}
      width="md"
      title={t('pharmacy.sell.receipt.title')}
      description={sale ? <span data-testid="receipt-number">{t('pharmacy.sell.receipt.number', { number: sale.number ?? '' })}</span> : undefined}
      footer={
        <>
          <button type="button" className={TOUCH_BTN} data-testid="receipt-reprint" onClick={() => void reprint()} disabled={busy || !receipt}>
            <RotateCcw aria-hidden className="size-4" />
            {t('pharmacy.sell.receipt.reprint')}
          </button>
          <button type="button" className={TOUCH_BTN} data-testid="receipt-print" onClick={print} disabled={!receipt}>
            <Printer aria-hidden className="size-4" />
            {t('pharmacy.sell.receipt.print')}
          </button>
          <button type="button" className={TOUCH_PRIMARY} data-testid="receipt-done" onClick={onClose}>
            <CircleCheck aria-hidden className="size-4" />
            {t('pharmacy.sell.receipt.done')}
          </button>
        </>
      }
    >
      {sale && (
        <div className="flex flex-col gap-3 pb-1">
          <Note icon={<CircleCheck aria-hidden />} tone="success" role="status" testId="sale-done">
            {sale.replayed ? t('pharmacy.sell.receipt.replayed') : t('pharmacy.sell.receipt.saved')}
          </Note>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm text-text" data-testid="sale-totals">
            <dt className="text-muted">{t('pharmacy.sell.totals.subtotal')}</dt>
            <dd className="text-end">{money(sale.subtotalMinor)}</dd>
            {sale.discountMinor !== '0' && (
              <>
                <dt className="text-muted">{t('pharmacy.sell.totals.discount')}</dt>
                <dd className="text-end">−{money(sale.discountMinor)}</dd>
              </>
            )}
            {sale.roundingMinor !== '0' && (
              <>
                <dt className="text-muted">{t('pharmacy.sell.totals.rounding')}</dt>
                <dd className="text-end">{money(sale.roundingMinor)}</dd>
              </>
            )}
            <dt className="font-semibold">{t('pharmacy.sell.totals.total')}</dt>
            <dd className="text-end font-semibold" data-testid="sale-total">{money(sale.totalMinor)}</dd>
            <dt className="text-muted">{t('pharmacy.sell.receipt.paid')}</dt>
            <dd className="text-end">{money(sale.paidMinor)}</dd>
            <dt className="text-muted">{t('pharmacy.sell.pay.change')}</dt>
            <dd className="text-end" data-testid="sale-change">{money(sale.changeMinor)}</dd>
          </dl>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('pharmacy.sell.receipt.width')}>
              <FieldSelect className={`${FIELD} pe-8`} value={width} onChange={(event) => setWidth(event.target.value as '80' | '58')} data-testid="receipt-width">
                <option value="80">80 mm</option>
                <option value="58">58 mm</option>
              </FieldSelect>
            </Field>
            {receipt && receipt.copyNumber > 0 && <span className="pb-3 text-sm text-muted">{t('pharmacy.sell.receipt.copy', { n: receipt.copyNumber })}</span>}
          </div>
          {problem && (
            <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="receipt-problem">
              {t('pharmacy.sell.receipt.loadFailed')} {problem}
            </Note>
          )}
          {!receipt && !problem && <Note icon={<Hourglass aria-hidden />} role="status">{t('pharmacy.sell.loading')}</Note>}
          {receipt && (
            <iframe
              ref={frame}
              title={t('pharmacy.sell.receipt.preview')}
              data-testid="receipt-frame"
              sandbox="allow-same-origin allow-modals"
              srcDoc={receipt.html}
              className="h-72 w-full rounded-md border border-line bg-white"
            />
          )}
          {printFailed && (
            <Note icon={<Printer aria-hidden />} tone="danger" role="alert" testId="print-failed">
              {t('pharmacy.sell.receipt.printFailed')}
            </Note>
          )}
          <p className="flex items-start gap-2 text-xs text-muted">
            <Receipt aria-hidden className="mt-px size-3.5 shrink-0" />
            {t('pharmacy.sell.receipt.note')}
          </p>
        </div>
      )}
    </Dialog>
  );
}

// Small questions -------------------------------------------------------------------------------------------------------

export function AskDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel,
  icon,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  icon: ReactNode;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={body}
      footer={
        <>
          <button type="button" className={TOUCH_BTN} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </button>
          <button
            type="button"
            data-testid="ask-confirm"
            className={TOUCH_PRIMARY}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {icon}
            {confirmLabel}
          </button>
        </>
      }
    />
  );
}
