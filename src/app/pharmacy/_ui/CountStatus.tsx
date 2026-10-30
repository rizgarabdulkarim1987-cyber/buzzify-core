import { CircleCheck, CircleX, ClipboardPen, Hourglass } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import type { CountSummary } from '@/server/pharmacy/counts';

const ICONS: Record<CountSummary['status'], ReactNode> = {
  OPEN: <ClipboardPen aria-hidden />,
  SUBMITTED: <Hourglass aria-hidden />,
  APPROVED: <CircleCheck aria-hidden />,
  CANCELLED: <CircleX aria-hidden />,
};

/** A count's state: icon and word together, never a colour alone. */
export function CountStatus({ status, t }: { status: CountSummary['status']; t: Translate }) {
  return (
    <span
      data-status={status}
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0 ${
        status === 'APPROVED' ? 'border-transparent bg-success-wash text-success' : 'border-line-strong bg-surface text-text'
      }`}
    >
      {ICONS[status]}
      {t(`pharmacy.counts.status.${status}`)}
    </span>
  );
}
