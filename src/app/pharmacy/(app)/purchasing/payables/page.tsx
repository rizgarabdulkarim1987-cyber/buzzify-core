import { HandCoins, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Amount, BandChip, type BandName } from '@/app/pharmacy/_ui/money-status';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { PayablesList } from '@/app/pharmacy/_ui/PayablesList';
import { BANDS } from '@/app/pharmacy/_ui/purchasing-money-logic';
import { formatNumber } from '@/lib/pos-format';
import { list } from '@/server/pharmacy/queries/payables';
import { list as suppliers } from '@/server/pharmacy/queries/suppliers';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.m.pb.title') };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * What is owed to suppliers: open invoices by due band with the totals per currency and per band (a currency is never added
 * to another), a supplier filter, an overdue-only toggle, rows that open the invoice, and "Pay selected" for one supplier
 * and one currency.
 */
export default async function PayablesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, g] = await Promise.all([searchParams, purchasingGate('pharmacy.purchasing.m.pb.title', { href: '/pharmacy/purchasing', labelKey: 'pharmacy.purchasing.back' })]);
  if (g.blocked) return g.blocked;
  const { access, t, locale } = g;
  const supplierId = one(raw.supplier) || undefined;
  const overdue = one(raw.overdue) === '1';
  const band = BANDS.find((b) => b === one(raw.band));
  const cursor = one(raw.cursor);
  const [page, supplierPage] = await Promise.all([
    query(list, { ...access.placeInput, ...(supplierId ? { supplierId } : {}), ...(overdue ? { overdueOnly: true } : {}), ...(band ? { band } : {}), ...(cursor ? { cursor } : {}) }),
    query(suppliers, { ...access.placeInput, active: 'all' }),
  ]);
  const href = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ supplier: supplierId, overdue: overdue ? '1' : undefined, band, cursor, ...over })) if (v) next.set(k, v);
    const text = next.toString();
    return `/pharmacy/purchasing/payables${text ? `?${text}` : ''}`;
  };
  const filtered = Boolean(supplierId || overdue || band);
  const canPay = g.writable.ok && g.mayMoney;
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        above={g.back}
        title={t('pharmacy.purchasing.m.pb.title')}
        description={t('pharmacy.purchasing.m.pb.intro')}
        actions={
          canPay ? (
            <Link href="/pharmacy/purchasing/payments/new" data-testid="payment-new" className={buttonClasses('primary', 'lg', 'min-h-11')}>
              <HandCoins aria-hidden />
              {t('pharmacy.purchasing.m.pay.new')}
            </Link>
          ) : undefined
        }
      />
      <div className="flex min-w-0 flex-col gap-5 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        <OfflineNotice />
        {page.totals.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2" data-testid="payables-totals">
            {page.totals.map((row) => (
              <section key={row.currency} aria-label={row.currency} data-testid={`payables-total-${row.currency}`} className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-surface p-4">
                <h2 className="flex flex-wrap items-baseline justify-between gap-x-4 text-md font-semibold text-text">
                  <bdi dir="ltr">{row.currency}</bdi>
                  {row.balanceMinor !== undefined && <Amount amount={row.balanceMinor} currency={row.currency} locale={locale} />}
                </h2>
                <p className="text-sm text-muted">{t('pharmacy.purchasing.m.pb.openCount', { count: formatNumber(row.count) })}</p>
                <ul className="flex flex-col border-t border-line">
                  {BANDS.map((b) => (
                    <li key={b} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-1.5 text-sm text-text">
                      <Link href={href({ band: b, cursor: undefined })} className="inline-flex min-h-11 items-center rounded-sm hover:bg-hover">
                        <BandChip band={b as BandName} t={t} />
                      </Link>
                      <span className="flex items-baseline gap-3">
                        <span className="text-muted">
                          <bdi dir="ltr">{formatNumber(row.bands[b].count)}</bdi>
                        </span>
                        {row.bands[b].balanceMinor !== undefined && <Amount amount={row.bands[b].balanceMinor} currency={row.currency} locale={locale} />}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        <form method="get" role="search" className="flex flex-wrap items-end gap-2">
          {overdue && <input type="hidden" name="overdue" value="1" />}
          {band && <input type="hidden" name="band" value={band} />}
          <label className="flex min-w-0 flex-col gap-1 text-sm text-text">
            {t('pharmacy.purchasing.po.supplier')}
            <select name="supplier" defaultValue={supplierId ?? ''} className="min-h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-text sm:w-64">
              <option value="">{t('pharmacy.purchasing.po.allSuppliers')}</option>
              {supplierPage.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.purchasing.suppliers.searchGo')}
          </button>
        </form>
        <nav aria-label={t('pharmacy.purchasing.po.filter')} className="flex flex-wrap gap-2">
          <Link href={href({ overdue: undefined, band: undefined, cursor: undefined })} aria-current={!overdue && !band ? 'page' : undefined} className={buttonClasses(!overdue && !band ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.receive.filter.all')}
          </Link>
          <Link href={href({ overdue: '1', band: undefined, cursor: undefined })} aria-current={overdue ? 'page' : undefined} data-testid="payables-overdue-filter" className={buttonClasses(overdue ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.purchasing.m.inv.overdueOnly')}
          </Link>
        </nav>
        {page.items.length === 0 ? (
          <div data-testid="payables-empty">
            <EmptyState icon={<SearchX />} title={t(filtered ? 'pharmacy.purchasing.m.pb.emptyFiltered' : 'pharmacy.purchasing.m.pb.empty')} body={t(filtered ? 'pharmacy.purchasing.m.pb.emptyFilteredBody' : 'pharmacy.purchasing.m.pb.emptyBody')} />
          </div>
        ) : (
          <PayablesList
            canPay={canPay}
            rows={page.items.map((i) => ({
              id: i.id,
              number: i.number,
              supplierId: i.supplierId,
              supplierName: i.supplierName,
              currency: i.currency,
              dueDate: i.dueDate,
              status: i.status,
              band: i.dueBand,
              daysOverdue: i.daysOverdue,
              balanceMinor: i.balanceMinor,
            }))}
          />
        )}
        {page.nextCursor && (
          <nav aria-label={t('pharmacy.purchasing.m.pb.title')}>
            <Link href={href({ cursor: page.nextCursor })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
              {t('pharmacy.purchasing.loadMore')}
            </Link>
          </nav>
        )}
      </div>
    </>
  );
}
