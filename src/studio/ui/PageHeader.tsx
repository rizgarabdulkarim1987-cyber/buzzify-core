import type { ReactNode } from 'react';
import { cx } from './cx';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** The page's main actions, at the end of the title row. */
  actions?: ReactNode;
  /** A line above the title: the way back to the parent page, or badges about what the page shows. */
  above?: ReactNode;
  /** Tabs or filters that belong to the header, under it. */
  below?: ReactNode;
  className?: string;
}

/** A page's title row: the one `h1` of the page, a line of what it is for, and its actions. */
export function PageHeader({ title, description, actions, above, below, className }: PageHeaderProps) {
  return (
    <header className={cx('flex flex-col gap-4 px-8 pt-6', below ? 'pb-0' : 'pb-6', className)}>
      {above}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-semibold text-text">{title}</h1>
          {description && <p className="max-w-[72ch] text-base text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {below}
    </header>
  );
}
