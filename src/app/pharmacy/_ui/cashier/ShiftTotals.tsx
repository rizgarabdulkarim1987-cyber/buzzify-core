'use client';

import { useT } from '@/studio/i18n';
import type { ShiftLine } from '@/server/pharmacy/pulse-shift';
import { formatMinor, type Currency } from '../sell-logic';
import { Num } from '../sell-parts';

/**
 * The footer line of layout A: the shift's cash, credit and card with their counts and the returns (with a minus), from the header's
 * pulse (`ph.pulse`, read again after each sale). Transfer shows only when the shift has one (the prototype has no transfer). One
 * line of small text that wraps; nothing to press.
 */
export function ShiftTotals({ line, currency }: { line: ShiftLine; currency: Currency }) {
  const t = useT();
  const money = (minor: string) => <Num>{formatMinor(/^-?\d+$/.test(minor) ? BigInt(minor) : 0n, currency)}</Num>;
  const part = (key: string, figure: ShiftLine['cash'], minus = false) => (
    <span key={key}>
      {t(`pharmacy.cashier.footer.${key}`, { count: figure.count })}{' '}
      <b className="tabular-nums text-ph-text">
        {minus && '-'}
        {money(figure.amountMinor)}
      </b>
    </span>
  );
  return (
    <p className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-[18px] gap-y-1 rounded-ph-xl border border-ph-line bg-ph-card px-3 py-1.5 text-xs text-ph-muted" data-testid="shift-totals">
      <span>
        {t('pharmacy.cashier.footer.region')} — {part('cash', line.cash)}
      </span>
      {part('credit', line.credit)}
      {part('card', line.card)}
      {line.transfer.count > 0 && part('transfer', line.transfer)}
      {part('returns', line.returns, true)}
    </p>
  );
}
