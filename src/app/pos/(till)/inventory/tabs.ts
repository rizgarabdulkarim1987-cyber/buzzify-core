import type { Translate } from '@/lib/i18n';
import { canPos, type PosRole } from '@/server/domain/pos/permissions';

/** The sections of the stock area this role may open. */
export function stockTabs(t: Translate, role: PosRole) {
  return [
    { key: 'items', href: '/pos/inventory', label: t('pos.stock.tab.items') },
    ...(canPos(role, 'inventory.manage')
      ? [
          { key: 'count', href: '/pos/inventory/count', label: t('pos.stock.tab.count') },
          { key: 'recipes', href: '/pos/inventory/recipes', label: t('pos.stock.tab.recipes') },
        ]
      : []),
  ];
}
