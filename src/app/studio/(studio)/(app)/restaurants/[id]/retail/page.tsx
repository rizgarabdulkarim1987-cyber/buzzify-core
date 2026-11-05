import type { Metadata } from 'next';
import { getActor } from '@/server/studio/auth/actor';
import { query } from '@/server/studio/framework/invoke';
import { retailDetail } from '@/server/studio/queries/retail';
import { formatDateTime, numberFormat } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { syncLabel } from '@/studio/retail-sync';
import { loadRestaurant } from '../load';
import { RetailPanel } from './RetailPanel';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const [{ id }, actor] = [await params, await getActor()];
  const restaurant = await loadRestaurant(id);
  return { title: `${getStudioTranslator(actor?.locale ?? 'en')('restaurants.tabs.retail')} · ${restaurant.name}` };
}

/**
 * A linked retail shop's delivery to Buzzify Retail: versions, what the last reconcile read, the last error, the AI
 * switch and Resync. Super Admins only (`retail.detail` needs `platform.settings`); anyone else, and any business that is
 * no retail shop, gets the not-found page. Only an owner of the shop is offered "Open Retails".
 */
export default async function RestaurantRetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  const restaurant = await loadRestaurant(id);
  const detail = await query(retailDetail, { restaurantId: restaurant.id });
  const locale = actor?.locale ?? 'en';
  const t = getStudioTranslator(locale);
  const number = numberFormat(locale, { maximumFractionDigits: 1 });
  const at = (date: Date | null) => (date ? formatDateTime(date.toISOString(), locale) : t('retail.panel.never'));
  const sync = syncLabel(detail.sync, t, locale);

  const facts = [
    { label: t('retail.panel.studioVersion'), value: number.format(detail.stateVersion) },
    { label: t('retail.panel.acceptedVersion'), value: number.format(detail.acceptedVersion) },
    { label: t('retail.panel.remoteVersion'), value: detail.remoteVersion === null ? t('retail.panel.never') : number.format(detail.remoteVersion) },
    { label: t('retail.panel.remoteStatus'), value: detail.remoteStatus ?? t('retail.panel.never') },
    { label: t('retail.panel.reconciledAt'), value: at(detail.reconciledAt) },
    { label: t('retail.panel.lastError'), value: detail.lastError ?? t('retail.panel.none') },
    { label: t('retail.panel.attempts'), value: number.format(detail.attempts) },
    { label: t('retail.panel.nextAttempt'), value: detail.sync.kind === 'retrying' || detail.sync.kind === 'queued' ? at(detail.nextAttemptAt) : t('retail.panel.none') },
    {
      label: t('retail.panel.aiUsage', { month: detail.aiUsage.month ?? '-' }),
      value: detail.aiUsage.units === null ? t('retail.panel.never') : number.format(detail.aiUsage.units),
    },
  ];

  return (
    <div className="px-8 py-6">
      <RetailPanel
        restaurantId={detail.id}
        syncText={sync.text}
        syncTone={sync.tone}
        permanentFailure={detail.sync.kind === 'failed' && detail.sync.permanent}
        notProvisioned={!detail.provisioned}
        facts={facts}
        aiIntake={detail.aiIntake}
        canSetAi={detail.can.aiIntake}
        canOpen={detail.isOwner}
      />
    </div>
  );
}
