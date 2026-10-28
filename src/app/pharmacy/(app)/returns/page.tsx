import { ListX, Search, Undo2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Forbidden, Pager, PickBranch } from '@/app/pharmacy/_ui/PageGate';
import { Money } from '@/app/pharmacy/_ui/money-parts';
import { Num } from '@/app/pharmacy/_ui/sell-parts';
import { formatUtc, saleFilterParams, shortId } from '@/app/pharmacy/_ui/shifts-logic';
import { list } from '@/server/pharmacy/queries/returns';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.returns.title') };
}

const PAGE_SIZE = 25;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Returns and cancels of the branch, newest first. Read by the holders of `report.view` or `return.approve`; others are told so. */
export default async function ReturnsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, access, locale] = await Promise.all([searchParams, catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const { actor, place, placeInput } = access;
  const header = <PageHeader className="max-sm:px-4" title={t('pharmacy.returns.title')} description={t('pharmacy.returns.intro')} />;
  if (actor.role === null || (!roleMay(actor, 'report.view') && !roleMay(actor, 'return.approve'))) {
    return (
      <>
        {header}
        <Forbidden t={t} scope="returns" support={actor.role === null} />
      </>
    );
  }
  if (!place.branchId) {
    return (
      <>
        {header}
        <PickBranch t={t} scope="returns" />
      </>
    );
  }
  const filters = saleFilterParams({ from: one(raw.from), to: one(raw.to), number: one(raw.number) });
  const cursor = one(raw.cursor)?.slice(0, 64) || undefined;
  const filtered = Object.keys(filters).length > 0;
  const page = await query(list, {
    ...placeInput,
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
    return `/pharmacy/returns${text ? `?${text}` : ''}`;
  };

  return (
    <>
      {header}
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        <form method="get" action="/pharmacy/returns" role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
          <Field label={t('pharmacy.returns.filter.number')}>
            <Input name="number" dir="ltr" defaultValue={filters.number ?? ''} autoComplete="off" className="min-h-11" />
          </Field>
          <Field label={t('pharmacy.sales.filter.from')}>
            <Input name="from" type="date" dir="ltr" defaultValue={filters.from ?? ''} className="min-h-11" />
          </Field>
          <Field label={t('pharmacy.sales.filter.to')}>
            <Input name="to" type="date" dir="ltr" defaultValue={filters.to ?? ''} className="min-h-11" />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={buttonClasses('primary', 'lg', 'min-h-11')}>
              <Search aria-hidden />
              {t('pharmacy.sales.filter.apply')}
            </button>
            {filtered && (
              <Link href="/pharmacy/returns" className={buttonClasses('ghost', 'lg', 'min-h-11')}>
                {t('pharmacy.sales.filter.clear')}
              </Link>
            )}
          </div>
        </form>
        {page.items.length === 0 ? (
          <div data-testid="returns-empty">
            <EmptyState icon={filtered ? <ListX /> : <Undo2 />} title={t(filtered ? 'pharmacy.sales.empty.filtered' : 'pharmacy.returns.empty.title')} body={t(filtered ? 'pharmacy.sales.empty.filteredBody' : 'pharmacy.returns.empty.body')} />
          </div>
        ) : (
          <ul aria-label={t('pharmacy.returns.title')} className="flex flex-col border-t border-line" data-testid="return-list">
            {page.items.map((r) => (
              <li key={r.id} data-testid="return-row" className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-line py-3 text-sm">
                <Link href={`/pharmacy/returns/${r.id}`} className="inline-flex min-h-11 items-center rounded-md px-1 font-semibold text-text underline underline-offset-2 hover:bg-hover">
                  <Num>{r.number ?? shortId(r.id)}</Num>
                </Link>
                <span className="text-text">
                  <span className="sr-only">{t('pharmacy.returns.refund')}: </span>
                  <Money minor={r.refundMinor} currency={r.currency} />
                </span>
                <span className="text-text">{t(`pharmacy.method.${r.refundMethod}`)}</span>
                <span className="ms-auto text-muted">
                  <Num>{formatUtc(r.createdAt)}</Num>
                </span>
              </li>
            ))}
          </ul>
        )}
        <Pager t={t} label={t('pharmacy.returns.title')} first={cursor ? href({}) : null} next={page.nextCursor ? href({ cursor: page.nextCursor }) : null} />
      </div>
    </>
  );
}
