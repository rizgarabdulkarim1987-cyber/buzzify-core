import type { Metadata } from 'next';
import { CreditForm } from '@/app/pharmacy/_ui/CreditForm';
import { MoneyLocked } from '@/app/pharmacy/_ui/ReasonAction';
import { ReceiveBlocked } from '@/app/pharmacy/_ui/ReceiveBlocked';
import { currencies } from '@/server/pharmacy/queries/prices';
import { get as returnGet } from '@/server/pharmacy/queries/supplier-returns';
import { get, list as suppliers } from '@/server/pharmacy/queries/suppliers';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { todayInStudioZone } from '@/app/pharmacy/_ui/ph-date';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.m.cr.newTitle') };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const ID = /^[\w-]{1,64}$/;

/** Recording a credit note: choose the supplier (or arrive from a supplier return), then number, amount and date. Needs the money role. */
export default async function NewCreditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, g] = await Promise.all([searchParams, purchasingGate('pharmacy.purchasing.m.cr.newTitle', { href: '/pharmacy/purchasing/credits', labelKey: 'pharmacy.purchasing.m.cr.back' })]);
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const header = <PageHeader className="max-sm:px-4" above={g.back} title={t('pharmacy.purchasing.m.cr.newTitle')} description={t('pharmacy.purchasing.m.cr.newIntro')} />;
  if (!g.writable.ok) {
    return (
      <>
        {header}
        <div className="px-4 pb-10 sm:px-8">{g.writeNotice ?? <ReceiveBlocked reason={g.writable.reason} t={t} />}</div>
      </>
    );
  }
  if (!g.mayMoney) {
    return (
      <>
        {header}
        <div className="px-4 pb-10 sm:px-8">
          <MoneyLocked testId="credit-money-locked" text={t('pharmacy.purchasing.m.needsMoneyRole')} />
        </div>
      </>
    );
  }
  const returnId = one(raw.return);
  const linked = returnId && ID.test(returnId) ? await query(returnGet, { ...access.placeInput, returnId }) : null;
  const supplierId = linked?.supplierId ?? one(raw.supplier);
  if (!supplierId || !ID.test(supplierId)) {
    const page = await query(suppliers, { ...access.placeInput, active: true });
    return (
      <>
        {header}
        <form method="get" className="flex min-w-0 flex-wrap items-end gap-2 px-4 pb-10 sm:px-8" data-testid="credit-pick-supplier">
          <label className="flex min-w-0 flex-col gap-1 text-sm text-text">
            {t('pharmacy.purchasing.po.supplier')}
            <select name="supplier" required data-testid="credit-supplier" className="min-h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-text sm:w-72">
              <option value="">{t('pharmacy.purchasing.po.supplierChoose')}</option>
              {page.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClasses('primary', 'lg', 'min-h-11')} data-testid="credit-supplier-go">
            {t('pharmacy.purchasing.m.inv.chooseGo')}
          </button>
        </form>
      </>
    );
  }
  const [supplier, currencyList] = await Promise.all([query(get, { ...access.placeInput, supplierId }), query(currencies, access.placeInput)]);
  return (
    <>
      {header}
      <CreditForm
        userId={access.actor.userId}
        restaurantId={access.placeInput.restaurantId}
        supplier={{ id: supplier.id, name: supplier.name, defaultCurrency: supplier.defaultCurrency }}
        currencies={currencyList}
        linkedReturn={linked ? { id: linked.id, number: linked.number } : null}
        today={todayInStudioZone()}
      />
    </>
  );
}
