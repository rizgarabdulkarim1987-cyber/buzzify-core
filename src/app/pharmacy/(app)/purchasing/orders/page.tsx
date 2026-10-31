import { ClipboardList, Plus, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { OrderStatus, type OrderStatusName } from '@/app/pharmacy/_ui/purchasing-parts';
import { formatNumber } from '@/lib/pos-format';
import { formatPhMoney } from '@/server/domain/pharmacy/money';
import { list } from '@/server/pharmacy/queries/purchase-orders';
import { list as suppliers } from '@/server/pharmacy/queries/suppliers';
import { query } from '@/server/studio/framework/invoke';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { loadPages, pagesOf } from '@/app/pharmacy/_ui/load-pages';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.po.title') };
}

const STATUSES: OrderStatusName[] = ['DRAFT', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CLOSED', 'CANCELLED'];
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Purchase orders, newest first: status chips (icon and word), a supplier filter, a search in the number, a cursor for more. */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, g] = await Promise.all([searchParams, purchasingGate('pharmacy.purchasing.po.title', { href: '/pharmacy/purchasing', labelKey: 'pharmacy.purchasing.back' })]);
  if (g.blocked) return g.blocked;
  const { access, t, locale } = g;
  const status = STATUSES.find((s) => s === one(raw.status));
  const supplierId = one(raw.supplier) || undefined;
  const search = one(raw.q)?.trim() ?? '';
  const pages = pagesOf(one(raw.pages));
  const [page, supplierPage] = await Promise.all([
    loadPages((cursor) => query(list, { ...access.placeInput, ...(status ? { status } : {}), ...(supplierId ? { supplierId } : {}), ...(search ? { search } : {}), ...(cursor ? { cursor } : {}) }), pages),
    query(suppliers, { ...access.placeInput, active: 'all' }),
  ]);
  const href = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ status, supplier: supplierId, q: search, pages: pages > 1 ? String(pages) : undefined, ...over })) if (v) next.set(k, v);
    const text = next.toString();
    return `/pharmacy/purchasing/orders${text ? `?${text}` : ''}`;
  };
  const filtered = Boolean(status || supplierId || search);
  const money = (amount: string, currency: 'IQD' | 'USD') => {
    try {
      return formatPhMoney({ amount: BigInt(amount), currency }, locale);
    } catch {
      return `${amount} ${currency}`;
    }
  };
  const canNew = g.writable.ok && access.place.branchId !== null;
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        above={g.back}
        title={t('pharmacy.purchasing.po.title')}
        description={t('pharmacy.purchasing.po.intro')}
        actions={
          canNew ? (
            <Link href="/pharmacy/purchasing/orders/new" className={buttonClasses('primary', 'lg', 'min-h-11')}>
              <Plus aria-hidden />
              {t('pharmacy.purchasing.po.new')}
            </Link>
          ) : undefined
        }
      />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        {g.writable.ok && access.place.branchId === null && (
          <p data-testid="po-pick-branch" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
            <ClipboardList aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t('pharmacy.purchasing.po.pickBranch')}</span>
          </p>
        )}
        <OfflineNotice />
        <form method="get" role="search" className="flex flex-wrap items-end gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <label className="flex min-w-0 flex-col gap-1 text-sm text-text">
            {t('pharmacy.purchasing.po.search')}
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
          <Link href={href({ status: undefined, pages: undefined })} aria-current={!status ? 'page' : undefined} className={buttonClasses(!status ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.receive.filter.all')}
          </Link>
          {STATUSES.map((s) => (
            <Link key={s} href={href({ status: s, pages: undefined })} aria-current={s === status ? 'page' : undefined} className={buttonClasses(s === status ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
              {t(`pharmacy.purchasing.po.status.${s}`)}
            </Link>
          ))}
        </nav>
        {page.items.length === 0 ? (
          <div data-testid="orders-empty">
            <EmptyState
              icon={filtered ? <SearchX /> : <ClipboardList />}
              title={t(filtered ? 'pharmacy.purchasing.po.emptyFiltered' : 'pharmacy.purchasing.po.empty')}
              body={t(filtered ? 'pharmacy.purchasing.po.emptyFilteredBody' : 'pharmacy.purchasing.po.emptyBody')}
            />
          </div>
        ) : (
          <ul aria-label={t('pharmacy.purchasing.po.title')} className="flex flex-col border-t border-line">
            {page.items.map((o) => (
              <li key={o.id} data-testid="order-row" className="border-b border-line">
                <Link
                  href={`/pharmacy/purchasing/orders/${o.id}`}
                  className="grid min-h-11 min-w-0 grid-cols-1 gap-x-6 gap-y-1 rounded-sm px-1 py-3 hover:bg-hover md:grid-cols-[minmax(0,8rem)_minmax(0,8rem)_minmax(0,2fr)_minmax(0,7rem)_minmax(0,4rem)_minmax(0,8rem)] md:items-center"
                >
                  <span className="text-base font-medium text-text">
                    {o.number ? (
                      <bdi dir="ltr" className="tabular-nums">
                        {o.number}
                      </bdi>
                    ) : (
                      <span className="text-muted">{t('pharmacy.purchasing.po.noNumber')}</span>
                    )}
                  </span>
                  <span>
                    <OrderStatus status={o.status} t={t} />
                  </span>
                  <span dir="auto" className="min-w-0 break-words text-sm text-text [overflow-wrap:anywhere]">
                    {o.supplierName}
                  </span>
                  <span className="text-sm text-text">
                    <span className="text-muted md:sr-only">{t('pharmacy.purchasing.po.expectedOn')}: </span>
                    {o.expectedOn ? <bdi dir="ltr">{phDate(`${o.expectedOn}T00:00:00.000Z`, locale)}</bdi> : <span className="text-muted">{t('pharmacy.receive.none')}</span>}
                  </span>
                  <span className="text-sm text-text tabular-nums">
                    <span className="text-muted md:sr-only">{t('pharmacy.receive.col.lines')}: </span>
                    <bdi dir="ltr">{formatNumber(o.lineCount)}</bdi>
                  </span>
                  <span className="text-sm text-text tabular-nums">
                    {o.totalMinor !== undefined && (
                      <bdi dir="ltr">{money(o.totalMinor, o.currency)}</bdi>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor && (
          <nav aria-label={t('pharmacy.purchasing.po.title')}>
            <Link href={href({ pages: String(pages + 1) })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
              {t('pharmacy.purchasing.loadMore')}
            </Link>
          </nav>
        )}
      </div>
    </>
  );
}
