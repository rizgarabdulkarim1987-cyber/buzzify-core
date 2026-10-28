import { Lock } from 'lucide-react';
import type { Metadata } from 'next';
import { PurchaseOrderEditor } from '@/app/pharmacy/_ui/PurchaseOrderEditor';
import { currencies } from '@/server/pharmacy/queries/prices';
import { list as suppliers } from '@/server/pharmacy/queries/suppliers';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.po.new') };
}

/** A new draft order in the chosen branch. Needs a role that buys, an open pharmacy and one branch chosen. */
export default async function NewOrderPage() {
  const g = await purchasingGate('pharmacy.purchasing.po.new', { href: '/pharmacy/purchasing/orders', labelKey: 'pharmacy.purchasing.po.back' });
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const head = <PageHeader className="max-sm:px-4" above={g.back} title={t('pharmacy.purchasing.po.new')} />;
  if (!g.writable.ok) {
    return (
      <>
        {head}
        <div className="px-4 pb-10 sm:px-8">{g.writeNotice}</div>
      </>
    );
  }
  if (access.place.branchId === null) {
    return (
      <>
        {head}
        <div className="px-4 pb-10 sm:px-8">
          <p data-testid="po-pick-branch" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
            <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t('pharmacy.purchasing.po.pickBranch')}</span>
          </p>
        </div>
      </>
    );
  }
  const [currencyList, supplierPage] = await Promise.all([query(currencies, access.placeInput), query(suppliers, { ...access.placeInput, active: true })]);
  return (
    <>
      {head}
      <PurchaseOrderEditor
        userId={access.actor.userId}
        restaurantId={access.placeInput.restaurantId}
        branchId={access.place.branchId}
        branchName={access.place.branchName ?? ''}
        currencies={currencyList}
        suppliers={supplierPage.items.map((s) => ({ id: s.id, name: s.name, defaultCurrency: s.defaultCurrency }))}
        initial={null}
        orderId={null}
      />
    </>
  );
}
