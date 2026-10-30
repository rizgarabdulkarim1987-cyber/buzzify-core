import { Archive, CircleAlert, Info, Pencil, ScrollText, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { creditView, statementRange } from '@/app/pharmacy/_ui/credit-logic';
import { AgeingTable, StatementTable } from '@/app/pharmacy/_ui/credit-views';
import { RecordPayment } from '@/app/pharmacy/_ui/CustomerPayment';
import { loadPages, pagesOf } from '@/app/pharmacy/_ui/load-pages';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { Chip, Note, Num } from '@/app/pharmacy/_ui/sell-parts';
import { formatMinor } from '@/app/pharmacy/_ui/sell-logic';
import { WriteBlocked, isolate } from '@/app/pharmacy/_ui/WriteBlocked';
import { baghdadDay } from '@/server/domain/pharmacy/reports-domain';
import { ageing, get, statement } from '@/server/pharmacy/queries/customers';
import { query } from '@/server/studio/framework/invoke';
import { StudioError } from '@/server/studio/framework/result';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { customersGate } from '../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.credit.detail') };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * One customer: the account in words and figures (balance, limit, room left), record a payment, the statement for a Baghdad range
 * (at most 366 days, the last 30 by default, read 100 rows at a time) and what they owe by age. Everything is in the customer's own
 * currency; nothing is summed across currencies. A person who only sells on credit sees the account and no statement.
 */
