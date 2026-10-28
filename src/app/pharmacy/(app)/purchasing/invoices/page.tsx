import { FileText, Plus, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Amount, BandChip, InvoiceStatusChip, type InvoiceStatusName } from '@/app/pharmacy/_ui/money-status';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { list } from '@/server/pharmacy/queries/supplier-invoices';
import { list as suppliers } from '@/server/pharmacy/queries/suppliers';
import { query } from '@/server/studio/framework/invoke';
import { formatDate } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.m.inv.title') };
}

const STATUSES: InvoiceStatusName[] = ['OPEN', 'PARTIAL', 'PAID', 'VOID'];
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Supplier invoices, newest first: status chips (icon and word), due-band chips, an overdue filter, a supplier filter, a search by number and a cursor for more. */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, g] = await Promise.all([searchParams, purchasingGate('pharmacy.purchasing.m.inv.title', { href: '/pharmacy/purchasing', labelKey: 'pharmacy.purchasing.back' })]);
  if (g.blocked) return g.blocked;
  const { access, t, locale } = g;
  const status = STATUSES.find((s) => s === one(raw.status));
  const supplierId = one(raw.supplier) || undefined;
  const search = one(raw.q)?.trim() ?? '';
  const overdue = one(raw.overdue) === '1';
  const cursor = one(raw.cursor);
  const [page, supplierPage] = await Promise.all([
    query(list, { ...access.placeInput, ...(status ? { status } : {}), ...(supplierId ? { supplierId } : {}), ...(search ? { search } : {}), ...(overdue ? { overdue: true } : {}), ...(cursor ? { cursor } : {}) }),
    query(suppliers, { ...access.placeInput, active: 'all' }),
  ]);
  const href = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ status, supplier: supplierId, q: search, overdue: overdue ? '1' : undefined, cursor, ...over })) if (v) next.set(k, v);
    const text = next.toString();
    return `/pharmacy/purchasing/invoices${text ? `?${text}` : ''}`;
  };
  const filtered = Boolean(status || supplierId || search || overdue);
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        above={g.back}
        title={t('pharmacy.purchasing.m.inv.title')}
        description={t('pharmacy.purchasing.m.inv.intro')}
        actions={
          g.writable.ok ? (
            <Link href="/pharmacy/purchasing/invoices/new" data-testid="invoice-new" className={buttonClasses('primary', 'lg', 'min-h-11')}>
              <Plus aria-hidden />
              {t('pharmacy.purchasing.m.inv.new')}
            </Link>
          ) : undefined
        }
      />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        <OfflineNotice />
        <form method="get" role="search" className="flex flex-wrap items-end gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          {overdue && <input type="hidden" name="overdue" value="1" />}
          <label className="flex min-w-0 flex-col gap-1 text-sm text-text">
            {t('pharmacy.purchasing.m.inv.search')}
            <input name="q" defaultValue={search} dir="ltr" autoComplete="off" className="min-h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-text sm:w-56" />
          </label>
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
          <Link href={href({ status: undefined, overdue: undefined, cursor: undefined })} aria-current={!status && !overdue ? 'page' : undefined} className={buttonClasses(!status && !overdue ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.receive.filter.all')}
          </Link>
          {STATUSES.map((s) => (
            <Link key={s} href={href({ status: s, overdue: undefined, cursor: undefined })} aria-current={s === status ? 'page' : undefined} className={buttonClasses(s === status ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
              {t(`pharmacy.purchasing.m.status.${s}`)}
            </Link>
          ))}
          <Link href={href({ status: undefined, overdue: overdue ? undefined : '1', cursor: undefined })} aria-current={overdue ? 'page' : undefined} data-testid="invoice-overdue-filter" className={buttonClasses(overdue ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.purchasing.m.inv.overdueOnly')}
          </Link>
        </nav>
        {page.items.length === 0 ? (
          <div data-testid="invoices-empty">
            <EmptyState
              icon={filtered ? <SearchX /> : <FileText />}
              title={t(filtered ? 'pharmacy.purchasing.m.inv.emptyFiltered' : 'pharmacy.purchasing.m.inv.empty')}
              body={t(filtered ? 'pharmacy.purchasing.m.inv.emptyFilteredBody' : 'pharmacy.purchasing.m.inv.emptyBody')}
            />
          </div>
        ) : (
          <ul aria-label={t('pharmacy.purchasing.m.inv.title')} className="flex flex-col border-t border-line">
            {page.items.map((i) => (
              <li key={i.id} data-testid="invoice-row" className="border-b border-line">
                <Link
                  href={`/pharmacy/purchasing/invoices/${i.id}`}
                  className="grid min-h-11 min-w-0 grid-cols-1 gap-x-6 gap-y-1 rounded-sm px-1 py-3 hover:bg-hover md:grid-cols-[minmax(0,8rem)_minmax(0,2fr)_minmax(0,11rem)_minmax(0,7rem)_minmax(0,8rem)] md:items-center"
                >
                  <span className="text-base font-medium text-text">
                    <bdi dir="ltr" className="tabular-nums">
                      {i.number}
                    </bdi>
                  </span>
                  <span dir="auto" className="min-w-0 break-words text-sm text-text [overflow-wrap:anywhere]">
                    {i.supplierName}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <InvoiceStatusChip status={i.status} t={t} />
                    {i.dueBand && <BandChip band={i.dueBand} t={t} />}
                  </span>
                  <span className="text-sm text-text">
                    <span className="text-muted md:sr-only">{t('pharmacy.purchasing.m.col.due')}: </span>
                    <bdi dir="ltr">{formatDate(`${i.dueDate}T00:00:00.000Z`, locale)}</bdi>
                  </span>
                  <span className="text-sm text-text md:text-end">
                    {i.totalMinor !== undefined && <Amount amount={i.status === 'PAID' || i.status === 'VOID' ? i.totalMinor : i.balanceMinor} currency={i.currency} locale={locale} className="font-medium" />}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor && (
          <nav aria-label={t('pharmacy.purchasing.m.inv.title')}>
            <Link href={href({ cursor: page.nextCursor })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
              {t('pharmacy.purchasing.loadMore')}
            </Link>
          </nav>
        )}
      </div>
    </>
  );
}
