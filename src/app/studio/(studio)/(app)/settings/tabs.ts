import type { Translate } from '@/lib/i18n';
import type { RouteTab } from '@/studio/ui/RouteTabs';

/** The Settings pages: the platform's general settings, and the plans. */
export function settingsTabs(t: Translate): RouteTab[] {
  return [
    { href: '/studio/settings', label: t('settings.tabs.general'), exact: true },
    { href: '/studio/settings/plans', label: t('settings.tabs.plans') },
  ];
}
