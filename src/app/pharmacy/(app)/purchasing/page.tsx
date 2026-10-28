import { Building2, CalendarClock, ClipboardList, Lock, ReceiptText, Wallet } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatNumber } from '@/lib/pos-format';
import { formatPhMoney } from '@/server/domain/pharmacy/money';
import { list as payables } from '@/server/pharmacy/queries/payables';
import { list as orders } from '@/server/pharmacy/queries/purchase-orders';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from './gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.title') };
}

const CARD = 'flex min-w-0 flex-col gap-2 rounded-md border border-line bg-surface p-4';
const LINK = 'inline-flex min-h-11 w-fit items-center rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover';

function Card({ icon, title, figure, note, children, testId }: { icon: ReactNode; title: string; figure: ReactNode; note?: ReactNode; children?: ReactNode; testId: string }) {
  return (
    <section data-testid={testId} className={CARD}>
      <h2 className="flex items-center gap-2 text-sm font-medium text-muted [&_svg]:size-4 [&_svg]:shrink-0">
        {icon}
        {title}
      </h2>
      <p className="text-xl font-semibold text-text tabular-nums">{figure}</p>
      {note && <div className="text-sm text-muted">{note}</div>}
      {children}
    </section>
  );
}

/**
 * The purchasing hub: counts from the existing queries (open orders, invoices due within 7 days or overdue) and the ways
 * into suppliers and orders. Invoices and payments are not on screen yet; their card says so in words instead of showing
 * a number that is not there. Money appears only for a role that may see cost.
 */
export default async function PurchasingHub() {
  const g = await purchasingGate('pharmacy.purchasing.title');
  if (g.blocked) return g.blocked;
  const { access, t, locale } = g;
  const [ordered, partial, owed] = await Promise.all([
    query(orders, { ...access.placeInput, status: 'ORDERED' }),
    query(orders, { ...access.placeInput, status: 'PARTIAL' }),
    query(payables, { ...access.placeInput, take: 1 }),
  ]);
  const count = (n: number, more: boolean) => (more ? `${formatNumber(n)}+` : formatNumber(n));
  const openCount = ordered.items.length + partial.items.length;
  const openMore = ordered.nextCursor !== null || partial.nextCursor !== null;
  const due7 = owed.totals.reduce((sum, row) => sum + row.bands.DUE_7.count, 0);
  const overdue = owed.totals.reduce((sum, row) => sum + row.bands.OVERDUE_1_30.count + row.bands.OVERDUE_31_60.count + row.bands.OVERDUE_60_PLUS.count, 0);
  const money = (amount: string, currency: 'IQD' | 'USD') => {
    try {
      return formatPhMoney({ amount: BigInt(amount), currency }, locale);
    } catch {
      return `${amount} ${currency}`;
    }
  };
  const overdueMoney = owed.totals.filter((row) => row.overdueMinor !== undefined && row.overdueMinor !== '0');

  return (
    <>
      <PageHeader className="max-sm:px-4" title={t('pharmacy.purchasing.title')} description={t('pharmacy.purchasing.intro')} />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Card testId="hub-open-orders" icon={<ClipboardList aria-hidden />} title={t('pharmacy.purchasing.hub.openOrders')} figure={<bdi dir="ltr">{count(openCount, openMore)}</bdi>} note={t('pharmacy.purchasing.hub.openOrdersNote')}>
            <Link href="/pharmacy/purchasing/orders" className={LINK}>
              {t('pharmacy.purchasing.hub.toOrders')}
            </Link>
          </Card>
          <Card testId="hub-due" icon={<CalendarClock aria-hidden />} title={t('pharmacy.purchasing.hub.due7')} figure={<bdi dir="ltr">{formatNumber(due7)}</bdi>} note={t('pharmacy.purchasing.hub.due7Note')} />
          <Card
            testId="hub-overdue"
            icon={<Wallet aria-hidden />}
            title={t('pharmacy.purchasing.hub.overdue')}
            figure={<bdi dir="ltr">{formatNumber(overdue)}</bdi>}
            note={
              overdueMoney.length > 0 ? (
                <ul>
                  {overdueMoney.map((row) => (
                    <li key={row.currency}>
                      <bdi dir="ltr">{money(row.overdueMinor!, row.currency)}</bdi>
                    </li>
                  ))}
                </ul>
              ) : (
                t('pharmacy.purchasing.hub.overdueNote')
              )
            }
          />
          <Card testId="hub-suppliers" icon={<Building2 aria-hidden />} title={t('pharmacy.purchasing.hub.suppliers')} figure={t('pharmacy.purchasing.suppliers.title')} note={t('pharmacy.purchasing.hub.suppliersNote')}>
            <Link href="/pharmacy/purchasing/suppliers" className={LINK}>
              {t('pharmacy.purchasing.hub.toSuppliers')}
            </Link>
          </Card>
          <Card testId="hub-invoices" icon={<ReceiptText aria-hidden />} title={t('pharmacy.purchasing.hub.invoices')} figure={<Lock aria-hidden className="size-5 text-muted" />} note={t('pharmacy.purchasing.hub.invoicesLater')} />
        </div>
        <Link href="/pharmacy/stock/receive" className={LINK}>
          {t('pharmacy.purchasing.hub.toReceiving')}
        </Link>
      </div>
    </>
  );
}
