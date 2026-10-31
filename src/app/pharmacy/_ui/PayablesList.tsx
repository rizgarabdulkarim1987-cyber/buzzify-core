'use client';

import { HandCoins, Info } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
import { useLocale, useT } from '@/studio/i18n';
import { buttonClasses } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { Amount, BandChip, InvoiceStatusChip, type BandName } from './money-status';
import { canPaySelected, selectionTotals, type OpenInvoice } from './purchasing-money-logic';

export interface PayableRowWire {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  currency: 'IQD' | 'USD';
  dueDate: string;
  status: 'OPEN' | 'PARTIAL';
  band: BandName;
  daysOverdue: number;
  balanceMinor?: string | undefined;
}

/**
 * The open invoices of the page, oldest due first, each linking to its invoice. When the person may pay, rows can be ticked:
 * "Pay selected" is offered for one supplier and one currency and opens the payment form with those invoices named; a
 * mixed selection says why it cannot go on, and the totals of the selection are kept apart per currency.
 */
export function PayablesList({ rows, canPay }: { rows: PayableRowWire[]; canPay: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const open = useMemo<(OpenInvoice & { row: PayableRowWire })[]>(
    () => rows.filter((r) => r.balanceMinor !== undefined).map((r) => ({ id: r.id, number: r.number, supplierId: r.supplierId, currency: r.currency, dueDate: r.dueDate, balanceMinor: BigInt(r.balanceMinor!), row: r })),
    [rows],
  );
  const pay = canPaySelected(open, selected);
  const totals = selectionTotals(open, selected);
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {canPay && (
        <div data-testid="pay-selected-bar" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
          <span role="status" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
            <span>{t('pharmacy.purchasing.m.pb.selected', { count: selected.size })}</span>
            {totals.map((g) => (
              <span key={g.currency}>
                <Amount amount={g.totalMinor} currency={g.currency} locale={locale} className="font-medium" />
              </span>
            ))}
          </span>
          {pay.ok ? (
            <Link
              href={`/pharmacy/purchasing/payments/new?supplier=${encodeURIComponent(pay.supplierId)}&currency=${pay.currency}&invoice=${pay.ids.map(encodeURIComponent).join(',')}`}
              data-testid="pay-selected"
              className={buttonClasses('primary', 'lg', 'min-h-11')}
            >
              <HandCoins aria-hidden />
              {t('pharmacy.purchasing.m.pb.paySelected')}
            </Link>
          ) : selected.size > 0 ? (
            <span data-testid="pay-selected-why" className="flex items-start gap-2 text-muted">
              <Info aria-hidden className="mt-px size-4 shrink-0" />
              {t(`pharmacy.purchasing.m.pb.why.${pay.reason}`)}
            </span>
          ) : (
            <span className="text-muted">{t('pharmacy.purchasing.m.pb.pickHint')}</span>
          )}
        </div>
      )}
      <ul aria-label={t('pharmacy.purchasing.m.pb.title')} className="flex flex-col border-t border-line">
        {rows.map((r) => (
          <li key={r.id} data-testid="payable-row" className="flex min-w-0 items-start gap-2 border-b border-line">
            {canPay && r.balanceMinor !== undefined && (
              <div className="flex min-h-11 min-w-11 items-center justify-center">
                <Checkbox aria-label={`${t('pharmacy.purchasing.m.pb.select')} ${r.number}`} checked={selected.has(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} data-testid="payable-check" />
              </div>
            )}
            <Link
              href={`/pharmacy/purchasing/invoices/${r.id}`}
              className="grid min-h-11 min-w-0 flex-1 grid-cols-1 gap-x-6 gap-y-1 rounded-sm px-1 py-3 hover:bg-hover md:grid-cols-[minmax(0,7rem)_minmax(0,2fr)_minmax(0,7rem)_minmax(0,9rem)_minmax(0,8rem)] md:items-center"
            >
              <span className="text-base font-medium text-text">
                <bdi dir="ltr" className="tabular-nums">
                  {r.number}
                </bdi>
              </span>
              <span dir="auto" className="min-w-0 break-words text-sm text-text [overflow-wrap:anywhere]">
                {r.supplierName}
              </span>
              <span className="text-sm text-text">
                <span className="text-muted md:sr-only">{t('pharmacy.purchasing.m.col.due')}: </span>
                <bdi dir="ltr">{phDate(`${r.dueDate}T00:00:00.000Z`, locale)}</bdi>
              </span>
              <span className="flex flex-wrap gap-1.5">
                <InvoiceStatusChip status={r.status} t={t} />
                <BandChip band={r.band} t={t} />
              </span>
              <span className="text-sm text-text md:text-end">{r.balanceMinor !== undefined && <Amount amount={r.balanceMinor} currency={r.currency} locale={locale} className="font-medium" />}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
