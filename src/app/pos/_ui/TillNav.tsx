'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, ChefHat, FileText, Inbox, LayoutGrid, Map as MapIcon, MessageSquareWarning, Package, QrCode, Settings, ShoppingCart, Sparkles, Truck, Users, Wallet, type LucideIcon } from 'lucide-react';
import { formatNumber } from '@/lib/pos-format';
import type { TillPageKey } from '@/server/domain/pos/nav';
import { useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';

const ICONS: Record<TillPageKey, LucideIcon> = {
  tables: LayoutGrid,
  requests: Inbox,
  shift: Wallet,
  kitchen: ChefHat,
  report: FileText,
  ai: Sparkles,
  inventory: Package,
  purchases: ShoppingCart,
  complaints: MessageSquareWarning,
  floor: MapIcon,
  catalog: BookOpen,
  staff: Users,
  qr: QrCode,
  delivery: Truck,
  settings: Settings,
};

/** The till's pages for the signed-in role, as a row of large touch targets with their icons. The page being shown is marked. */
export function TillNav({ items, className }: { items: ReadonlyArray<{ key: TillPageKey; href: string; badge?: number }>; className?: string }) {
  const t = useT();
  const path = usePathname();
  if (items.length < 2) return null;
  return (
    <nav aria-label={t('pos.nav.label')} className={cx('print:hidden flex gap-1 overflow-x-auto [scrollbar-width:none]', className)}>
      {items.map((item) => {
        const current = path === item.href || path.startsWith(`${item.href}/`) || (item.key === 'tables' && path.startsWith('/pos/orders'));
        const Icon = ICONS[item.key];
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={current ? 'page' : undefined}
            className={cx(
              'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-base font-medium whitespace-nowrap',
              current ? 'bg-hover text-text shadow-[inset_0_0_0_1px_var(--s-line)]' : 'text-text hover:bg-hover',
            )}
          >
            <Icon aria-hidden size={18} className="shrink-0" />
            {t(`pos.nav.${item.key}`)}
            {item.badge ? (
              <span className="ms-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full bg-info px-1.5 text-sm font-semibold text-on-status">{formatNumber(item.badge)}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
