import type { Translate } from '@/lib/i18n';
import type { RouteTab } from '@/studio/ui/RouteTabs';

/** The Settings pages: the platform's general settings, the plans, and the products and their prices. */
export function settingsTabs(t: Translate): RouteTab[] {
  return [
    { href: '/studio/settings', label: t('settings.tabs.general'), exact: true },
    { href: '/studio/settings/plans', label: t('settings.tabs.plans') },
    { href: '/studio/settings/billing', label: t('settings.tabs.billing') },
    { href: '/studio/settings/ai', label: t('settings.tabs.ai') },
  ];
}
