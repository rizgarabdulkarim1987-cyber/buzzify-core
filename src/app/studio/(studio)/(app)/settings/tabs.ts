import type { Translate } from '@/lib/i18n';
import type { RouteTab } from '@/studio/ui/RouteTabs';

/** The Menu and Cashier settings pages: the plans, the products and their prices, and the AI. The platform's general settings live in the Platform space. */
export function settingsTabs(t: Translate): RouteTab[] {
  return [
    { href: '/studio/settings/plans', label: t('settings.tabs.plans') },
    { href: '/studio/settings/billing', label: t('settings.tabs.billing') },
    { href: '/studio/settings/ai', label: t('settings.tabs.ai') },
  ];
}
