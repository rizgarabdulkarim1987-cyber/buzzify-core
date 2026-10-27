import { Lock } from 'lucide-react';
import type { Translate } from '@/lib/i18n';

/** Why the receiving controls are not there: the reason in words with a lock. The screens draw no save or confirm control meanwhile. */
export function ReceiveBlocked({ reason, t }: { reason: 'readOnly' | 'role' | 'support'; t: Translate }) {
  return (
    <p data-testid="receive-write-blocked" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
      <Lock aria-hidden className="text-muted" />
      <span className="min-w-0">{t(`pharmacy.receive.blocked.${reason}`)}</span>
    </p>
  );
}
