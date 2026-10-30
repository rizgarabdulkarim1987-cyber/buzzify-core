import type { Metadata } from 'next';
import { SupplierForm } from '@/app/pharmacy/_ui/SupplierForm';
import { currencies } from '@/server/pharmacy/queries/prices';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.suppliers.new') };
}

export default async function NewSupplierPage() {
  const g = await purchasingGate('pharmacy.purchasing.suppliers.new', { href: '/pharmacy/purchasing/suppliers', labelKey: 'pharmacy.purchasing.suppliers.back' });
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const currencyList = await query(currencies, access.placeInput);
  return (
    <>
      <PageHeader className="max-sm:px-4" above={g.back} title={t('pharmacy.purchasing.suppliers.new')} />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        <SupplierForm userId={access.actor.userId} restaurantId={access.placeInput.restaurantId} currencies={currencyList} supplier={null} writable={g.writable.ok} />
      </div>
    </>
  );
}
