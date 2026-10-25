'use client';

import Link from 'next/link';
import { useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';

export type BoardArea = 'tables' | 'takeaway' | 'delivery';

/** Tables, takeaway and delivery as tabs of the board; only the kinds the restaurant takes are listed. */
export function OffPremiseTabs({ current, takeaway, delivery }: { current: BoardArea; takeaway: boolean; delivery: boolean }) {
  const t = useT();
  if (!takeaway && !delivery) return null;
  const tabs: { key: BoardArea; href: string; label: string }[] = [
    { key: 'tables', href: '/pos/tables', label: t('pos.offp.tabTables') },
    ...(takeaway ? [{ key: 'takeaway' as const, href: '/pos/tables?area=takeaway', label: t('pos.offp.tabTakeaway') }] : []),
    ...(delivery ? [{ key: 'delivery' as const, href: '/pos/tables?area=delivery', label: t('pos.offp.tabDelivery') }] : []),
  ];
  return (
    <nav aria-label={t('pos.offp.tabs')} className="flex gap-1 overflow-x-auto px-4 pb-3 sm:px-8">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={current === tab.key ? 'page' : undefined}
          className={cx(
            'inline-flex min-h-12 shrink-0 items-center rounded-md border px-5 text-base font-medium whitespace-nowrap',
            current === tab.key ? 'border-ink bg-ink text-on-ink' : 'border-line-strong text-text hover:bg-hover',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
