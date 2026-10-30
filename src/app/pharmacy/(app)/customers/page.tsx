import { Archive, Plus, SearchX, UsersRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { loadPages, pagesOf } from '@/app/pharmacy/_ui/load-pages';
import { Chip, Num } from '@/app/pharmacy/_ui/sell-parts';
import { formatMinor } from '@/app/pharmacy/_ui/sell-logic';
import { isolateName as isolate } from '@/app/pharmacy/_ui/isolate-name';
import { WriteBlocked } from '@/app/pharmacy/_ui/WriteBlocked';
import { list } from '@/server/pharmacy/queries/customers';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { customersGate } from './gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.customers.title') };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const STATES = ['live', 'archived', 'all'] as const;

/**
 * Customers of the business, by name. Each row says what the account holds in words and figures (balance, limit, room left) in the
 * customer's own currency; nothing is summed across currencies. Rows are cards, not a table, so the list reads at 375 px; it is read
 * 50 at a time and "Load more" adds the next 50.
 */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, g] = await Promise.all([searchParams, customersGate('pharmacy.customers.title')]);
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const q = (one(raw.q) ?? '').slice(0, 100);
  const state = STATES.find((s) => s === one(raw.state)) ?? 'live';
  const owing = one(raw.owing) === '1';
  const pages = pagesOf(one(raw.pages));
  const page = await loadPages(
    (cursor) => query(list, { ...access.placeInput, ...(q.trim() ? { search: q } : {}), active: state === 'live' ? true : state === 'archived' ? false : 'all', ...(owing ? { owingOnly: true } : {}), ...(cursor ? { cursor } : {}) }),
    pages,
  );
  const href = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: q || undefined, state: state === 'live' ? undefined : state, owing: owing ? '1' : undefined, pages: pages > 1 ? String(pages) : undefined, ...over })) if (v) next.set(k, v);
    const text = next.toString();
    return `/pharmacy/customers${text ? `?${text}` : ''}`;
  };
  const filtered = Boolean(q.trim()) || owing || state !== 'live';
  const canNew = g.mayManage && g.writable.ok;
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        title={t('pharmacy.customers.title')}
        description={t('pharmacy.customers.intro')}
        actions={
          canNew ? (
            <Link href="/pharmacy/customers/new" className={buttonClasses('primary', 'lg', 'min-h-11')} data-testid="customer-new">
              <Plus aria-hidden />
              {t('pharmacy.customers.new')}
            </Link>
          ) : undefined
        }
      />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {g.mayManage && !g.writable.ok && <WriteBlocked writable={g.writable} scope="sales" />}
        <OfflineNotice messageKey="pharmacy.reports.offline" />
        <form method="get" className="flex flex-wrap items-end gap-3" role="search" data-testid="customers-filter">
          <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-sm font-medium text-text">
            {t('pharmacy.customers.search')}
            <input type="search" name="q" defaultValue={q} dir="auto" maxLength={100} autoComplete="off" data-testid="customers-q" className="min-h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-text" />
          </label>
          {state !== 'live' && <input type="hidden" name="state" value={state} />}
          {owing && <input type="hidden" name="owing" value="1" />}
          <button type="submit" className={buttonClasses('primary', 'lg', 'min-h-11')}>
            {t('pharmacy.customers.searchGo')}
          </button>
        </form>
        <nav aria-label={t('pharmacy.customers.filter')} className="flex flex-wrap gap-2">
          {STATES.map((s) => (
            <Link key={s} href={href({ state: s === 'live' ? undefined : s, pages: undefined })} aria-current={s === state ? 'page' : undefined} data-testid={`customers-state-${s}`} className={buttonClasses(s === state ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
              {t(`pharmacy.customers.state.${s}`)}
            </Link>
          ))}
          <Link href={href({ owing: owing ? undefined : '1', pages: undefined })} aria-current={owing ? 'page' : undefined} data-testid="customers-owing" className={buttonClasses(owing ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.customers.owingOnly')}
          </Link>
        </nav>
        {page.items.length === 0 ? (
          <div data-testid="customers-empty">
            <EmptyState icon={filtered ? <SearchX /> : <UsersRound />} title={t(filtered ? 'pharmacy.customers.emptyFiltered' : 'pharmacy.customers.empty')} body={t(filtered ? 'pharmacy.customers.emptyFilteredBody' : 'pharmacy.customers.emptyBody')} />
          </div>
        ) : (
          <ul aria-label={t('pharmacy.customers.title')} className="flex flex-col border-t border-line" data-testid="customers-list">
            {page.items.map((c) => (
              <li key={c.id} data-testid="customer-row" className="border-b border-line">
                <Link href={`/pharmacy/customers/${c.id}`} className="grid min-h-11 min-w-0 grid-cols-1 gap-x-6 gap-y-1 rounded-sm px-1 py-3 hover:bg-hover md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                  <span className="min-w-0 break-words text-base font-semibold text-text" dir="auto">
                    {isolate(c.name)}
                    {!c.active && (
                      <span className="ms-2 inline-block align-middle">
                        <Chip icon={<Archive aria-hidden />} testId="customer-archived">
                          {t('pharmacy.customers.archived')}
                        </Chip>
                      </span>
                    )}
                    {c.phone ? <span className="block text-sm font-normal text-muted"><Num>{c.phone}</Num></span> : null}
                  </span>
                  <span className="text-sm text-text">
                    <span className="text-muted">{t('pharmacy.credit.balance')}: </span>
                    <Num>{formatMinor(BigInt(c.balanceMinor), c.currency)}</Num> {c.currency}
                  </span>
                  <span className="text-sm text-text">
                    <span className="text-muted">{t('pharmacy.credit.limit')}: </span>
                    <Num>{formatMinor(BigInt(c.creditLimitMinor), c.currency)}</Num> {c.currency}
                  </span>
                  <span className="text-sm font-medium text-text">
                    <span className="font-normal text-muted">{t('pharmacy.credit.remaining')}: </span>
                    <Num>{formatMinor(BigInt(c.availableMinor), c.currency)}</Num> {c.currency}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor && (
          <nav aria-label={t('pharmacy.customers.title')}>
            <Link href={href({ pages: String(pages + 1) })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')} data-testid="customers-more">
              {t('pharmacy.purchasing.loadMore')}
            </Link>
          </nav>
        )}
      </div>
    </>
  );
}
