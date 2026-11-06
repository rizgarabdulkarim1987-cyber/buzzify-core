'use client';

import type { ReactNode } from 'react';
import { useT } from '@/studio/i18n';
import { formatMinor, unitOf, type CartLine, type Currency, type Estimate } from '../sell-logic';
import { Num } from '../sell-parts';

/**
 * The current-line bar of layout A (`.cur`), between the scan block and the lines: the selected line's name, quantity, unit price
 * and its total after its discount; with no line selected it asks to pick or scan one. Read only (the line is changed in the
 * table, with the keypad or the keys). One row that wraps on a narrow screen.
 */
export function CurrentLine({ line, result, currency }: { line: CartLine | null; result: Estimate['lines'][number] | undefined; currency: Currency }) {
  const t = useT();
  const unit = line ? unitOf(line) : null;
  const priced = result !== undefined && !result.unpriced && !result.invalid;
  const fig = (label: string, value: ReactNode, testId: string) => (
    <span className="flex items-baseline gap-1.5" data-testid={testId}>
      <span className="text-xs text-ph-muted">{label}</span>
      <b className="text-base tabular-nums text-ph-text">{value}</b>
    </span>
  );
  return (
    <div className="flex min-h-11 min-w-0 shrink-0 flex-wrap items-baseline gap-x-3.5 gap-y-1 rounded-ph-xl border border-ph-line bg-ph-amber-wash px-3.5 py-2" role="status" aria-label={t('pharmacy.cashier.current.region')} data-testid="current-line">
      {!line || !unit ? (
        <b className="text-base text-ph-text">{t('pharmacy.cashier.current.empty')}</b>
      ) : (
        <>
          <b className="min-w-0 flex-1 basis-48 truncate text-base text-ph-text" dir="auto" title={line.name}>
            {line.name}
          </b>
          {fig(t('pharmacy.cashier.col.qty'), <Num>{line.qty}</Num>, 'current-qty')}
          {fig(t('pharmacy.cashier.col.price'), unit.priceMinor === null ? '—' : <Num>{formatMinor(BigInt(unit.priceMinor), currency)}</Num>, 'current-price')}
          {fig(t('pharmacy.cashier.col.total'), priced ? <Num>{formatMinor(result.totalMinor, currency)}</Num> : '—', 'current-total')}
        </>
      )}
    </div>
  );
}
