'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, ChefHat, FileText, Inbox, LayoutGrid, Map as MapIcon, MessageSquareWarning, Package, QrCode, Settings, ShieldAlert, ShoppingCart, Sparkles, Truck, Users, Wallet, type LucideIcon } from 'lucide-react';
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
  activity: ShieldAlert,
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

/**
 * The till's pages for the signed-in role. `top` is the row of touch targets under the header from lg up; `bottom` is the
 * phone's tab bar, pinned to the thumb (and left out on an order, which has its own pay bar). The page being shown is marked.
 */
export function TillNav({ items, className, variant }: { items: ReadonlyArray<{ key: TillPageKey; href: string; badge?: number }>; className?: string; variant: 'top' | 'bottom' }) {
  const t = useT();
  const path = usePathname();
  if (items.length < 2) return null;
  const bottom = variant === 'bottom';
  if (bottom && path.startsWith('/pos/orders')) return null;
  return (
    <nav
      aria-label={t('pos.nav.label')}
      className={cx(
        'print:hidden flex overflow-x-auto [scrollbar-width:none]',
        bottom ? 'sticky bottom-0 z-30 gap-0.5 border-t border-line bg-surface px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:hidden' : 'hidden gap-1 lg:flex',
        className,
      )}
    >
      {items.map((item) => {
        const current = path === item.href || path.startsWith(`${item.href}/`) || (item.key === 'tables' && path.startsWith('/pos/orders'));
        const Icon = ICONS[item.key];
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={current ? 'page' : undefined}
            className={cx(
              'relative inline-flex shrink-0 items-center whitespace-nowrap',
              bottom ? 'min-h-14 min-w-[4.75rem] flex-1 flex-col justify-center gap-0.5 rounded-xl px-2 text-xs font-semibold' : 'min-h-11 gap-2 rounded-xl px-3 text-base font-medium',
              current ? 'bg-hover text-text shadow-[inset_0_0_0_1px_var(--s-line)]' : bottom ? 'text-muted' : 'text-text hover:bg-hover',
            )}
          >
            <Icon aria-hidden size={bottom ? 22 : 18} className="shrink-0" />
            {t(`pos.nav.${item.key}`)}
            {item.badge ? (
              <span
                className={cx(
                  'inline-flex items-center justify-center rounded-full bg-info font-semibold text-on-status',
                  bottom ? 'absolute end-2 top-0.5 min-h-5 min-w-5 px-1 text-xs' : 'ms-1 min-h-6 min-w-6 px-1.5 text-sm',
                )}
              >
                {formatNumber(item.badge)}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
