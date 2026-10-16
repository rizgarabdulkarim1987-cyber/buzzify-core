import type { ReactNode } from 'react';
import { cx } from './cx';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  /** What fills this place, and how to start. */
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** What a list or page shows before it has anything: what will be here, and the first step. */
export function EmptyState({ icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-start gap-3 py-10', className)}>
      {icon && (
        <span className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-surface text-muted [&_svg]:size-4">
          {icon}
        </span>
      )}
      <div className="flex max-w-[56ch] flex-col gap-1">
        <p className="text-md font-medium text-text">{title}</p>
        {body && <p className="text-base text-muted">{body}</p>}
      </div>
      {action}
    </div>
  );
}
