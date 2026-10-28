import { Archive, Building2, Plus, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { list } from '@/server/pharmacy/queries/suppliers';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { loadPages, pagesOf } from '@/app/pharmacy/_ui/load-pages';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.suppliers.title') };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const ACTIVE = ['active', 'archived', 'all'] as const;

/** Suppliers by name: search, live / archived / all, a cursor for more. Archived ones carry a badge with an icon and a word. */
export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, g] = await Promise.all([searchParams, purchasingGate('pharmacy.purchasing.suppliers.title', { href: '/pharmacy/purchasing', labelKey: 'pharmacy.purchasing.back' })]);
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const search = one(raw.q)?.trim() ?? '';
  const filter = ACTIVE.find((a) => a === one(raw.active)) ?? 'active';
  const pages = pagesOf(one(raw.pages));
  const page = await loadPages((cursor) => query(list, {
    ...access.placeInput,
    ...(search ? { search } : {}),
    active: filter === 'all' ? 'all' : filter === 'active',
    ...(cursor ? { cursor } : {}),
  }), pages);
  const href = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: search, active: filter === 'active' ? undefined : filter, pages: pages > 1 ? String(pages) : undefined, ...over })) if (v) next.set(k, v);
    const text = next.toString();
    return `/pharmacy/purchasing/suppliers${text ? `?${text}` : ''}`;
  };
  const filtered = search !== '' || filter !== 'active';
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        above={g.back}
        title={t('pharmacy.purchasing.suppliers.title')}
        description={t('pharmacy.purchasing.suppliers.intro')}
        actions={
          g.writable.ok ? (
            <Link href="/pharmacy/purchasing/suppliers/new" className={buttonClasses('primary', 'lg', 'min-h-11')}>
              <Plus aria-hidden />
              {t('pharmacy.purchasing.suppliers.new')}
            </Link>
          ) : undefined
        }
      />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        <OfflineNotice />
        <form method="get" className="flex flex-wrap items-end gap-2" role="search">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-text sm:max-w-sm">
            {t('pharmacy.purchasing.suppliers.search')}
            <input name="q" defaultValue={search} dir="auto" autoComplete="off" className="min-h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-text" />
          </label>
          {filter !== 'active' && <input type="hidden" name="active" value={filter} />}
          <button type="submit" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.purchasing.suppliers.searchGo')}
          </button>
        </form>
        <nav aria-label={t('pharmacy.purchasing.suppliers.filter')} className="flex flex-wrap gap-2">
          {ACTIVE.map((a) => (
            <Link key={a} href={href({ active: a === 'active' ? undefined : a, pages: undefined })} aria-current={a === filter ? 'page' : undefined} className={buttonClasses(a === filter ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
              {t(`pharmacy.purchasing.suppliers.filter.${a}`)}
            </Link>
          ))}
        </nav>
        {page.items.length === 0 ? (
          <div data-testid="suppliers-empty">
            <EmptyState
              icon={filtered ? <SearchX /> : <Building2 />}
              title={t(filtered ? 'pharmacy.purchasing.suppliers.emptyFiltered' : 'pharmacy.purchasing.suppliers.empty')}
              body={t(filtered ? 'pharmacy.purchasing.suppliers.emptyFilteredBody' : 'pharmacy.purchasing.suppliers.emptyBody')}
            />
          </div>
        ) : (
          <ul aria-label={t('pharmacy.purchasing.suppliers.title')} className="flex flex-col border-t border-line">
            {page.items.map((s) => (
              <li key={s.id} data-testid="supplier-row" className="border-b border-line">
                <Link
                  href={`/pharmacy/purchasing/suppliers/${s.id}`}
                  className="grid min-h-11 min-w-0 grid-cols-1 gap-x-6 gap-y-1 rounded-sm px-1 py-3 hover:bg-hover md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,5rem)_minmax(0,6rem)_minmax(0,7rem)] md:items-center"
                >
                  <span dir="auto" className="min-w-0 break-words text-base font-medium text-text [overflow-wrap:anywhere]">
                    {s.name}
                  </span>
                  <span className="min-w-0 break-words text-sm text-text">{s.phone ? <bdi dir="ltr">{s.phone}</bdi> : <span className="text-muted">{t('pharmacy.receive.none')}</span>}</span>
                  <span className="text-sm text-text">
                    <bdi dir="ltr">{s.defaultCurrency}</bdi>
                  </span>
                  <span className="text-sm text-text">
                    <span className="text-muted md:sr-only">{t('pharmacy.purchasing.supplier.terms')}: </span>
                    <bdi dir="ltr">{t('pharmacy.purchasing.suppliers.days', { count: s.termsDays })}</bdi>
                  </span>
                  <span>
                    {!s.active && (
                      <span className="inline-flex min-h-6 items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-1.5 py-0.5 text-xs font-medium text-text">
                        <Archive aria-hidden className="size-3.5 shrink-0" />
                        {t('pharmacy.purchasing.supplier.archivedBadge')}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor && (
          <nav aria-label={t('pharmacy.purchasing.suppliers.title')}>
            <Link href={href({ pages: String(pages + 1) })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
              {t('pharmacy.purchasing.loadMore')}
            </Link>
          </nav>
        )}
      </div>
    </>
  );
}
