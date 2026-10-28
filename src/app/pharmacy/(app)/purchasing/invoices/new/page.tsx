import type { Metadata } from 'next';
import { InvoiceEditor } from '@/app/pharmacy/_ui/InvoiceEditor';
import type { InvoiceableRow } from '@/app/pharmacy/_ui/purchasing-money-logic';
import { currencies } from '@/server/pharmacy/queries/prices';
import { invoiceable } from '@/server/pharmacy/queries/supplier-invoices';
import { get, list as suppliers } from '@/server/pharmacy/queries/suppliers';
import { INVOICEABLE_LIMIT } from '@/server/pharmacy/supplier-invoices';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.m.inv.newTitle') };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Entering an invoice: choose the supplier, then tick the received lines it bills. A read-only pharmacy sees the reason and no form. */
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, g] = await Promise.all([searchParams, purchasingGate('pharmacy.purchasing.m.inv.newTitle', { href: '/pharmacy/purchasing/invoices', labelKey: 'pharmacy.purchasing.m.inv.back' })]);
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const header = <PageHeader className="max-sm:px-4" above={g.back} title={t('pharmacy.purchasing.m.inv.newTitle')} description={t('pharmacy.purchasing.m.inv.newIntro')} />;
  if (!g.writable.ok) {
    return (
      <>
        {header}
        <div className="px-4 pb-10 sm:px-8">{g.writeNotice}</div>
      </>
    );
  }
  const supplierId = one(raw.supplier) || undefined;
  if (!supplierId || !/^[\w-]{1,64}$/.test(supplierId)) {
    const page = await query(suppliers, { ...access.placeInput, active: true });
    return (
      <>
        {header}
        <form method="get" className="flex min-w-0 flex-wrap items-end gap-2 px-4 pb-10 sm:px-8" data-testid="invoice-pick-supplier">
          <label className="flex min-w-0 flex-col gap-1 text-sm text-text">
            {t('pharmacy.purchasing.po.supplier')}
            <select name="supplier" required data-testid="invoice-supplier" className="min-h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-text sm:w-72">
              <option value="">{t('pharmacy.purchasing.po.supplierChoose')}</option>
              {page.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClasses('primary', 'lg', 'min-h-11')} data-testid="invoice-supplier-go">
            {t('pharmacy.purchasing.m.inv.chooseGo')}
          </button>
        </form>
      </>
    );
  }
  const [supplier, lines, currencyList] = await Promise.all([
    query(get, { ...access.placeInput, supplierId }),
    query(invoiceable, { ...access.placeInput, supplierId }),
    query(currencies, access.placeInput),
  ]);
  const rows: InvoiceableRow[] = lines.items.map((l) => ({
    receiptLineId: l.receiptLineId,
    receiptId: l.receiptId,
    receiptNumber: l.receiptNumber,
    productName: l.productName,
    unitLabel: l.unitLabel,
    lot: l.lot,
    expiry: l.expiry,
    invoiceableQty: l.invoiceableQty,
    currency: l.currency,
    unitCostMinor: l.unitCostMinor,
  }));
  return (
    <>
      {header}
      <InvoiceEditor
        userId={access.actor.userId}
        restaurantId={access.placeInput.restaurantId}
        supplier={{ id: supplier.id, name: supplier.name, termsDays: supplier.termsDays, defaultCurrency: supplier.defaultCurrency }}
        rows={rows}
        currencies={currencyList}
        truncated={rows.length >= INVOICEABLE_LIMIT}
      />
    </>
  );
}
