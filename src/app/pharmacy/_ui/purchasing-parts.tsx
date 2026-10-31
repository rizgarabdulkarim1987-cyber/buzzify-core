import { Ban, CircleCheck, CircleDashed, Hourglass, PackageCheck, PencilLine, Send } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import { formatNumber } from '@/lib/pos-format';

export type OrderStatusName = 'DRAFT' | 'ORDERED' | 'PARTIAL' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';

const ICONS: Record<OrderStatusName, ReactNode> = {
  DRAFT: <PencilLine aria-hidden />,
  ORDERED: <Send aria-hidden />,
  PARTIAL: <Hourglass aria-hidden />,
  RECEIVED: <PackageCheck aria-hidden />,
  CLOSED: <CircleCheck aria-hidden />,
  CANCELLED: <Ban aria-hidden />,
};

/** An order's state: icon and word together, never a colour alone. */
export function OrderStatus({ status, t }: { status: OrderStatusName; t: Translate }) {
  return (
    <span
      data-chip={status}
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0 ${
        status === 'RECEIVED' ? 'border-transparent bg-success-wash text-success' : 'border-line-strong bg-surface text-text'
      }`}
    >
      {ICONS[status]}
      {t(`pharmacy.purchasing.po.status.${status}`)}
    </span>
  );
}

/**
 * One figure against its target as text and as a bar: "4 of 10" beside a filled track. The words carry the meaning; the
 * bar is a second reading, with a numeric role for assistive technology. Static, no motion.
 */
export function FigureBar({ label, value, of }: { label: string; value: number; of: number }) {
  const pct = of <= 0 ? 0 : Math.min(100, Math.round((value / of) * 100));
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm text-text">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">
          <bdi dir="ltr">
            {formatNumber(value)} / {formatNumber(of)}
          </bdi>
        </span>
      </p>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={of} aria-valuenow={Math.min(value, of)} className="h-2 w-full overflow-hidden rounded-sm border border-line-strong bg-surface">
        <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function NoneMark({ t }: { t: Translate }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted">
      <CircleDashed aria-hidden className="size-3.5 shrink-0" />
      {t('pharmacy.receive.none')}
    </span>
  );
}
