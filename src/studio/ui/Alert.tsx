import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './cx';

export type AlertTone = 'danger' | 'success' | 'neutral';

const TONES: Record<AlertTone, { box: string; icon: ReactNode }> = {
  danger: { box: 'bg-danger-wash text-danger', icon: <CircleAlert aria-hidden /> },
  success: { box: 'bg-success-wash text-success', icon: <CircleCheck aria-hidden /> },
  neutral: { box: 'bg-surface text-text border border-line', icon: <Info aria-hidden className="text-muted" /> },
};

/**
 * A sentence about the whole form or page: why a submit failed, or what just happened. A failure is announced at once
 * (`role="alert"`); other notes politely.
 */
export function Alert({ tone = 'neutral', children, className }: { tone?: AlertTone; children: ReactNode; className?: string }) {
  const style = TONES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('flex items-start gap-2.5 rounded-md px-3 py-2.5 text-sm [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0', style.box, className)}
    >
      {style.icon}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
