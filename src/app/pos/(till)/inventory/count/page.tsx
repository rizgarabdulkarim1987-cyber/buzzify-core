import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { canPos } from '@/server/domain/pos/permissions';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posInventoryItems } from '@/server/studio/queries/pos-inventory';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { CountSheet } from '@/app/pos/_ui/stock/InventoryForms';
import { SectionTabs } from '@/app/pos/_ui/stock/view';
import { stockTabs } from '../tabs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.stock.tab.count') };
}

/** Counting the shelves: each counted item gets one movement for the difference. Needs `inventory.manage`. */
export default async function StockCountPage() {
  const [access, locale] = await Promise.all([getPosAccess(), requestStudioLocale()]);
  if (!access.actor || !canPos(access.actor.role, 'inventory.manage')) notFound();
  const t = getStudioTranslator(locale);
  const items = await query(posInventoryItems, {});
  return (
    <>
      <PageHeader title={t('pos.stock.tab.count')} description={t('pos.stock.countIntro')} />
      <SectionTabs label={t('pos.stock.sections')} current="count" items={stockTabs(t, access.actor?.role ?? 'CASHIER')} />
      <div className="px-8 pb-8">
        <CountSheet items={items.map((item) => ({ id: item.id, name: item.name, unit: item.unit, onHand: item.onHand }))} />
      </div>
    </>
  );
}