export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, raw, g] = await Promise.all([params, searchParams, customersGate('pharmacy.credit.detail', { href: '/pharmacy/customers', labelKey: 'pharmacy.customers.back' })]);
  if (g.blocked) return g.blocked;
  const { access, t, locale } = g;
  const customerId = id.slice(0, 64);
  let customer;
  try {
    customer = await query(get, { ...access.placeInput, customerId });
  } catch (error) {
    if (error instanceof StudioError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
  const view = creditView(
    { id: customer.id, currency: customer.currency, creditLimitMinor: customer.creditLimitMinor, balanceMinor: customer.balanceMinor, availableMinor: customer.availableMinor, active: customer.active },
    0n,
  );
  const today = baghdadDay(new Date());
  const range = statementRange(one(raw.from), one(raw.to), today);
  const pages = pagesOf(one(raw.pages));
  const owed = view.balance > 0n ? view.balance : 0n;

  let stmt = null;
  let rows: Awaited<ReturnType<typeof statementPage>>['rows'] = [];
  let nextCursor: string | null = null;
  let ageingView = null;
  async function statementPage(cursor?: string) {
    return query(statement, { ...access.placeInput, customerId, from: range.from, to: range.to, ...(cursor ? { cursor } : {}) });
  }
  if (g.mayManage) {
    const page = await loadPages(async (cursor) => {
      const s = await statementPage(cursor);
      return { items: s.rows, nextCursor: s.nextCursor, s };
    }, pages);
    stmt = page.s;
    rows = page.items;
    nextCursor = page.nextCursor;
    ageingView = await query(ageing, { ...access.placeInput, customerId });
  }
  const href = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ from: range.from, to: range.to, pages: pages > 1 ? String(pages) : undefined, ...over })) if (v) next.set(k, v);
    return `/pharmacy/customers/${customerId}?${next.toString()}`;
  };
  const figure = (label: string, minor: bigint, testId: string, strong = false) => (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-line px-3 py-2" data-testid={testId}>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`text-lg tabular-nums text-text ${strong ? 'font-semibold' : ''}`}>
        <Num>{formatMinor(minor, customer.currency)}</Num> {customer.currency}
      </dd>
    </div>
  );
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        above={g.back}
        title={
          <span dir="auto">
            {isolate(customer.name)}
          </span>
        }
        description={t('pharmacy.credit.detail')}
        actions={
          g.mayManage && g.writable.ok ? (
            <Link href={`/pharmacy/customers/${customerId}/edit`} className={buttonClasses('secondary', 'lg', 'min-h-11')} data-testid="customer-edit">
              <Pencil aria-hidden />
              {t('pharmacy.customers.edit')}
            </Link>
          ) : undefined
        }
      />
      <div className="flex min-w-0 flex-col gap-6 px-4 pb-10 sm:px-8" data-testid="customer-detail">
        <OfflineNotice messageKey="pharmacy.reports.offline" />
        {g.mayManage && !g.writable.ok && <WriteBlocked writable={g.writable} scope="sales" />}
        {!customer.active && (
          <p className="flex items-center gap-2 text-sm text-text">
            <Chip icon={<Archive aria-hidden />} testId="customer-archived">
              {t('pharmacy.customers.archived')}
            </Chip>
          </p>
        )}
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label={t('pharmacy.credit.account')}>
          {figure(t('pharmacy.credit.balance'), view.balance, 'customer-balance', true)}
          {figure(t('pharmacy.credit.limit'), view.limit, 'customer-limit-figure')}
          {figure(t('pharmacy.credit.remaining'), view.remaining, 'customer-remaining')}
        </dl>
        {view.balance < 0n && (
          <p className="flex items-center gap-2 text-sm text-muted" data-testid="customer-overpaid">
            <Info aria-hidden className="size-4 shrink-0" />
            {t('pharmacy.credit.overpaid')}
          </p>
        )}
        {view.over && view.balance > 0n && (
          <Note icon={<CircleAlert aria-hidden />} tone="danger" role="status" testId="customer-over-limit">
            {t('pharmacy.credit.aboveLimit')}
          </Note>
        )}
        {g.mayManage && g.writable.ok && <RecordPayment customerId={customerId} currency={customer.currency} owedMinor={owed.toString()} branchChosen={access.placeInput.branchId !== undefined && access.placeInput.branchId !== null} />}

        {g.mayManage && stmt && (
          <section aria-labelledby="statement-h" className="flex min-w-0 flex-col gap-3" data-testid="statement">
            <h2 id="statement-h" className="text-lg font-semibold text-text">
              {t('pharmacy.credit.statement.title')}
            </h2>
            <form method="get" className="flex flex-wrap items-end gap-3" data-testid="statement-range">
              <label className="flex flex-col gap-1 text-sm font-medium text-text">
                {t('pharmacy.rx.register.from')}
                <input type="date" name="from" defaultValue={range.from} className="min-h-11 rounded-md border border-line-strong bg-raised px-3 text-base text-text" data-testid="statement-from" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-text">
                {t('pharmacy.rx.register.to')}
                <input type="date" name="to" defaultValue={range.to} className="min-h-11 rounded-md border border-line-strong bg-raised px-3 text-base text-text" data-testid="statement-to" />
              </label>
              <button type="submit" className={buttonClasses('primary', 'lg', 'min-h-11')} data-testid="statement-apply">
                {t('pharmacy.rx.register.apply')}
              </button>
            </form>
            {range.problem && (
              <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="statement-range-problem">
                {t(`pharmacy.rx.register.${range.problem === 'long' ? 'rangeLong' : range.problem === 'order' ? 'rangeOrder' : 'rangeWrong'}`)}
              </Note>
            )}
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {figure(t('pharmacy.credit.statement.opening'), BigInt(stmt.openingMinor), 'statement-opening')}
              {figure(t('pharmacy.credit.statement.closing'), BigInt(stmt.closingMinor), 'statement-closing', true)}
            </dl>
            {rows.length === 0 ? (
              <div data-testid="statement-empty">
                <EmptyState icon={<SearchX />} title={t('pharmacy.credit.statement.empty')} body={t('pharmacy.credit.statement.emptyBody')} />
              </div>
            ) : (
              <StatementTable rows={rows} currency={customer.currency} t={t} locale={locale} canCorrect={g.writable.ok} />
            )}
            {nextCursor && (
              <nav aria-label={t('pharmacy.credit.statement.title')}>
                <Link href={href({ pages: String(pages + 1) })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')} data-testid="statement-more">
                  {t('pharmacy.purchasing.loadMore')}
                </Link>
              </nav>
            )}
          </section>
        )}

        {g.mayManage && ageingView && (
          <section aria-labelledby="ageing-h" className="flex min-w-0 flex-col gap-3" data-testid="ageing">
            <h2 id="ageing-h" className="flex items-center gap-2 text-lg font-semibold text-text">
              <ScrollText aria-hidden className="size-5" />
              {t('pharmacy.credit.ageing.title')}
            </h2>
            {ageingView.items.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted" data-testid="ageing-empty">
                <Info aria-hidden className="size-4 shrink-0" />
                {t('pharmacy.credit.ageing.none')}
              </p>
            ) : (
              <AgeingTable view={ageingView} t={t} />
            )}
          </section>
        )}
      </div>
    </>
  );
}
