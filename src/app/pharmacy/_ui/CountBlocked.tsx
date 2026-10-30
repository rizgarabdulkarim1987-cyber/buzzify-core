import { Lock } from 'lucide-react';
import type { Translate } from '@/lib/i18n';

/** Why the counting controls are not there: the reason in words with a lock. */
export function CountBlocked({ reason, t }: { reason: 'readOnly' | 'role' | 'support'; t: Translate }) {
  return (
    <p data-testid="count-write-blocked" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
      <Lock aria-hidden className="text-muted" />
      <span className="min-w-0">{t(`pharmacy.counts.blocked.${reason}`)}</span>
    </p>
  );
}
