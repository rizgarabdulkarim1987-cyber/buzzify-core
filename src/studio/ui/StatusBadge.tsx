import type { ReactNode } from 'react';
import { cx } from './cx';

export type StatusTone = 'neutral' | 'success' | 'danger' | 'ink';

const TONES: Record<StatusTone, { badge: string; dot: string }> = {
  neutral: { badge: 'bg-surface text-muted border-line', dot: 'bg-muted' },
  success: { badge: 'bg-success-wash text-success border-transparent', dot: 'bg-success' },
  danger: { badge: 'bg-danger-wash text-danger border-transparent', dot: 'bg-danger' },
  ink: { badge: 'bg-ink text-on-ink border-transparent', dot: 'bg-on-ink' },
};

/**
 * A short state word with a dot: Published, Suspended, On. The colour repeats the word, it never replaces it. Success
 * green and danger red are the only colours; everything else is grey or black.
 */
export function StatusBadge({ tone = 'neutral', children, className }: { tone?: StatusTone; children: ReactNode; className?: string }) {
  const style = TONES[tone];
  return (
    <span
      className={cx(
        'inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-1.5 text-xs font-medium',
        style.badge,
        className,
      )}
    >
      <span aria-hidden className={cx('size-1.5 rounded-full', style.dot)} />
      {children}
    </span>
  );
}
