'use client';

import { CircleAlert, Hourglass, Printer, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { reprintReceipt } from '@/app/pharmacy/_actions/receipts';
import type { ReceiptResult } from '@/server/pharmacy/receipt-print';
import type { SaleResult } from '@/server/pharmacy/sales';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { phMessage } from '../ph-failure';
import { keyFor, outcomeUnknown, type KeyedAttempt } from '../sell-logic';
import { Note, PH_BTN } from '../sell-parts';
import { ThermalNote } from '../ThermalNote';
import { useThermal, useThermalJob } from '../use-thermal';

/**
 * The prototype's "print the receipt: a copy of the last receipt", inline: the last sale made on this screen is printed again as a
 * COPY, the old receipt dialog's reprint (`reprintReceipt`: the server marks and logs the copy). One key per copy asked for: a repeat
 * after a lost answer gets the same copy. A copy goes to the thermal printer WITHOUT the drawer (never `{ drawer: true }`; the copy
 * model is marked, so the drawer rule refuses it too).
 */
export function ReceiptCopy({ sale, onClose }: { sale: SaleResult; onClose: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const frame = useRef<HTMLIFrameElement>(null);
  const [copy, setCopy] = useState<ReceiptResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [printFailed, setPrintFailed] = useState(false);
  const key = useRef<KeyedAttempt | null>(null);
  const thermal = useThermalJob(useThermal());
  const { run } = thermal;
  const asked = useRef(false);
  const printed = useRef<ReceiptResult | null>(null);

  const ask = async () => {
    setProblem(null);
    key.current = keyFor(key.current, `${sale.id}:80`, 'rp');
    const clientKey = key.current.key;
    const result = await settle(() => reprintReceipt({ saleId: sale.id, width: '80', locale, clientKey }));
    if (!result.ok) {
      if (!outcomeUnknown(result.error)) key.current = null;
      setProblem(outcomeUnknown(result.error) ? t('pharmacy.cashier.copy.unknown') : phMessage(t, locale, result.error, 'pharmacy.sell'));
      return;
    }
    setCopy(result.data as ReceiptResult);
  };
  // The copy is asked for once when the panel opens (the toolbar button is the request); "Try again" asks with the same key.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the panel opens
  }, []);
  // Each copy made goes to the thermal printer once, without the drawer.
  useEffect(() => {
    if (!copy || !thermal.enabled || printed.current === copy) return;
    printed.current = copy;
    void run(copy.model);
  }, [copy, thermal.enabled, run]);

  const browserPrint = () => {
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

  return (
    <div className="flex flex-col gap-2.5" data-testid="flow-copy">
      {copy && (
        <p className="text-sm text-ph-muted" data-testid="copy-number">
          {t('pharmacy.sell.receipt.copy', { n: copy.copyNumber })}
        </p>
      )}
      {!copy && !problem && (
        <Note look="ph" icon={<Hourglass aria-hidden />} role="status">
          {t('pharmacy.sell.loading')}
        </Note>
      )}
      {problem && (
        <Note look="ph" icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="copy-problem">
          {t('pharmacy.sell.receipt.loadFailed')} {problem}
        </Note>
      )}
      {copy && <iframe ref={frame} title={t('pharmacy.sell.receipt.preview')} data-testid="copy-frame" sandbox="allow-same-origin allow-modals" srcDoc={copy.html} className="h-60 w-full rounded-ph-xl border border-ph-line bg-white" />}
      <ThermalNote state={thermal.state} look="ph" />
      {printFailed && (
        <Note look="ph" icon={<Printer aria-hidden />} tone="danger" role="alert">
          {t('pharmacy.sell.receipt.printFailed')}
        </Note>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        {problem ? (
          <button type="button" className={PH_BTN} data-testid="copy-retry" onClick={() => void ask()}>
            <Printer aria-hidden className="size-4" />
            {t('pharmacy.sell.receipt.reprint')}
          </button>
        ) : (
          <button type="button" className={PH_BTN} data-testid="copy-print-browser" disabled={!copy} onClick={browserPrint}>
            <Printer aria-hidden className="size-4" />
            {t('pharmacy.print.thermal.browser')}
          </button>
        )}
        <button type="button" className={PH_BTN} data-testid="copy-close" onClick={onClose}>
          <X aria-hidden className="size-4" />
          {t('pharmacy.cashier.copy.close')}
        </button>
      </div>
    </div>
  );
}
