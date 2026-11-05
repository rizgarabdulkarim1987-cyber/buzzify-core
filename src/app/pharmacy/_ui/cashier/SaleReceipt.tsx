'use client';

import { CircleAlert, CircleCheck, Hourglass, Plus, Printer, Receipt, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { reprintReceipt, saleReceipt } from '@/app/pharmacy/_actions/receipts';
import type { ReceiptResult } from '@/server/pharmacy/receipt-print';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Field } from '@/studio/ui/Field';
import { phMessage } from '../ph-failure';
import { formatMinor, keyFor, outcomeUnknown, type Currency, type KeyedAttempt } from '../sell-logic';
import { FieldSelect, Note, Num, PH_BTN, PH_FIELD, PH_PRIMARY } from '../sell-parts';
import { ThermalNote } from '../ThermalNote';
import { useThermal, useThermalJob } from '../use-thermal';
import { isolate } from '../WriteBlocked';
import type { Sold } from './use-sale-flow';

/**
 * The finished sale, inline in the work panel (the old receipt dialog's body, no dialog). The receipt is the server's rendering
 * of the STORED sale, shown in a sandboxed frame. The first print of the sale goes to the workstation's thermal printer by itself
 * (once per sale) and only that print may open the drawer; the drawer rule itself is `thermalDrawerPlan` (an original sale that
 * took cash, on a printer with a drawer pin and the cash rule on), so a card-only sale, a credit-only sale and a copy never open
 * it. "No print" skips the automatic print, so the drawer stays shut. Print by hand and a copy never open the drawer.
 */
