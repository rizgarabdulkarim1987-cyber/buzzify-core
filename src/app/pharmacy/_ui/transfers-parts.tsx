import { ArrowRight, Ban, CircleAlert, CircleCheck, Clock, Truck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import { statusChip, type StatusIcon, type TransferStatus } from './transfers-logic';

const ICONS: Record<StatusIcon, ReactNode> = {
  clock: <Clock aria-hidden />,
  truck: <Truck aria-hidden />,
  check: <CircleCheck aria-hidden />,
  alert: <CircleAlert aria-hidden />,
  ban: <Ban aria-hidden />,
};

/** A transfer's state: icon and word together, never a colour alone. */
export function TransferStatusChip({ status, t }: { status: TransferStatus; t: Translate }) {
  const chip = statusChip(status);
  return (
    <span
      data-chip={status}
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0 ${
        status === 'RECEIVED' ? 'border-transparent bg-success-wash text-success' : status === 'PARTIAL' ? 'border-transparent bg-danger-wash text-danger' : 'border-line-strong bg-surface text-text'
      }`}
    >
      {ICONS[chip.icon]}
      {t(chip.key)}
    </span>
  );
}

/** What is waiting for the person: a word and an icon beside the row, never only a colour. */
export function TurnChip({ action, t }: { action: 'send' | 'receive'; t: Translate }) {
  return (
    <span data-turn={action} className="inline-flex min-h-6 items-center gap-1.5 rounded-sm border border-ink bg-raised px-1.5 py-0.5 text-xs font-semibold text-text [&_svg]:size-3.5 [&_svg]:shrink-0">
      <CircleAlert aria-hidden />
      {t(`pharmacy.transfers.turn.${action}`)}
    </span>
  );
}

/** `From -> To` with the arrow turned for right-to-left. The names are isolated so they never reorder the arrow. */
export function Route({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <bdi dir="auto" className="min-w-0 break-words [overflow-wrap:anywhere]">
        {from}
      </bdi>
      <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted rtl:rotate-180" />
      <bdi dir="auto" className="min-w-0 break-words [overflow-wrap:anywhere]">
        {to}
      </bdi>
    </span>
  );
}
