import type { Metadata } from 'next';
import Link from 'next/link';
import { baghdadDayOf } from '@/lib/baghdad';
import { query } from '@/server/studio/framework/invoke';
import { posInventoryItems, posSuppliers } from '@/server/studio/queries/pos-inventory';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { SectionTabs } from '@/app/pos/_ui/stock/view';
import { SupplyEntry } from '@/app/pos/_ui/ai/SupplyEntry';
import { AiOff } from '@/app/pos/_ui/ai/view';
import { aiPage } from '../guard';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.ai.supply.title') };
}

/** Supply entry: an invoice is read into a draft, the person checks every line, and saving goes through the ordinary purchase action. */
export default async function AiSupplyPage() {
  const { t, off, tabs, mayOpenPackage } = await aiPage('supply');
  const [suppliers, items] = off ? [[], []] : await Promise.all([query(posSuppliers, {}), query(posInventoryItems, {})]);
  const needSetup = !off && (suppliers.length === 0 || items.length === 0);
  return (
    <>
      <PageHeader title={t('pos.ai.supply.title')} description={t('pos.ai.supply.intro')} />
      <SectionTabs label={t('pos.ai.tabs')} current="supply" items={tabs} />
      {off ? (
        <AiOff t={t} showPackageLink={mayOpenPackage} />
      ) : needSetup ? (
        <div className="flex flex-col items-start gap-3 px-8 pb-8">
          <p className="text-base text-muted">{t('pos.ai.supply.needSetup')}</p>
          <Link href={suppliers.length === 0 ? '/pos/purchases/suppliers' : '/pos/inventory'} className="inline-flex min-h-12 items-center text-base underline underline-offset-2">
            {suppliers.length === 0 ? t('pos.buy.tab.suppliers') : t('pos.stock.title')}
          </Link>
        </div>
      ) : (
        <div className="px-8 pb-8">
          <SupplyEntry suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit }))} today={baghdadDayOf(new Date())} />
        </div>
      )}
    </>
  );
}