export function SaleReceipt({ sold, onNext }: { sold: Sold; onNext: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const { sale, credit, noPrint } = sold;
  const frame = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState<'80' | '58'>('80');
  const [receipt, setReceipt] = useState<ReceiptResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [printFailed, setPrintFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const reprintKey = useRef<KeyedAttempt | null>(null);
  const saleId = sale.id;
  const thermal = useThermalJob(useThermal());
  const { run: runThermal } = thermal;
  const autoPrinted = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new width starts from a blank receipt while the server's rendering loads
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

  // The first print of a sale goes to the thermal printer by itself, once (a width change or a re-render does not print again).
  useEffect(() => {
    if (noPrint || !receipt || !thermal.enabled || autoPrinted.current === saleId || receipt.copyNumber > 0) return;
    autoPrinted.current = saleId;
    void runThermal(receipt.model, { drawer: true });
  }, [noPrint, saleId, receipt, thermal.enabled, runThermal]);

  const browserPrint = () => {
    setPrintFailed(false);
    autoPrinted.current = saleId;
    try {
      const target = frame.current?.contentWindow;
      if (!target) throw new Error('no frame');
      target.focus();
      target.print();
    } catch {
      setPrintFailed(true);
    }
  };
  const print = () => {
    setPrintFailed(false);
    // A press of Print by hand is a second print of this sale: it never opens the drawer, and it ends the automatic print.
    autoPrinted.current = saleId;
    if (thermal.enabled && receipt) {
      void runThermal(receipt.model);
      return;
    }
    browserPrint();
  };
  const reprint = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    // One key per copy asked for: a repeat after a dropped connection sends the same key (the server returns the same copy).
    reprintKey.current = keyFor(reprintKey.current, `${saleId}:${width}`, 'rp');
    const key = reprintKey.current.key;
    const result = await settle(() => reprintReceipt({ saleId, width, locale, clientKey: key }));
    setBusy(false);
    if (result.ok) {
      reprintKey.current = null;
      const copy = result.data as ReceiptResult;
      autoPrinted.current = saleId;
      setReceipt(copy);
      if (thermal.enabled) void runThermal(copy.model);
    } else {
      if (!outcomeUnknown(result.error)) reprintKey.current = null;
      setProblem(phMessage(t, locale, result.error, 'pharmacy.sell'));
    }
  };

  const cur: Currency = sale.currency;
  const money = (text: string) => (
    <>
      <Num>{formatMinor(BigInt(text), cur)}</Num> {cur}
    </>
  );

  return (
    <div className="flex flex-col gap-2.5" data-testid="flow-receipt">
      <Note look="ph" icon={<CircleCheck aria-hidden />} tone="success" role="status" testId="sale-done">
        {sale.replayed ? t('pharmacy.sell.receipt.replayed') : t('pharmacy.sell.receipt.saved')}{' '}
        <span data-testid="receipt-number">{t('pharmacy.sell.receipt.number', { number: sale.number ?? '' })}</span>
      </Note>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm text-ph-text" data-testid="sale-totals">
        <dt className="text-ph-muted">{t('pharmacy.sell.totals.subtotal')}</dt>
        <dd className="text-end">{money(sale.subtotalMinor)}</dd>
        {sale.discountMinor !== '0' && (
          <>
            <dt className="text-ph-muted">{t('pharmacy.sell.totals.discount')}</dt>
            <dd className="text-end">−{money(sale.discountMinor)}</dd>
          </>
        )}
        {sale.roundingMinor !== '0' && (
          <>
            <dt className="text-ph-muted">{t('pharmacy.sell.totals.rounding')}</dt>
            <dd className="text-end">{money(sale.roundingMinor)}</dd>
          </>
        )}
        <dt className="font-semibold">{t('pharmacy.sell.totals.total')}</dt>
        <dd className="text-end font-semibold" data-testid="sale-total">
          {money(sale.totalMinor)}
        </dd>
        <dt className="text-ph-muted">{t('pharmacy.sell.receipt.paid')}</dt>
        <dd className="text-end">{money(sale.paidMinor)}</dd>
        {credit && (
          <>
            <dt className="text-ph-muted" data-testid="sale-credit-label">
              {t('pharmacy.sell.receipt.ofWhichCredit')}: <span dir="auto">{isolate(credit.customerName)}</span>
            </dt>
            <dd className="text-end" data-testid="sale-credit">
              {money(credit.minor)}
            </dd>
          </>
        )}
        <dt className="text-ph-muted">{t('pharmacy.sell.pay.change')}</dt>
        <dd className="text-end text-base font-bold" data-testid="sale-change">
          {money(sale.changeMinor)}
        </dd>
      </dl>
      {noPrint && (
        <Note look="ph" icon={<Printer aria-hidden />} role="status" testId="receipt-no-print">
          {t('pharmacy.cashier.receipt.noPrint')}
        </Note>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('pharmacy.sell.receipt.width')}>
          <FieldSelect className={`${PH_FIELD} pe-8`} value={width} onChange={(event) => setWidth(event.target.value as '80' | '58')} data-testid="receipt-width">
            <option value="80">80 mm</option>
            <option value="58">58 mm</option>
          </FieldSelect>
        </Field>
        {receipt && receipt.copyNumber > 0 && <span className="pb-3 text-sm text-ph-muted">{t('pharmacy.sell.receipt.copy', { n: receipt.copyNumber })}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={PH_BTN} data-testid="receipt-print" onClick={print} disabled={!receipt || thermal.state === 'printing'}>
          <Printer aria-hidden className="size-4" />
          {t('pharmacy.sell.receipt.print')}
        </button>
        <button type="button" className={PH_BTN} data-testid="receipt-reprint" onClick={() => void reprint()} disabled={busy || !receipt}>
          <RotateCcw aria-hidden className="size-4" />
          {t('pharmacy.sell.receipt.reprint')}
        </button>
        {thermal.enabled && (
          <button type="button" className={PH_BTN} data-testid="receipt-print-browser" onClick={browserPrint} disabled={!receipt}>
            <Printer aria-hidden className="size-4" />
            {t('pharmacy.print.thermal.browser')}
          </button>
        )}
      </div>
      {problem && (
        <Note look="ph" icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="receipt-problem">
          {t('pharmacy.sell.receipt.loadFailed')} {problem}
        </Note>
      )}
      {!receipt && !problem && (
        <Note look="ph" icon={<Hourglass aria-hidden />} role="status">
          {t('pharmacy.sell.loading')}
        </Note>
      )}
      {receipt && (
        <iframe
          ref={frame}
          title={t('pharmacy.sell.receipt.preview')}
          data-testid="receipt-frame"
          sandbox="allow-same-origin allow-modals"
          srcDoc={receipt.html}
          className="h-60 w-full rounded-ph-xl border border-ph-line bg-white"
        />
      )}
      <ThermalNote state={thermal.state} look="ph" />
      {printFailed && (
        <Note look="ph" icon={<Printer aria-hidden />} tone="danger" role="alert" testId="print-failed">
          {t('pharmacy.sell.receipt.printFailed')}
        </Note>
      )}
      <p className="flex items-start gap-2 text-xs text-ph-muted">
        <Receipt aria-hidden className="mt-px size-3.5 shrink-0" />
        {t('pharmacy.sell.receipt.note')}
      </p>
      <button type="button" className={`${PH_PRIMARY} min-h-12 w-full text-base`} data-testid="receipt-next" onClick={onNext}>
        <Plus aria-hidden className="size-4" />
        {t('pharmacy.cashier.receipt.next')}
      </button>
    </div>
  );
}
