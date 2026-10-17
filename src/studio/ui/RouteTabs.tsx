'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from './cx';

export interface RouteTab {
  href: string;
  label: string;
  /** Only this exact path selects the tab (the first tab, whose path starts the others). */
  exact?: boolean;
}

/**
 * Tabs that are pages: each is a link with its own address, so a tab can be bookmarked, opened in a new window and
 * reached with Back. The current one carries the amber marker and `aria-current="page"`. Tabs a person may not use are
 * left out by the caller, never shown disabled.
 */
export function RouteTabs({ tabs, label, className }: { tabs: readonly RouteTab[]; label: string; className?: string }) {
  const pathname = usePathname();
  const isCurrent = (tab: RouteTab) => (tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`));

  return (
    <nav aria-label={label} className={cx('border-b border-line', className)}>
      <ul className="-mb-px flex gap-6 overflow-x-auto">
        {tabs.map((tab) => {
          const current = isCurrent(tab);
          return (
            <li key={tab.href} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={current ? 'page' : undefined}
                className={cx(
                  'inline-flex h-10 items-center border-b-2 text-base transition-colors duration-150',
                  current ? 'border-accent font-medium text-text' : 'border-transparent text-muted hover:text-text',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
