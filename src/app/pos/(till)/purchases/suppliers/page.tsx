import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import { posSuppliers } from '@/server/studio/queries/pos-inventory';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { AddSupplierForm } from '@/app/pos/_ui/stock/PurchaseForm';
import { SectionTabs } from '@/app/pos/_ui/stock/view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.buy.tab.suppliers') };
}

export default async function SuppliersPage() {
  const [suppliers, locale] = await Promise.all([query(posSuppliers, {}), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  return (
    <>
      <PageHeader title={t('pos.buy.tab.suppliers')} description={t('pos.buy.suppliersIntro')} />
      <SectionTabs
        label={t('pos.buy.sections')}
        current="suppliers"
        items={[
          { key: 'all', href: '/pos/purchases', label: t('pos.buy.tab.all') },
          { key: 'unpaid', href: '/pos/purchases?unpaid=1', label: t('pos.buy.tab.unpaid') },
          { key: 'suppliers', href: '/pos/purchases/suppliers', label: t('pos.buy.tab.suppliers') },
        ]}
      />
      <div className="flex flex-col gap-8 px-8 pb-8">
        {suppliers.length === 0 ? (
          <EmptyState title={t('pos.buy.suppliersEmpty')} />
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {suppliers.map((supplier) => (
              <li key={supplier.id} className="flex min-h-12 flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="truncate text-base text-text" dir="auto">
                  {supplier.name}
                </span>
                <span className="text-sm text-muted" dir="ltr">
                  {supplier.phone}
                </span>
              </li>
            ))}
          </ul>
        )}
        <section aria-labelledby="supplier-add" className="flex flex-col gap-4 border-t border-line pt-6">
          <h2 id="supplier-add" className="text-base font-semibold text-text">
            {t('pos.buy.addSupplier')}
          </h2>
          <AddSupplierForm />
        </section>
      </div>
    </>
  );
}
