import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OrderStatus } from '@/app/pharmacy/_ui/purchasing-parts';
import { SupplierForm } from '@/app/pharmacy/_ui/SupplierForm';
import { formatPhMoney } from '@/server/domain/pharmacy/money';
import { balances } from '@/server/pharmacy/queries/payables';
import { currencies } from '@/server/pharmacy/queries/prices';
import { list as orders } from '@/server/pharmacy/queries/purchase-orders';
import { get } from '@/server/pharmacy/queries/suppliers';
import { query } from '@/server/studio/framework/invoke';
import { formatDate } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.supplier.title') };
}

/** One supplier: the edit form, then (read-only) what is owed to them and their latest orders. */
export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, g] = await Promise.all([params, purchasingGate('pharmacy.purchasing.supplier.title', { href: '/pharmacy/purchasing/suppliers', labelKey: 'pharmacy.purchasing.suppliers.back' })]);
  if (g.blocked) return g.blocked;
  if (!/^[\w-]{1,64}$/.test(id)) notFound();
  const { access, t, locale } = g;
  const [supplier, currencyList, owed, recent] = await Promise.all([
    query(get, { ...access.placeInput, supplierId: id }),
    query(currencies, access.placeInput),
    query(balances, access.placeInput),
    query(orders, { ...access.placeInput, supplierId: id }),
  ]);
  const mine = owed.items.filter((b) => b.supplierId === id);
  const money = (amount: string, currency: 'IQD' | 'USD') => {
    try {
      return formatPhMoney({ amount: BigInt(amount), currency }, locale);
    } catch {
      return `${amount} ${currency}`;
    }
  };
  return (
    <>
      <PageHeader className="max-sm:px-4" above={g.back} title={<span dir="auto">{supplier.name}</span>} />
      <div className="flex min-w-0 flex-col gap-8 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        <SupplierForm userId={access.actor.userId} restaurantId={access.placeInput.restaurantId} currencies={currencyList} supplier={supplier} writable={g.writable.ok} />
        <section aria-labelledby="sup-balance" className="flex min-w-0 flex-col gap-2" data-testid="supplier-balance">
          <h2 id="sup-balance" className="text-md font-semibold text-text">
            {t('pharmacy.purchasing.supplier.balance')}
          </h2>
          {mine.length === 0 ? (
            <p className="text-sm text-muted">{t('pharmacy.purchasing.supplier.balanceNone')}</p>
          ) : (
            <ul className="flex flex-col border-t border-line">
              {mine.map((b) => (
                <li key={b.currency} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-2 text-sm text-text">
                  <span>
                    <bdi dir="ltr">{b.currency}</bdi> · {t('pharmacy.purchasing.supplier.openInvoices', { count: b.openInvoices })}
                  </span>
                  {b.netOwedMinor !== undefined && (
                    <span>
                      {t('pharmacy.purchasing.supplier.owed')}:{' '}
                      <bdi dir="ltr" className="font-medium tabular-nums">
                        {money(b.netOwedMinor, b.currency)}
                      </bdi>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="sup-orders" className="flex min-w-0 flex-col gap-2" data-testid="supplier-orders">
          <h2 id="sup-orders" className="text-md font-semibold text-text">
            {t('pharmacy.purchasing.supplier.orders')}
          </h2>
          {recent.items.length === 0 ? (
            <p className="text-sm text-muted">{t('pharmacy.purchasing.supplier.ordersNone')}</p>
          ) : (
            <ul className="flex flex-col border-t border-line">
              {recent.items.slice(0, 10).map((o) => (
                <li key={o.id} className="border-b border-line">
                  <Link href={`/pharmacy/purchasing/orders/${o.id}`} className="flex min-h-11 flex-wrap items-center gap-x-6 gap-y-1 px-1 py-2 text-sm text-text hover:bg-hover">
                    <bdi dir="ltr" className="font-medium tabular-nums">
                      {o.number ?? t('pharmacy.purchasing.po.noNumber')}
                    </bdi>
                    <OrderStatus status={o.status} t={t} />
                    <bdi dir="ltr">{formatDate(o.createdAt, locale)}</bdi>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
