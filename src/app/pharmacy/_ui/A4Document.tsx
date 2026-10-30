'use client';

import { CircleAlert, CircleCheck, Lock, Printer, RotateCcw, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { reprintReceipt } from '@/app/pharmacy/_actions/receipts';
import { settingsOfWorkstation, type PrintSettings } from '@/server/domain/pharmacy/print-settings';
import type { ReceiptModel } from '@/server/domain/pharmacy/receipt';
import type { ReceiptResult } from '@/server/pharmacy/receipt-print';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { pageCss } from './print-logic';
import { phDate } from './ph-date';
import { phMessage } from './ph-failure';
import { keyFor, outcomeUnknown, type KeyedAttempt } from './sell-logic';
import { Note, TOUCH_BTN, TOUCH_PRIMARY } from './sell-parts';
import { useWorkstation } from './use-workstation';
import type { Writable } from './WriteBlocked';

export interface A4Target {
  kind: 'sale' | 'return';
  id: string;
}

/**
 * An A4 sale invoice or return slip, drawn from the receipt data the server rendered from the STORED document (never from a screen). It
 * prints with the browser's own print dialog and an `@page` rule from this workstation's settings: no silent printing, no printer driver, no
 * cash drawer. The first print is not logged; a copy goes through the reprint action, which logs it and returns the document marked COPY
 * with its number. Reading and printing the first copy work while the pharmacy is read-only; the copy needs it open and says so in words.
 * Nothing here changes the sale. The customer's name is drawn only when the server sent it (only for people allowed to see it).
 */
export function A4Document({ target, initial, customerName, print, writable }: { target: A4Target; initial: ReceiptModel; customerName: string | null; print: PrintSettings; writable: Writable }) {
  const t = useT();
  const { locale } = useLocale();
  const [workstation] = useWorkstation();
  const settings = settingsOfWorkstation(print, workstation ?? '');
  const [model, setModel] = useState<ReceiptModel>(initial);
  const [copyNumber, setCopyNumber] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [printFailed, setPrintFailed] = useState(false);
  const attempt = useRef<KeyedAttempt | null>(null);

  const doPrint = () => {
    setPrintFailed(false);
    try {
      window.print();
    } catch {
      setPrintFailed(true);
    }
  };

  const reprint = async () => {
    if (busy || !writable.ok) return;
    setBusy(true);
    setProblem(null);
    attempt.current = keyFor(attempt.current, `${target.kind}:${target.id}`, 'rp');
    const clientKey = attempt.current.key;
    const base = target.kind === 'sale' ? { saleId: target.id } : { returnId: target.id };
    const result = await settle(() => reprintReceipt({ ...base, width: '80', locale: model.locale, clientKey }));
    setBusy(false);
    if (!result.ok) {
      if (!outcomeUnknown(result.error)) attempt.current = null;
      setProblem(phMessage(t, locale, result.error, 'pharmacy.print'));
      return;
    }
    attempt.current = null;
    const done = result.data as ReceiptResult;
    flushSync(() => {
      setModel(done.model);
      setCopyNumber(done.copyNumber);
    });
    doPrint();
  };

  const blockedText = writable.ok ? null : writable.reason === 'readOnly' ? t('pharmacy.print.blocked.readOnly', { date: phDate(writable.until, locale) }) : t(`pharmacy.print.blocked.${writable.reason}`);

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8" data-testid="a4-page" data-kind={target.kind}>
      <style>{pageCss(settings)}</style>
      <div className="flex flex-col gap-3 print:hidden" data-testid="a4-toolbar">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={TOUCH_PRIMARY} onClick={doPrint} data-testid="a4-print">
            <Printer aria-hidden className="size-4" />
            {t('pharmacy.print.print')}
          </button>
          {writable.ok && (
            <button type="button" className={TOUCH_BTN} onClick={() => void reprint()} disabled={busy} data-testid="a4-reprint">
              <RotateCcw aria-hidden className="size-4" />
              {t('pharmacy.print.reprint')}
            </button>
          )}
          <Link href="/pharmacy/print/settings" className={TOUCH_BTN} data-testid="a4-settings-link">
            <Settings2 aria-hidden className="size-4" />
            {t('pharmacy.print.settings.link')}
          </Link>
        </div>
        <p className="text-sm text-muted" data-testid="a4-workstation">
          {t('pharmacy.print.workstationNote', { name: workstation ?? t('pharmacy.print.workstationNone'), paper: settings.paper })}
        </p>
        {blockedText && (
          <p data-testid="a4-reprint-blocked" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
            <Lock aria-hidden className="text-muted" />
            <span className="min-w-0">{blockedText}</span>
          </p>
        )}
        {copyNumber > 0 && (
          <Note icon={<CircleCheck aria-hidden />} tone="success" role="status" testId="a4-logged">
            {t('pharmacy.sales.receipt.logged', { n: copyNumber })}
          </Note>
        )}
        {problem && (
          <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="a4-problem">
            {problem}
          </Note>
        )}
        {printFailed && (
          <Note icon={<Printer aria-hidden />} tone="danger" role="alert" testId="a4-print-failed">
            {t('pharmacy.sell.receipt.printFailed')}
          </Note>
        )}
        <p className="text-xs text-muted">{t('pharmacy.print.browserOnly')}</p>
      </div>
      <Sheet model={model} kind={target.kind} customerName={customerName} />
    </div>
  );
}

