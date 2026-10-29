import type { Translate } from '@/lib/i18n';
import type { MenuProductView } from '@/server/data/menu-view';

/**
 * "340 orders · 1,200 views" in the guest's language (docs/superpowers/specs/2026-10-30-menu-dish-counts-design.md). `n` writes a number in the
 * menu's digits; the message picks the language's plural form from `count`. A dish nobody opened yet shows its orders alone, never "0 views".
 */
export function dishCountsText(counts: NonNullable<MenuProductView['counts']>, t: Translate, n: (value: number) => string): string {
  const parts = [t('menu.orderCount', { count: counts.orders, n: n(counts.orders) })];
  if (counts.views > 0) parts.push(t('menu.viewCount', { count: counts.views, n: n(counts.views) }));
  return parts.join(' · ');
}
