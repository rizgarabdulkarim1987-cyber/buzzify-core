import { AlarmClock, Ban, CalendarCheck, CalendarClock, CircleCheck, FileText, Hourglass, RotateCcw, TriangleAlert, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import { formatPhMoney } from '@/server/domain/pharmacy/money';

export type InvoiceStatusName = 'OPEN' | 'PARTIAL' | 'PAID' | 'VOID';
export type BandName = 'NOT_DUE' | 'DUE_7' | 'OVERDUE_1_30' | 'OVERDUE_31_60' | 'OVERDUE_60_PLUS';

const CHIP = 'inline-flex min-h-6 items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0';

const STATUS_ICON: Record<InvoiceStatusName, ReactNode> = {
  OPEN: <FileText aria-hidden />,
  PARTIAL: <Hourglass aria-hidden />,
  PAID: <CircleCheck aria-hidden />,
  VOID: <Ban aria-hidden />,
};

/** An invoice's state: icon and word together, never a colour alone. */
export function InvoiceStatusChip({ status, t }: { status: InvoiceStatusName; t: Translate }) {
  return (
    <span
      data-chip={status}
      className={`${CHIP} ${status === 'PAID' ? 'border-transparent bg-success-wash text-success' : status === 'VOID' ? 'border-transparent bg-danger-wash text-danger' : 'border-line-strong bg-surface text-text'}`}
    >
      {STATUS_ICON[status]}
      {t(`pharmacy.purchasing.m.status.${status}`)}
    </span>
  );
}

const BAND_ICON: Record<BandName, ReactNode> = {
  NOT_DUE: <CalendarCheck aria-hidden />,
  DUE_7: <CalendarClock aria-hidden />,
  OVERDUE_1_30: <AlarmClock aria-hidden />,
  OVERDUE_31_60: <TriangleAlert aria-hidden />,
  OVERDUE_60_PLUS: <TriangleAlert aria-hidden />,
};

/** How near or late the due date is: icon and words. */
export function BandChip({ band, t }: { band: BandName; t: Translate }) {
  const late = band.startsWith('OVERDUE');
  return (
    <span data-band={band} className={`${CHIP} ${late ? 'border-transparent bg-danger-wash text-danger' : 'border-line-strong bg-surface text-text'}`}>
      {BAND_ICON[band]}
      {t(`pharmacy.purchasing.m.band.${band}`)}
    </span>
  );
}

/** A payment row's state: a plain payment shows nothing, a reversed one and a reversal row say so. */
export function PaymentChip({ reversed, isReversal, t }: { reversed: boolean; isReversal: boolean; t: Translate }) {
  if (!reversed && !isReversal) return null;
  return (
    <span data-chip={isReversal ? 'REVERSAL' : 'REVERSED'} className={`${CHIP} border-transparent bg-danger-wash text-danger`}>
      {isReversal ? <RotateCcw aria-hidden /> : <Undo2 aria-hidden />}
      {t(isReversal ? 'pharmacy.purchasing.m.pay.reversalRow' : 'pharmacy.purchasing.m.pay.reversed')}
    </span>
  );
}

/** An amount in the person's language with the currency; never a Float. */
export function moneyText(amount: string | bigint, currency: 'IQD' | 'USD', locale: Locale): string {
  try {
    return formatPhMoney({ amount: typeof amount === 'bigint' ? amount : BigInt(amount), currency }, locale);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function Amount({ amount, currency, locale, className }: { amount: string | bigint | undefined; currency: 'IQD' | 'USD'; locale: Locale; className?: string }) {
  if (amount === undefined) return null;
  return (
    <bdi dir="ltr" className={`tabular-nums ${className ?? ''}`}>
      {moneyText(amount, currency, locale)}
    </bdi>
  );
}
