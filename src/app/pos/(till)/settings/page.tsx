import type { Metadata } from 'next';
import { getPosAccess } from '@/server/pos/actor';
import { currentCashierSubscription, currentDevice } from '@/server/pos/device-session';
import { query } from '@/server/studio/framework/invoke';
import { posSettings } from '@/server/studio/queries/pos';
import { posDevices } from '@/server/studio/queries/pos-pin';
import { formatStamp } from '@/lib/pos-format';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { DevicesSection } from './DevicesSection';
import { SettingsForm } from './SettingsForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.settings.title') };
}

/** How the restaurant's till charges and takes payment. A role without `settings.manage` gets the 404 page. */
export default async function PosSettingsPage() {
  const [settings, devices, access, locale] = await Promise.all([query(posSettings, {}), query(posDevices, {}), getPosAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const [subscription, own] = await Promise.all([
    access.actor ? currentCashierSubscription(access.actor.restaurantId) : null,
    currentDevice(),
  ]);
  const thisDeviceId = own && own.restaurantId === access.actor?.restaurantId ? own.id : null;
  return (
    <>
      <PageHeader title={t('pos.settings.title')} description={t('pos.settings.intro')} />
      <div className="flex flex-col gap-8 px-8 pb-8">
        <p className="text-sm text-muted">
          <span className="font-semibold text-text">{t('pos.settings.subscription')}: </span>
          {subscription
            ? t('pos.settings.subscriptionState', { state: t(`pos.settings.state.${subscription.state}`), date: formatStamp(subscription.until).slice(0, 10) })
            : t('pos.settings.subscriptionNone')}
        </p>
        <SettingsForm settings={settings} />
        <DevicesSection devices={devices} thisDeviceId={thisDeviceId} />
      </div>
    </>
  );
}
