'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { TillPageKey } from '@/server/domain/pos/nav';
import { useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';

/** The till's pages for the signed-in role, as a row of large touch targets. The page being shown is marked. */
export function TillNav({ items }: { items: ReadonlyArray<{ key: TillPageKey; href: string }> }) {
  const t = useT();
  const path = usePathname();
  if (items.length < 2) return null;
  return (
    <nav aria-label={t('pos.nav.label')} className="flex gap-1 overflow-x-auto border-b border-line px-4 py-1.5 sm:px-8">
      {items.map((item) => {
        const current = path === item.href || path.startsWith(`${item.href}/`) || (item.key === 'tables' && path.startsWith('/pos/orders'));
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={current ? 'page' : undefined}
            className={cx(
              'inline-flex min-h-11 shrink-0 items-center rounded-md px-4 text-base font-medium whitespace-nowrap',
              current ? 'bg-ink text-on-ink' : 'text-text hover:bg-hover',
            )}
          >
            {t(`pos.nav.${item.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
