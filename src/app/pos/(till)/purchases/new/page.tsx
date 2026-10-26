import type { Metadata } from 'next';
import Link from 'next/link';
import { baghdadDayOf } from '@/lib/baghdad';
import { query } from '@/server/studio/framework/invoke';
import { posInventoryItems, posSuppliers } from '@/server/studio/queries/pos-inventory';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { PurchaseForm } from '@/app/pos/_ui/stock/PurchaseForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.buy.new') };
}

/** Entering a supplier's invoice. Saving posts it: the quantities go into stock at once. */
export default async function NewPurchasePage() {
  const [suppliers, items, locale] = await Promise.all([query(posSuppliers, {}), query(posInventoryItems, {}), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  return (
    <>
      <PageHeader title={t('pos.buy.new')} description={t('pos.buy.newIntro')} />
      <div className="px-8 pb-8">
        {suppliers.length === 0 || items.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-base text-muted">{suppliers.length === 0 ? t('pos.buy.needSupplier') : t('pos.buy.needItems')}</p>
            <Link href={suppliers.length === 0 ? '/pos/purchases/suppliers' : '/pos/inventory'} className="inline-flex min-h-12 items-center text-base underline underline-offset-2">
              {suppliers.length === 0 ? t('pos.buy.tab.suppliers') : t('pos.stock.title')}
            </Link>
          </div>
        ) : (
          <PurchaseForm suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit }))} today={baghdadDayOf(new Date())} />
        )}
      </div>
    </>
  );
}
