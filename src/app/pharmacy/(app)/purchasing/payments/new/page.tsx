import type { Metadata } from 'next';
import type { OpenInvoiceWire } from '@/app/pharmacy/_ui/AllocationFields';
import { ReceiveBlocked } from '@/app/pharmacy/_ui/ReceiveBlocked';
import { MoneyLocked } from '@/app/pharmacy/_ui/ReasonAction';
import { PaymentForm } from '@/app/pharmacy/_ui/PaymentForm';
import { list as payables } from '@/server/pharmacy/queries/payables';
import { get, list as suppliers } from '@/server/pharmacy/queries/suppliers';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.m.pay.newTitle') };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const ID = /^[\w-]{1,64}$/;

/** Recording a payment: choose the supplier and currency, then amount, method and where it goes. Needs the money role; a read-only pharmacy sees the reason. */
export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, g] = await Promise.all([searchParams, purchasingGate('pharmacy.purchasing.m.pay.newTitle', { href: '/pharmacy/purchasing/payments', labelKey: 'pharmacy.purchasing.m.pay.back' })]);
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const header = <PageHeader className="max-sm:px-4" above={g.back} title={t('pharmacy.purchasing.m.pay.newTitle')} description={t('pharmacy.purchasing.m.pay.newIntro')} />;
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
          <MoneyLocked testId="payment-money-locked" text={t('pharmacy.purchasing.m.needsMoneyRole')} />
        </div>
      </>
    );
  }
  const supplierId = one(raw.supplier);
  const currencyText = one(raw.currency);
  const currency = currencyText === 'IQD' || currencyText === 'USD' ? currencyText : null;
  if (!supplierId || !ID.test(supplierId) || !currency) {
    const page = await query(suppliers, { ...access.placeInput, active: 'all' });
    return (
      <>
        {header}
        <form method="get" className="flex min-w-0 flex-wrap items-end gap-2 px-4 pb-10 sm:px-8" data-testid="payment-pick-supplier">
          <label className="flex min-w-0 flex-col gap-1 text-sm text-text">
            {t('pharmacy.purchasing.po.supplier')}
            <select name="supplier" required data-testid="payment-supplier" defaultValue={supplierId ?? ''} className="min-h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-text sm:w-72">
              <option value="">{t('pharmacy.purchasing.po.supplierChoose')}</option>
              {page.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm text-text">
            {t('pharmacy.purchasing.po.currency')}
            <select name="currency" required defaultValue={currency ?? 'IQD'} data-testid="payment-currency" className="min-h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-text sm:w-32">
              <option value="IQD">IQD</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <button type="submit" className={buttonClasses('primary', 'lg', 'min-h-11')} data-testid="payment-supplier-go">
            {t('pharmacy.purchasing.m.inv.chooseGo')}
          </button>
        </form>
      </>
    );
  }
  const [supplier, open] = await Promise.all([query(get, { ...access.placeInput, supplierId }), query(payables, { ...access.placeInput, supplierId, currency })]);
  const invoices: OpenInvoiceWire[] = open.items
    .filter((i) => i.balanceMinor !== undefined)
    .map((i) => ({ id: i.id, number: i.number, supplierId: i.supplierId, currency: i.currency, dueDate: i.dueDate, balanceMinor: i.balanceMinor! }));
  const preselected = (one(raw.invoice) ?? '')
    .split(',')
    .filter((v) => ID.test(v))
    .slice(0, 50);
  return (
    <>
      {header}
      <PaymentForm
        userId={access.actor.userId}
        restaurantId={access.placeInput.restaurantId}
        supplier={{ id: supplier.id, name: supplier.name }}
        currency={currency}
        invoices={invoices}
        preselected={preselected}
        today={new Date().toISOString().slice(0, 10)}
        hasMore={open.nextCursor !== null}
      />
    </>
  );
}
