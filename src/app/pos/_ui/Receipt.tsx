'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { logPosReprint } from '@/app/studio/_actions/pos';
import { formatNumber, formatStamp } from '@/lib/pos-format';
import { receiptPrintOptions } from '@/server/domain/pos/drawer';
import { settle } from '@/studio/settle';
import { printFailureText } from './print/print-client';
import { usePrint } from './print/PrintProvider';
import type { Receipt as ReceiptData } from '@/server/pos/payments';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import type { PosPaymentMethodKey } from '@/server/domain/pos/payment-methods';
import { useMoney } from './money';
import { ReverseButton } from './ReverseDialog';

/** Payments whose original already went to the printer from this page, so a refresh or a second render never prints twice. */
const AUTO_PRINTED = new Set<string>();

/** The paid order as a slip: printable at 80 mm, with the screen controls left out of the print. */
export function Receipt({ receipt, canRefund = false, autoPrint = false }: { receipt: ReceiptData; canRefund?: boolean; autoPrint?: boolean }) {
  const t = useT();
  const money = useMoney();
  const { hasReceiptPrinter, printReceipt } = usePrint();
  const [problem, setProblem] = useState<{ message: string; copy: boolean } | null>(null);
  const [printing, setPrinting] = useState(false);
  const s = receipt.snapshot;

  // Arriving from a payment prints the original once, and opens the drawer if any of it was cash. The page never waits for it.
  // `?print=1` is dropped from the address right away, so a reload or a restored tab does not print (and kick the drawer) again.
  useEffect(() => {
    if (!autoPrint || !hasReceiptPrinter || receipt.reversal || AUTO_PRINTED.has(receipt.paymentId)) return;
    AUTO_PRINTED.add(receipt.paymentId);
    const address = new URL(window.location.href);
    address.searchParams.delete('print');
    window.history.replaceState(window.history.state, '', `${address.pathname}${address.search}`);
    void printReceipt(receipt, receiptPrintOptions(false, receipt.legs)).then((result) => setProblem(result.ok ? null : { message: printFailureText(result, t), copy: false }));
  }, [autoPrint, hasReceiptPrinter, printReceipt, receipt, t]);

  const printPaper = async (copy: boolean) => {
    setPrinting(true);
    const result = await printReceipt(receipt, receiptPrintOptions(copy, receipt.legs));
    setPrinting(false);
    setProblem(result.ok ? null : { message: printFailureText(result, t), copy });
    if (copy && result.ok) await settle(() => logPosReprint({ paymentId: receipt.paymentId }));
  };
  return (
    <div className="mx-auto flex w-full max-w-[80mm] flex-col gap-3 px-4 py-6 print:max-w-none print:p-0">
      <header className="text-center">
        {receipt.business.name || receipt.business.address || receipt.business.phone || s.taxNumber ? (
          <div className="mb-2 flex flex-col text-sm text-muted" data-testid="receipt-business">
            {receipt.business.name ? <strong className="text-lg text-text" dir="auto">{receipt.business.name}</strong> : null}
            {receipt.business.address ? <span dir="auto">{receipt.business.address}</span> : null}
            {receipt.business.phone ? <span dir="ltr">{receipt.business.phone}</span> : null}
            {s.taxNumber ? <span dir="auto">{t('pos.receipt.taxNumber', { n: s.taxNumber })}</span> : null}
          </div>
        ) : null}
        <h1 className="text-lg font-semibold">{t('pos.receipt.heading', { n: formatNumber(receipt.orderNumber) })}</h1>
        <p className="text-sm text-muted">
          {receipt.tableNumber !== null ? `${t('pos.receipt.table', { n: formatNumber(receipt.tableNumber) })} · ` : ''}
          <time dateTime={new Date(receipt.paidAt).toISOString()}>{formatStamp(receipt.paidAt)}</time>
        </p>
        {receipt.cashierName ? <p className="text-sm text-muted">{receipt.cashierName}</p> : null}
        {receipt.queueNumber !== null && receipt.kind !== 'DINE_IN' ? (
          <p className="text-base font-semibold">{t(receipt.kind === 'DELIVERY' ? 'pos.receipt.kindDelivery' : 'pos.receipt.kindTakeaway', { n: formatNumber(receipt.queueNumber) })}</p>
        ) : null}
        {receipt.customer ? (
          <div className="mt-1 text-sm text-muted">
            {receipt.customer.name ? <p dir="auto">{receipt.customer.name}</p> : null}
            {receipt.customer.phone ? <p dir="ltr">{receipt.customer.phone}</p> : null}
            {receipt.kind === 'DELIVERY' ? (
              <>
                <p dir="auto">{[receipt.customer.zoneName, receipt.customer.address].filter(Boolean).join(' · ')}</p>
                {receipt.customer.addressNote ? <p dir="auto">{receipt.customer.addressNote}</p> : null}
                {receipt.customer.driverName ? <p>{t('pos.offp.driver')}: {receipt.customer.driverName}</p> : null}
              </>
            ) : null}
          </div>
        ) : null}
      </header>
      <ul className="flex flex-col gap-1 border-y border-dashed border-line-strong py-2 text-base">
        {s.lines.map((line) => (
          <li key={line.id} className="flex justify-between gap-3">
            <span>
              {formatNumber(line.quantity)} × {line.name}
              {line.options.length > 0 ? <span className="block text-sm text-muted">{line.options.map((o) => o.name).join(' · ')}</span> : null}
              {line.promoPerUnit > 0 ? (
                <span className="block text-sm text-muted">
                  {t('pos.requests.offer')} {money(-line.promoPerUnit * line.quantity)}
                </span>
              ) : null}
            </span>
            <span className="shrink-0">{money(line.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <dl className="flex flex-col gap-1 text-base">
        <Line label={t('pos.totals.subtotal')} value={money(s.subtotal)} />
        {s.invoiceDiscount > 0 ? <Line label={t('pos.totals.discount')} value={`− ${money(s.invoiceDiscount)}`} /> : null}
        {s.service > 0 ? <Line label={t('pos.totals.service')} value={money(s.service)} /> : null}
        {s.tax > 0 ? <Line label={t('pos.totals.tax')} value={money(s.tax)} /> : null}
        {s.deliveryFee > 0 ? <Line label={t('pos.totals.deliveryFee')} value={money(s.deliveryFee)} /> : null}
        {s.rounding !== 0 ? <Line label={t('pos.totals.rounding')} value={`${s.rounding > 0 ? '+' : '−'} ${money(Math.abs(s.rounding))}`} /> : null}
        <div className="flex justify-between text-lg font-semibold">
          <dt>{t('pos.totals.total')}</dt>
          <dd>{money(s.total)}</dd>
        </div>
        {receipt.legs.map((leg) => (
          <div key={leg.method} className="flex flex-col">
            <Line label={leg.method === 'CASH' ? t('pos.receipt.cash') : t(`pos.method.${leg.method}`)} value={leg.method === 'CASH_USD' && leg.tenderedUsd !== null ? t('pos.usd.amount', { n: formatNumber(leg.tenderedUsd) }) : money(leg.method === 'CASH' ? (leg.tendered ?? leg.amount) : leg.amount)} />
            {leg.reference ? (
              <div className="flex justify-between gap-3 text-muted" data-testid="receipt-reference">
                <dt>{t('pos.receipt.reference')}</dt>
                <dd dir="ltr">{leg.reference}</dd>
              </div>
            ) : null}
          </div>
        ))}
        {receipt.tip ? <Line label={`${t('pos.pay.tip')} · ${receipt.tip.method === 'CASH' ? t('pos.receipt.cash') : t(`pos.method.${receipt.tip.method}`)}`} value={money(receipt.tip.amount)} /> : null}
        {receipt.legs.some((leg) => leg.method === 'CASH' || leg.method === 'CASH_USD') ? <Line label={t('pos.pay.change')} value={money(receipt.change)} /> : null}
      </dl>
      {receipt.reversal ? (
        <div className="flex flex-col items-center gap-1 rounded-md border-2 border-danger p-2 text-center" data-testid="receipt-reversed">
          <strong className="text-lg tracking-wide text-danger">{t('pos.receipt.reversed')}</strong>
          <span className="text-base font-semibold">{money(receipt.reversal.amount)}</span>
          <span className="text-sm text-muted">{t('pos.receipt.reversedBy', { name: receipt.reversal.byName, time: formatStamp(receipt.reversal.at) })}</span>
          <span className="text-sm" dir="auto">{receipt.reversal.reason}</span>
          {receipt.reversal.reference ? <span className="text-sm text-muted" dir="ltr">{receipt.reversal.reference}</span> : null}
        </div>
      ) : null}
      <p className="text-center text-sm text-muted" dir="auto">{receipt.business.footer || t('pos.receipt.thanks')}</p>
      <div className="flex flex-col gap-2 print:hidden">
        {problem ? (
          <div role="alert" className="flex flex-col gap-2 rounded-md border-2 border-danger p-3 text-base">
            <span>{t('pos.print.failed', { message: problem.message })}</span>
            <Button variant="secondary" size="lg" className="min-h-12" disabled={printing} onClick={() => void printPaper(problem.copy)}>
              {t('pos.print.retry')}
            </Button>
          </div>
        ) : null}
        {receipt.parts.length > 1 ? (
          <nav className="flex flex-wrap gap-2" aria-label={t('pos.receipt.parts')}>
            {receipt.parts.map((p) => (
              <Link
                key={p.paymentId}
                href={`/pos/orders/${receipt.orderId}/receipt?part=${p.paymentId}`}
                aria-current={p.paymentId === receipt.paymentId ? 'page' : undefined}
                className={`inline-flex min-h-12 items-center rounded-md border px-4 text-base font-medium ${p.paymentId === receipt.paymentId ? 'border-ink bg-ink text-on-ink' : 'border-line-strong bg-raised'}`}
              >
                {t('pos.receipt.part', { n: formatNumber(p.part) })} · {money(p.total)}
              </Link>
            ))}
          </nav>
        ) : null}
        {canRefund && !receipt.reversal ? <ReverseButton orderId={receipt.orderId} paymentId={receipt.paymentId} version={receipt.orderVersion} total={receipt.snapshot.total} method={receipt.method as PosPaymentMethodKey} legs={receipt.legs} /> : null}
        {hasReceiptPrinter && !receipt.reversal ? (
          <Button variant="primary" size="lg" className="min-h-12" disabled={printing} onClick={() => void printPaper(true)}>
            {t('pos.print.copy')}
          </Button>
        ) : null}
        <Button variant={hasReceiptPrinter ? 'secondary' : 'primary'} size="lg" className="min-h-12" onClick={() => window.print()}>
          {t('pos.receipt.print')}
        </Button>
        <Link href={receipt.kind === 'DINE_IN' ? '/pos/tables' : `/pos/tables?area=${receipt.kind === 'DELIVERY' ? 'delivery' : 'takeaway'}`} className="inline-flex min-h-12 items-center justify-center rounded-md border border-line-strong text-base font-medium">
          {t('pos.receipt.back')}
        </Link>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-muted">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
