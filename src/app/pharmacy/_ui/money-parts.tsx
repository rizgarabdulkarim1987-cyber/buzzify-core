import { Ban, CircleCheck, DoorClosed, DoorOpen, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import { Chip, Num } from './sell-parts';
import { formatMinor, type Currency } from './sell-logic';

/** An amount in reading order inside any sentence: Latin digits, grouped, with its currency. */
export function Money({ minor, currency, signed = false }: { minor: string | bigint; currency: Currency; signed?: boolean }) {
  const value = typeof minor === 'bigint' ? minor : BigInt(minor);
  return (
    <>
      <Num>
        {signed && value > 0n ? '+' : ''}
        {formatMinor(value, currency)}
      </Num>{' '}
      {currency}
    </>
  );
}

/** A definition list row: the label and its value, wrapping on a phone. */
export function Row({ label, children, testId, strong = false }: { label: ReactNode; children: ReactNode; testId?: string; strong?: boolean }) {
  return (
    <>
      <dt className={strong ? 'font-semibold text-text' : 'text-muted'}>{label}</dt>
      <dd data-testid={testId} className={`text-end ${strong ? 'font-semibold' : ''}`}>
        {children}
      </dd>
    </>
  );
}

export const FIGURES = 'grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm text-text';

const SALE_STATUS_ICON: Record<string, ReactNode> = {
  COMPLETED: <CircleCheck aria-hidden />,
  RETURNED_PARTIAL: <Undo2 aria-hidden />,
  RETURNED_FULL: <Ban aria-hidden />,
  HELD: <DoorClosed aria-hidden />,
  HOLD_EXPIRED: <Ban aria-hidden />,
};

/** A sale's status in words and an icon. */
export function SaleStatus({ status, t }: { status: string; t: Translate }) {
  return (
    <Chip icon={SALE_STATUS_ICON[status] ?? <CircleCheck aria-hidden />} tone={status === 'RETURNED_FULL' || status === 'HOLD_EXPIRED' ? 'danger' : 'plain'} testId={`sale-status-${status}`}>
      {t(`pharmacy.sales.status.${status}`)}
    </Chip>
  );
}

export function ShiftStatus({ status, t }: { status: 'OPEN' | 'CLOSED'; t: Translate }) {
  return (
    <Chip icon={status === 'OPEN' ? <DoorOpen aria-hidden /> : <DoorClosed aria-hidden />} testId={`shift-status-${status}`}>
      {t(`pharmacy.shifts.status.${status}`)}
    </Chip>
  );
}