const CELL = 'border-b border-neutral-400 px-2 py-1.5 align-top';
const NUM = `${CELL} text-end tabular-nums`;

/** The paper: always black on white, so it prints the same in a dark theme. */
function Sheet({ model, kind, customerName }: { model: ReceiptModel; kind: 'sale' | 'return'; customerName: string | null }) {
  const t = useT();
  const l = model.labels;
  const isSale = kind === 'sale';
  return (
    <article
      dir={model.dir}
      lang={model.locale}
      data-testid="a4-sheet"
      data-copy={model.copy ? 'true' : 'false'}
      className="mx-auto w-full max-w-[210mm] break-words border border-neutral-400 bg-white p-6 text-sm text-black print:max-w-none print:border-0 print:p-0"
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-black pb-3">
        <div className="min-w-0">
          <p className="text-xl font-bold" data-testid="a4-shop">
            <bdi>{model.shop.name}</bdi>
          </p>
          {model.shop.address && <p data-testid="a4-address"><bdi>{model.shop.address}</bdi></p>}
          {model.shop.phone && (
            <p>
              <bdi dir="ltr">{model.shop.phone}</bdi>
            </p>
          )}
        </div>
        <div className="text-end">
          <h2 className="text-lg font-bold" data-testid="a4-title">
            {t(isSale ? 'pharmacy.print.invoice.title' : 'pharmacy.print.slip.title')}
          </h2>
          {model.copyMarker && (
            <p className="mt-1 inline-block border-2 border-black px-2 py-0.5 font-bold" data-testid="a4-copy-marker">
              {model.copyMarker}
            </p>
          )}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 py-3 sm:grid-cols-3" data-testid="a4-meta">
        <Meta label={l.number} value={model.number} testId="a4-number" ltr />
        {model.saleNumber && <Meta label={l.saleNumber} value={model.saleNumber} testId="a4-sale-number" ltr />}
        <Meta label={l.date} value={model.date} testId="a4-date" ltr />
        <Meta label={l.currency} value={model.currency} ltr />
        {model.cashier && <Meta label={isSale ? l.cashier : l.approvedBy} value={model.cashier} />}
        {customerName && <Meta label={t('pharmacy.print.customer')} value={customerName} testId="a4-customer" />}
      </dl>

      <div role="region" aria-label={t(isSale ? 'pharmacy.print.invoice.title' : 'pharmacy.print.slip.title')} tabIndex={0} className="overflow-x-auto print:overflow-visible">
        <table className="w-full border-collapse text-sm" data-testid="a4-lines">
          <thead>
            <tr className="border-y-2 border-black">
              <th scope="col" className="px-2 py-1.5 text-start">
                {t('pharmacy.print.col.no')}
              </th>
              <th scope="col" className="px-2 py-1.5 text-start">
                {t('pharmacy.print.col.item')}
              </th>
              <th scope="col" className="px-2 py-1.5 text-end">
                {l.qty}
              </th>
              {isSale && (
                <>
                  <th scope="col" className="px-2 py-1.5 text-end">
                    {t('pharmacy.print.col.unitPrice')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-end">
                    {l.discount}
                  </th>
                </>
              )}
              <th scope="col" className="px-2 py-1.5 text-end">
                {isSale ? l.total : l.refund}
              </th>
            </tr>
          </thead>
          <tbody>
            {model.lines.map((line) => (
              <tr key={line.no} data-testid="a4-line">
                <td className={CELL}>
                  <bdi dir="ltr">{line.no}</bdi>
                </td>
                <td className={CELL}>
                  <bdi>{line.name}</bdi>
                  {line.strength && (
                    <span className="block text-xs">
                      <bdi>{line.strength}</bdi>
                    </span>
                  )}
                  {line.rx && <span className="block text-xs font-bold">{l.rx}</span>}
                </td>
                <td className={NUM} data-testid="a4-qty">
                  <bdi dir="ltr">{line.qty}</bdi> {line.unit}
                </td>
                {isSale && (
                  <>
                    <td className={NUM}>
                      <bdi dir="ltr">{line.unitPrice ?? ''}</bdi>
                    </td>
                    <td className={NUM}>
                      <bdi dir="ltr">{line.discount ?? ''}</bdi>
                    </td>
                  </>
                )}
                <td className={NUM} data-testid="a4-line-total">
                  <bdi dir="ltr">{line.total}</bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
        <section aria-label={t('pharmacy.print.payments')} className="min-w-0">
          {isSale ? (
            <ul className="flex flex-col gap-0.5" data-testid="a4-payments">
              {model.payments.map((p, i) => (
                <li key={`${p.method}-${i}`} className="flex gap-6" data-testid="a4-payment" data-method={p.method}>
                  <span>{p.label}</span>
                  <bdi dir="ltr" className="tabular-nums">
                    {p.amount}
                  </bdi>
                </li>
              ))}
            </ul>
          ) : (
            model.refundMethod && (
              <p data-testid="a4-refund-method">
                {l.refundedBy}: {model.refundMethod.label}
              </p>
            )
          )}
        </section>
        <dl className="ms-auto grid min-w-[16rem] grid-cols-[1fr_auto] gap-x-8 gap-y-1" data-testid="a4-totals">
          {isSale && model.subtotal !== null && <Total label={l.subtotal} value={model.subtotal} testId="a4-subtotal" />}
          {isSale && model.discount !== null && <Total label={l.discount} value={model.discount} testId="a4-discount" />}
          {isSale && model.rounding !== null && <Total label={l.rounding} value={model.rounding} testId="a4-rounding" />}
          <Total label={isSale ? l.total : l.refund} value={model.total} strong testId="a4-total" />
          {isSale && model.paid !== null && <Total label={l.paid} value={model.paid} testId="a4-paid" />}
          {isSale && model.change !== null && <Total label={l.change} value={model.change} testId="a4-change" />}
        </dl>
      </div>

      {model.shop.footer && <p className="mt-6 border-t border-neutral-400 pt-2 text-center text-xs"><bdi>{model.shop.footer}</bdi></p>}
    </article>
  );
}

function Meta({ label, value, testId, ltr = false }: { label: string; value: string; testId?: string; ltr?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs">{label}</dt>
      <dd className="font-medium" data-testid={testId}>
        {ltr ? <bdi dir="ltr">{value}</bdi> : <bdi>{value}</bdi>}
      </dd>
    </div>
  );
}

function Total({ label, value, strong = false, testId }: { label: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <>
      <dt className={strong ? 'border-t-2 border-black pt-1 font-bold' : ''}>{label}</dt>
      <dd className={`text-end tabular-nums ${strong ? 'border-t-2 border-black pt-1 font-bold' : ''}`} data-testid={testId}>
        <bdi dir="ltr">{value}</bdi>
      </dd>
    </>
  );
}
