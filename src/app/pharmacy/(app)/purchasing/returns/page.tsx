import { PackageMinus, Plus, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { moneyText } from '@/app/pharmacy/_ui/money-status';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { formatNumber } from '@/lib/pos-format';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { list } from '@/server/pharmacy/queries/supplier-returns';
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
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.m.ret.title') };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Returns of stock to a supplier (not customer returns, which live under Returns in the main menu), newest first. */
export default async function SupplierReturnsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, g] = await Promise.all([searchParams, purchasingGate('pharmacy.purchasing.m.ret.title', { href: '/pharmacy/purchasing', labelKey: 'pharmacy.purchasing.back' })]);
  if (g.blocked) return g.blocked;
  const { access, t, locale } = g;
  const supplierId = one(raw.supplier) || undefined;
  const cursor = one(raw.cursor);
  const [page, supplierPage] = await Promise.all([
    query(list, { ...access.placeInput, ...(supplierId ? { supplierId } : {}), ...(cursor ? { cursor } : {}) }),
    query(suppliers, { ...access.placeInput, active: 'all' }),
  ]);
  const mayAdjust = access.actor.role !== null && canPh(access.actor.role, 'stock.adjust');
  const href = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ supplier: supplierId, cursor, ...over })) if (v) next.set(k, v);
    const text = next.toString();
    return `/pharmacy/purchasing/returns${text ? `?${text}` : ''}`;
  };
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        above={g.back}
        title={t('pharmacy.purchasing.m.ret.title')}
        description={t('pharmacy.purchasing.m.ret.intro')}
        actions={
          g.writable.ok && mayAdjust ? (
            <Link href="/pharmacy/purchasing/returns/new" data-testid="return-new" className={buttonClasses('primary', 'lg', 'min-h-11')}>
              <Plus aria-hidden />
              {t('pharmacy.purchasing.m.ret.new')}
            </Link>
          ) : undefined
        }
      />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        <OfflineNotice />
        <form method="get" role="search" className="flex flex-wrap items-end gap-2">
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
        {page.items.length === 0 ? (
          <div data-testid="returns-empty">
            <EmptyState icon={supplierId ? <SearchX /> : <PackageMinus />} title={t(supplierId ? 'pharmacy.purchasing.m.ret.emptyFiltered' : 'pharmacy.purchasing.m.ret.empty')} body={t(supplierId ? 'pharmacy.purchasing.m.ret.emptyFilteredBody' : 'pharmacy.purchasing.m.ret.emptyBody')} />
          </div>
        ) : (
          <ul aria-label={t('pharmacy.purchasing.m.ret.title')} className="flex flex-col border-t border-line">
            {page.items.map((r) => (
              <li key={r.id} data-testid="return-row" className="border-b border-line">
                <Link
                  href={`/pharmacy/purchasing/returns/${r.id}`}
                  className="grid min-h-11 min-w-0 grid-cols-1 gap-x-6 gap-y-1 rounded-sm px-1 py-3 hover:bg-hover md:grid-cols-[minmax(0,9rem)_minmax(0,2fr)_minmax(0,7rem)_minmax(0,5rem)_minmax(0,10rem)] md:items-center"
                >
                  <span className="text-base font-medium text-text">
                    <bdi dir="ltr" className="tabular-nums">
                      {r.number ?? r.id.slice(0, 8)}
                    </bdi>
                  </span>
                  <span dir="auto" className="min-w-0 break-words text-sm text-text [overflow-wrap:anywhere]">
                    {r.supplierName}
                  </span>
                  <span className="text-sm text-text">
                    <bdi dir="ltr">{formatDate(r.createdAt, locale)}</bdi>
                  </span>
                  <span className="text-sm text-text tabular-nums">
                    <span className="text-muted md:sr-only">{t('pharmacy.purchasing.m.ret.qtyTotal')}: </span>
                    <bdi dir="ltr">{formatNumber(r.totalQty)}</bdi>
                  </span>
                  <span className="flex flex-col text-sm text-text md:text-end">
                    {r.returnValue &&
                      (['IQD', 'USD'] as const)
                        .filter((c) => r.returnValue![c] !== undefined)
                        .map((c) => (
                          <bdi key={c} dir="ltr" className="tabular-nums">
                            {moneyText(r.returnValue![c]!, c, locale)}
                          </bdi>
                        ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor && (
          <nav aria-label={t('pharmacy.purchasing.m.ret.title')}>
            <Link href={href({ cursor: page.nextCursor })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
              {t('pharmacy.purchasing.loadMore')}
            </Link>
          </nav>
        )}
      </div>
    </>
  );
}
