import { CircleAlert, Info, Lock, RotateCcw, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ChainView } from '@/app/pharmacy/_ui/chain-views';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { ReportExport } from '@/app/pharmacy/_ui/ReportExport';
import { ReportFilters, type FilterField } from '@/app/pharmacy/_ui/ReportFilters';
import { phMessage } from '@/app/pharmacy/_ui/ph-failure';
import { chainHref, filterMessageKey, parseChainFilters, PRESETS, presetRange } from '@/app/pharmacy/_ui/reports-logic';
import { dashboard as chainDashboardQuery } from '@/server/pharmacy/queries/chain';
import { invokeQuery } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { reportsGate } from '../reports/gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.chain.title') };
}

/**
 * The chain dashboard: every branch the person works in side by side with the total of those branches. For a person with one branch
 * the server's refusal ("the chain view needs more than one branch") is shown as a plain explanation with the way to the reports.
 * Reads only, so it stays open while the pharmacy is read-only; a role without `report.view` sees the blocked state and nothing is fetched.
 */
export default async function ChainPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, g] = await Promise.all([searchParams, reportsGate('pharmacy.chain.title', { href: '/pharmacy/reports', labelKey: 'pharmacy.reports.back' })]);
  if (g.blocked) return g.blocked;
  const { t, locale, access } = g;
  const header = <PageHeader className="max-sm:px-4" above={g.back} title={t('pharmacy.chain.title')} description={t('pharmacy.chain.about')} />;
  const oneBranch = (
    <>
      {header}
      <div data-testid="chain-one-branch" className="px-4 pb-10 sm:px-8">
        <EmptyState
          icon={<Info />}
          title={t('pharmacy.chain.oneBranch.title')}
          body={t('error.text.phChainNeedsMany')}
          action={
            <Link href="/pharmacy/reports" className={buttonClasses('primary', 'lg', 'min-h-11')}>
              {t('pharmacy.chain.oneBranch.toReports')}
            </Link>
          }
        />
      </div>
    </>
  );
  if (access.actor.branchIds.length < 2) return oneBranch;

  const { filters, problems } = parseChainFilters(raw, new Date());
  const problemText: Record<string, string> = {};
  for (const p of problems) problemText[p.field] ??= t(filterMessageKey(p));
  const fields: FilterField[] = [{ name: 'currency', label: t('pharmacy.reports.filter.currency'), value: filters.currency ?? '', options: [{ value: '', label: t('pharmacy.reports.filter.currency.all') }, { value: 'IQD', label: 'IQD' }, { value: 'USD', label: 'USD' }] }];
  const presetHrefs = Object.fromEntries(PRESETS.map((p) => [p, chainHref({ ...filters, ...presetRange(p, new Date()) })])) as Record<(typeof PRESETS)[number], string>;
  const bar = <ReportFilters action="/pharmacy/chain" dated from={filters.from} to={filters.to} fields={fields} presetHrefs={presetHrefs} problems={problemText} />;
  if (problems.length > 0) {
    return (
      <>
        {header}
        <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
          {bar}
          <p role="alert" data-testid="filters-invalid" className="flex items-start gap-2.5 rounded-md border border-danger bg-danger-wash px-3 py-2.5 text-sm text-text">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-danger" />
            <span className="min-w-0">{t('pharmacy.reports.filter.invalid')}</span>
          </p>
        </div>
      </>
    );
  }

  const result = await invokeQuery(chainDashboardQuery, { restaurantId: access.actor.restaurantId, from: filters.from, to: filters.to, ...(filters.currency ? { currency: filters.currency } : {}) });
  if (!result.ok) {
    if (result.error.fields?.phCode === 'CHAIN_NEEDS_MANY_BRANCHES') return oneBranch;
    if (result.error.code === 'FORBIDDEN') {
      return (
        <>
          {header}
          <div className="px-4 pb-10 sm:px-8" data-testid="report-gated">
            <EmptyState icon={<Lock />} title={t('pharmacy.reports.gated.title')} body={t('pharmacy.reports.forbidden.role')} />
          </div>
        </>
      );
    }
    return (
      <>
        {header}
        <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
          {bar}
          <div role="alert" data-testid="report-error" className="flex flex-col items-start gap-3 py-4">
            <p className="flex items-center gap-2.5 text-md font-semibold text-text">
              <CircleAlert aria-hidden className="size-5 shrink-0 text-danger" />
              {t('pharmacy.reports.loadFailed')}
            </p>
            <p className="max-w-[72ch] text-sm text-muted">{phMessage(t, locale, result.error, 'pharmacy.reports')}</p>
            <Link href={chainHref(filters)} className={buttonClasses('primary', 'lg', 'min-h-11')}>
              <RotateCcw aria-hidden />
              {t('pharmacy.reports.retry')}
            </Link>
          </div>
        </div>
      </>
    );
  }
  const d = result.data;
  const empty = d.branches.every((b) => b.sales.length === 0) && d.total.stock.available === 0 && d.total.transit.transfers === 0 && d.total.openTransfers.requested + d.total.openTransfers.sent === 0 && d.total.lowStock === 0;
  const params: Record<string, string> = { report: 'chain', from: filters.from, to: filters.to, ...(filters.currency ? { currency: filters.currency } : {}) };
  return (
    <>
      {header}
      <div className="flex min-w-0 flex-col gap-5 px-4 pb-10 sm:px-8" data-testid="chain-screen">
        <OfflineNotice />
        {bar}
        <ReportExport params={params} />
        {empty ? (
          <div data-testid="report-empty">
            <EmptyState icon={<SearchX />} title={t('pharmacy.reports.empty.title')} body={t('pharmacy.reports.empty.dated', { from: filters.from, to: filters.to, where: t('pharmacy.reports.filter.branch.all').toLowerCase() })} />
          </div>
        ) : (
          <ChainView d={d} f={filters} t={t} />
        )}
      </div>
    </>
  );
}
