import { Ban, CircleCheck, PencilLine } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';

type Status = 'DRAFT' | 'CONFIRMED' | 'VOID';

const ICONS: Record<Status, ReactNode> = {
  DRAFT: <PencilLine aria-hidden />,
  CONFIRMED: <CircleCheck aria-hidden />,
  VOID: <Ban aria-hidden />,
};

/** A receipt's state: icon and word together, never a colour alone. */
export function ReceiptStatus({ status, t }: { status: Status; t: Translate }) {
  return (
    <span
      data-chip={status}
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0 ${
        status === 'CONFIRMED' ? 'border-transparent bg-success-wash text-success' : 'border-line-strong bg-surface text-text'
      }`}
    >
      {ICONS[status]}
      {t(`pharmacy.receive.status.${status}`)}
    </span>
  );
}
