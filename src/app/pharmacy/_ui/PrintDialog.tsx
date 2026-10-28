'use client';

import { CircleAlert, CircleCheck, Hourglass, Printer, Receipt, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { reprintReceipt, returnSlip, saleReceipt } from '@/app/pharmacy/_actions/receipts';
import type { ReceiptResult } from '@/server/pharmacy/receipt-print';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Dialog } from '@/studio/ui/Dialog';
import { Field } from '@/studio/ui/Field';
import { phMessage } from './ph-failure';
import { FIELD, FieldSelect, Note, TOUCH_BTN, TOUCH_PRIMARY } from './sell-parts';
import { keyFor, outcomeUnknown, type KeyedAttempt } from './sell-logic';

export interface PrintTarget {
  kind: 'sale' | 'return';
  id: string;
  number: string | null;
}

/**
 * A saved sale's receipt or a return's slip: the server renders it from the STORED document (never from the screen), it
 * shows in a sandboxed frame and prints with the browser's print. A printer that fails shows a sentence and changes
 * nothing; a reprint is marked COPY and logged (the reprint key is per click, kept across a dropped connection).
 */
export function PrintDialog({ target, onClose }: { target: PrintTarget | null; onClose: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const frame = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState<'80' | '58'>('80');
  const [receipt, setReceipt] = useState<ReceiptResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [printFailed, setPrintFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const reprintKey = useRef<KeyedAttempt | null>(null);
  const kind = target?.kind;
  const id = target?.id;

  useEffect(() => {
    if (!id || !kind) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new document or width starts from a blank preview while the server renders it
    setReceipt(null);
    setProblem(null);
    setPrintFailed(false);
    const load = kind === 'sale' ? () => saleReceipt({ saleId: id, width, locale }) : () => returnSlip({ returnId: id, width, locale });
    void settle(load).then((result) => {
      if (cancelled) return;
      if (result.ok) setReceipt(result.data as ReceiptResult);
      else setProblem(phMessage(t, locale, result.error, 'pharmacy.sell'));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again only for another document, width or language
  }, [id, kind, width, locale]);

  const print = () => {
    setPrintFailed(false);
    try {
      const win = frame.current?.contentWindow;
      if (!win) throw new Error('no frame');
      win.focus();
      win.print();
    } catch {
      setPrintFailed(true);
    }
  };

  const reprint = async () => {
    if (!id || !kind || busy) return;
    setBusy(true);
    setProblem(null);
    reprintKey.current = keyFor(reprintKey.current, `${kind}:${id}:${width}`, 'rp');
    const clientKey = reprintKey.current.key;
    const base = kind === 'sale' ? { saleId: id } : { returnId: id };
    const result = await settle(() => reprintReceipt({ ...base, width, locale, clientKey }));
    setBusy(false);
    if (result.ok) {
      reprintKey.current = null;
      setReceipt(result.data as ReceiptResult);
    } else {
      if (!outcomeUnknown(result.error)) reprintKey.current = null;
      setProblem(phMessage(t, locale, result.error, 'pharmacy.sell'));
    }
  };

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => !next && onClose()}
      width="md"
      title={t(kind === 'return' ? 'pharmacy.returns.slip.title' : 'pharmacy.sales.receipt.title')}
      description={target?.number ? <span data-testid="print-number">{t('pharmacy.sell.receipt.number', { number: target.number })}</span> : undefined}
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
            {t('pharmacy.sales.receipt.close')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-1">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('pharmacy.sell.receipt.width')}>
            <FieldSelect className={`${FIELD} pe-8`} value={width} onChange={(event) => setWidth(event.target.value as '80' | '58')} data-testid="receipt-width">
              <option value="80">80 mm</option>
              <option value="58">58 mm</option>
            </FieldSelect>
          </Field>
          {receipt && receipt.copyNumber > 0 && (
            <span className="pb-3 text-sm font-medium text-text" data-testid="receipt-copy">
              {t('pharmacy.sell.receipt.copy', { n: receipt.copyNumber })}
            </span>
          )}
        </div>
        {receipt && receipt.copyNumber > 0 && (
          <Note icon={<CircleCheck aria-hidden />} tone="success" role="status" testId="reprint-logged">
            {t('pharmacy.sales.receipt.logged', { n: receipt.copyNumber })}
          </Note>
        )}
        {problem && (
          <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="receipt-problem">
            {t('pharmacy.sales.receipt.loadFailed')} {problem}
          </Note>
        )}
        {!receipt && !problem && <Note icon={<Hourglass aria-hidden />} role="status">{t('pharmacy.sell.loading')}</Note>}
        {receipt && (
          <iframe ref={frame} title={t('pharmacy.sell.receipt.preview')} data-testid="receipt-frame" sandbox="allow-same-origin allow-modals" srcDoc={receipt.html} className="h-72 w-full rounded-md border border-line bg-white" />
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
    </Dialog>
  );
}

/** A button that opens the print dialog of one saved document (a sale's receipt or a return's slip). */
export function PrintButton({ target, label, testId = 'slip-open' }: { target: PrintTarget; label: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={TOUCH_BTN} data-testid={testId} onClick={() => setOpen(true)}>
        <Printer aria-hidden className="size-4" />
        {label}
      </button>
      <PrintDialog target={open ? target : null} onClose={() => setOpen(false)} />
    </>
  );
}
