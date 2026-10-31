'use client';

import { CircleAlert, CircleCheck, Info, ListOrdered, SquarePen } from 'lucide-react';
import { useId } from 'react';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
import { useLocale, useT } from '@/studio/i18n';
import { Input } from '@/studio/ui/Input';
import { Amount } from './money-status';
import type { AllocationMode, AllocationPreview, OpenInvoice } from './purchasing-money-logic';

/** A serialisable open invoice (amounts as minor-unit strings) and its BigInt form for the logic. */
export interface OpenInvoiceWire {
  id: string;
  number: string;
  supplierId: string;
  currency: 'IQD' | 'USD';
  dueDate: string;
  balanceMinor: string;
}

export const openInvoiceOf = (w: OpenInvoiceWire): OpenInvoice => ({ ...w, balanceMinor: BigInt(w.balanceMinor) });

const RADIO = 'flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-2.5 rounded-md border border-line-strong bg-raised p-3 text-sm text-text has-[:checked]:border-ink has-[:checked]:bg-surface';

/**
 * Where a payment or a credit goes: oldest due first (automatic, with the result shown) or typed per invoice with each
 * balance beside it. The leftover and the refusal are written out; nothing relies on colour. Shared by payment and credit.
 */
export function AllocationFields({
  invoices,
  currency,
  mode,
  explicit,
  preview,
  onMode,
  onExplicit,
  disabled,
  error,
}: {
  invoices: OpenInvoice[];
  currency: 'IQD' | 'USD';
  mode: AllocationMode;
  explicit: Record<string, string>;
  preview: AllocationPreview;
  onMode: (mode: AllocationMode) => void;
  onExplicit: (invoiceId: string, value: string) => void;
  disabled?: boolean;
  /** Translated words for the problem with the parts, from the form. */
  error?: string | undefined;
}) {
  const t = useT();
  const { locale } = useLocale();
  const name = useId();
  const sorted = [...invoices].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.id < b.id ? -1 : 1));
  const placed = new Map(preview.rows.map((r) => [r.invoiceId, r.amountMinor]));
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1 text-sm font-medium text-text">{t('pharmacy.purchasing.m.alloc.title')}</legend>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className={RADIO}>
          <input type="radio" name={name} checked={mode === 'auto'} onChange={() => onMode('auto')} className="mt-0.5 size-4 shrink-0" data-testid="alloc-auto" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-1.5 font-medium">
              <ListOrdered aria-hidden className="size-4 shrink-0" />
              {t('pharmacy.purchasing.m.alloc.auto')}
            </span>
            <span className="text-muted">{t('pharmacy.purchasing.m.alloc.autoHint')}</span>
          </span>
        </label>
        <label className={RADIO}>
          <input type="radio" name={name} checked={mode === 'explicit'} onChange={() => onMode('explicit')} className="mt-0.5 size-4 shrink-0" data-testid="alloc-explicit" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-1.5 font-medium">
              <SquarePen aria-hidden className="size-4 shrink-0" />
              {t('pharmacy.purchasing.m.alloc.explicit')}
            </span>
            <span className="text-muted">{t('pharmacy.purchasing.m.alloc.explicitHint')}</span>
          </span>
        </label>
      </div>
      {sorted.length === 0 ? (
        <p data-testid="alloc-none" className="flex items-start gap-2.5 text-sm text-muted">
          <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
          {t('pharmacy.purchasing.m.alloc.none')}
        </p>
      ) : (
        <ol aria-label={t('pharmacy.purchasing.m.alloc.title')} className="flex flex-col border-t border-line">
          {sorted.map((inv) => {
            const part = placed.get(inv.id);
            return (
              <li key={inv.id} data-testid="alloc-row" className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 border-b border-line py-2 text-sm text-text sm:grid-cols-[minmax(0,1fr)_minmax(0,8rem)_minmax(0,9rem)_minmax(0,9rem)] sm:items-center">
                <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                  <bdi dir="ltr">{inv.number}</bdi>
                </span>
                <span>
                  <span className="text-muted">{t('pharmacy.purchasing.m.col.due')}: </span>
                  <bdi dir="ltr">{phDate(`${inv.dueDate}T00:00:00.000Z`, locale)}</bdi>
                </span>
                <span>
                  <span className="text-muted">{t('pharmacy.purchasing.m.alloc.remaining')}: </span>
                  <Amount amount={inv.balanceMinor} currency={currency} locale={locale} />
                </span>
                {mode === 'explicit' ? (
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="sr-only">
                      {t('pharmacy.purchasing.m.alloc.part')} {inv.number}
                    </span>
                    <Input className="min-h-11" dir="ltr" inputMode="decimal" autoComplete="off" data-testid="alloc-part" aria-label={`${t('pharmacy.purchasing.m.alloc.part')} ${inv.number}`} value={explicit[inv.id] ?? ''} onChange={(e) => onExplicit(inv.id, e.target.value)} />
                  </label>
                ) : (
                  <span className="text-end">{part !== undefined ? <Amount amount={part} currency={currency} locale={locale} className="font-medium" /> : <span className="text-muted">—</span>}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p role="status" data-testid="alloc-status" className={`flex items-start gap-2.5 text-sm ${preview.error && preview.error !== 'AMOUNT' ? 'text-danger' : 'text-text'}`}>
        {preview.error && preview.error !== 'AMOUNT' ? <CircleAlert aria-hidden className="mt-px size-4 shrink-0" /> : preview.error === 'AMOUNT' ? <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" /> : <CircleCheck aria-hidden className="mt-px size-4 shrink-0 text-muted" />}
        <span className="min-w-0">
          {error ??
            (preview.error && preview.error !== 'AMOUNT'
              ? t(`pharmacy.purchasing.m.alloc.err.${preview.error}`)
              : preview.error === 'AMOUNT'
                ? t('pharmacy.purchasing.m.alloc.typeAmount')
                : t('pharmacy.purchasing.m.alloc.ok'))}
          {preview.leftoverMinor > 0n && (
            <>
              {' '}
              {t('pharmacy.purchasing.m.alloc.leftover')}: <Amount amount={preview.leftoverMinor} currency={currency} locale={locale} className="font-medium" />
            </>
          )}
        </span>
      </p>
    </fieldset>
  );
}
