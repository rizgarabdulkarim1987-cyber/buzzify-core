import { ListX, Receipt, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Forbidden, Pager, PickBranch } from '@/app/pharmacy/_ui/PageGate';
import { Money, SaleStatus } from '@/app/pharmacy/_ui/money-parts';
import { Num } from '@/app/pharmacy/_ui/sell-parts';
import { formatUtc, SALE_STATUS_FILTERS, saleFilterParams } from '@/app/pharmacy/_ui/shifts-logic';
import { list } from '@/server/pharmacy/queries/sales';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { PageHeader } from '@/studio/ui/PageHeader';
import { Select } from '@/studio/ui/Select';
import { catalogAccess, roleMay } from '../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.sales.title') };
}

const PAGE_SIZE = 25;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Sales of the branch, newest first, filtered by status, dates and receipt number. A holder of `report.view` reads every
 * sale of the branch; a cashier reads the sales of their own open shift. Held carts are not here (the sale screen has them).
 */
export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, access, locale] = await Promise.all([searchParams, catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const { actor, place, placeInput } = access;
  const header = <PageHeader className="max-sm:px-4" title={t('pharmacy.sales.title')} description={t('pharmacy.sales.intro')} />;
  if (actor.role === null || (!roleMay(actor, 'shift.use') && !roleMay(actor, 'report.view'))) {
    return (
      <>
        {header}
        <Forbidden t={t} scope="sales" support={actor.role === null} />
      </>
    );
  }
  if (!place.branchId) {
    return (
      <>
        {header}
        <PickBranch t={t} scope="sales" />
      </>
    );
  }

  const filters = saleFilterParams({ status: one(raw.status), from: one(raw.from), to: one(raw.to), number: one(raw.number) });
  const cursor = one(raw.cursor)?.slice(0, 64) || undefined;
  const filtered = Object.keys(filters).length > 0;
  const page = await query(list, {
    ...placeInput,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.from ? { from: `${filters.from}T00:00:00.000Z` } : {}),
    ...(filters.to ? { to: `${filters.to}T23:59:59.999Z` } : {}),
    ...(filters.number ? { number: filters.number } : {}),
    ...(cursor ? { cursor } : {}),
    pageSize: PAGE_SIZE,
  });
  const href = (over: { cursor?: string }) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) next.set(key, value);
    if (over.cursor) next.set('cursor', over.cursor);
    const text = next.toString();
    return `/pharmacy/sales${text ? `?${text}` : ''}`;
  };

  return (
    <>
      {header}
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        <form method="get" action="/pharmacy/sales" role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end">
          <Field label={t('pharmacy.sales.filter.number')}>
            <Input name="number" dir="ltr" defaultValue={filters.number ?? ''} autoComplete="off" className="min-h-11" data-testid="filter-number" />
          </Field>
          <Field label={t('pharmacy.sales.filter.status')}>
            <Select
              name="status"
              defaultValue={filters.status ?? ''}
              className="[&_select]:min-h-11"
              options={[{ value: '', label: t('pharmacy.sales.filter.anyStatus') }, ...SALE_STATUS_FILTERS.map((s) => ({ value: s, label: t(`pharmacy.sales.status.${s}`) }))]}
            />
          </Field>
          <Field label={t('pharmacy.sales.filter.from')}>
            <Input name="from" type="date" dir="ltr" defaultValue={filters.from ?? ''} className="min-h-11" />
          </Field>
          <Field label={t('pharmacy.sales.filter.to')}>
            <Input name="to" type="date" dir="ltr" defaultValue={filters.to ?? ''} className="min-h-11" />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={buttonClasses('primary', 'lg', 'min-h-11')} data-testid="filter-apply">
              <Search aria-hidden />
              {t('pharmacy.sales.filter.apply')}
            </button>
            {filtered && (
              <Link href="/pharmacy/sales" className={buttonClasses('ghost', 'lg', 'min-h-11')}>
                {t('pharmacy.sales.filter.clear')}
              </Link>
            )}
          </div>
        </form>

        {page.items.length === 0 ? (
          <div data-testid="sales-empty">
            <EmptyState
              icon={filtered ? <ListX /> : <Receipt />}
              title={t(filtered ? 'pharmacy.sales.empty.filtered' : 'pharmacy.sales.empty.title')}
              body={t(filtered ? 'pharmacy.sales.empty.filteredBody' : roleMay(actor, 'report.view') ? 'pharmacy.sales.empty.body' : 'pharmacy.sales.empty.bodyOwn')}
            />
          </div>
        ) : (
          <ul aria-label={t('pharmacy.sales.title')} className="flex flex-col border-t border-line" data-testid="sale-list">
            {page.items.map((s) => (
              <li key={s.id} data-testid="sale-row" className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-line py-3 text-sm">
                <Link href={`/pharmacy/sales/${s.id}`} className="inline-flex min-h-11 items-center rounded-md px-1 font-semibold text-text underline underline-offset-2 hover:bg-hover" data-testid="sale-number">
                  <Num>{s.number ?? t('pharmacy.sales.noNumber')}</Num>
                </Link>
                <SaleStatus status={s.status} t={t} />
                <span className="text-text">
                  <span className="sr-only">{t('pharmacy.sales.total')}: </span>
                  <span data-testid="sale-total-cell"><Money minor={s.totalMinor} currency={s.currency} /></span>
                </span>
                <span className="text-text">
                  <span className="text-muted">{t('pharmacy.sales.paidBy')}: </span>
                  {s.methods.length === 0 ? t('pharmacy.sales.noPayment') : s.methods.map((m) => t(`pharmacy.method.${m}`)).join(', ')}
                </span>
                <span className="text-muted ms-auto">
                  <Num>{formatUtc(s.createdAt)}</Num>
                </span>
              </li>
            ))}
          </ul>
        )}
        <Pager t={t} label={t('pharmacy.sales.title')} first={cursor ? href({}) : null} next={page.nextCursor ? href({ cursor: page.nextCursor }) : null} />
      </div>
    </>
  );
}
