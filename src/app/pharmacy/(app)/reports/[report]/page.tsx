import { CircleAlert, Lock, RotateCcw, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { ReportExport } from '@/app/pharmacy/_ui/ReportExport';
import { ReportFilters, type FilterField } from '@/app/pharmacy/_ui/ReportFilters';
import { phMessage } from '@/app/pharmacy/_ui/ph-failure';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
import { DiscountsView, MarginView, ReturnsView, SalesView } from '@/app/pharmacy/_ui/report-views';
import { DamagedView, ExpiryView, LowStockView, TransfersView, ValuationView } from '@/app/pharmacy/_ui/report-views-stock';
import { NoticeLine } from '@/app/pharmacy/_ui/reports-parts';
import {
  exportParams,
  expiryNotices,
  filterMessageKey,
  marginNotices,
  parseFilters,
  PRESETS,
  presetRange,
  reportHref,
  specOfSlug,
  transfersNotices,
  valuationNotices,
  type Notice,
} from '@/app/pharmacy/_ui/reports-logic';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { reportsGate } from '../gate';
import { isEmpty, loadReport } from '../load';

/* eslint-disable @typescript-eslint/no-explicit-any -- the views read the nine report shapes by their own types */

export async function generateMetadata({ params }: { params: Promise<{ report: string }> }): Promise<Metadata> {
  const [{ report }, locale] = await Promise.all([params, requestStudioLocale()]);
  const spec = specOfSlug(report);
  const t = getStudioTranslator(locale);
  return { title: spec ? t(`pharmacy.reports.${spec.messageKey}.title`) : t('pharmacy.reports.title') };
}

/**
 * One report: the filter bar (the address carries every filter), the per-currency totals before the rows, the sentences that say what
 * a figure leaves out, the rows with "Load more", and the CSV and Excel buttons for the same filters. A role without `report.view`
 * sees the blocked state and nothing is fetched; a margin without its two permissions is blocked the same way. The reports stay
 * open while the pharmacy is read-only.
 */
export default async function ReportPage({ params, searchParams }: { params: Promise<{ report: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ report: slug }, raw] = await Promise.all([params, searchParams]);
  const spec = specOfSlug(slug);
  if (!spec) notFound();
  const titleKey = `pharmacy.reports.${spec.messageKey}.title`;
  const g = await reportsGate(titleKey, { href: '/pharmacy/reports', labelKey: 'pharmacy.reports.back' });
  if (g.blocked) return g.blocked;
  const { t, locale, access } = g;
  const header = (actions?: ReactNode) => <PageHeader className="max-sm:px-4" above={g.back} title={t(titleKey)} description={t(`pharmacy.reports.${spec.messageKey}.about`)} actions={actions} />;
  if (spec.gated === 'margin' && !g.mayMargin) {
    return (
      <>
        {header()}
        <div data-testid="report-gated" className="px-4 pb-10 sm:px-8">
          <EmptyState icon={<Lock />} title={t('pharmacy.reports.gated.title')} body={t('pharmacy.reports.gated.margin')} />
        </div>
      </>
    );
  }
  const branches = await g.branches();
  const { filters, problems } = parseFilters(spec, raw, { now: new Date(), branchIds: branches.map((b) => b.id) });
  const problemText: Record<string, string> = {};
  for (const p of problems) problemText[p.field === 'groupBy' ? 'group' : p.field] ??= t(filterMessageKey(p));

  const fields: FilterField[] = [];
  fields.push({
    name: 'branch',
    label: t('pharmacy.reports.filter.branch'),
    value: filters.branchId ?? '',
    options: [{ value: '', label: t('pharmacy.reports.filter.branch.all') }, ...branches.map((b) => ({ value: b.id, label: b.name }))],
  });
  if (spec.currency) fields.push({ name: 'currency', label: t('pharmacy.reports.filter.currency'), value: filters.currency ?? '', options: [{ value: '', label: t('pharmacy.reports.filter.currency.all') }, { value: 'IQD', label: 'IQD' }, { value: 'USD', label: 'USD' }] });
  if (spec.groups) fields.push({ name: 'group', label: t('pharmacy.reports.filter.group'), value: filters.groupBy ?? spec.groups[0]!, options: spec.groups.map((x) => ({ value: x, label: t(`pharmacy.reports.group.${x}`) })) });
  if (spec.statuses) fields.push({ name: 'status', label: t('pharmacy.reports.filter.status'), value: filters.status ?? '', options: [{ value: '', label: t('pharmacy.reports.filter.status.all') }, ...spec.statuses.map((x) => ({ value: x, label: t(`pharmacy.transfers.status.${x}`) }))] });
  const presetHrefs = Object.fromEntries(PRESETS.map((p) => [p, reportHref(spec, filters, presetRange(p, new Date()))])) as Record<(typeof PRESETS)[number], string>;
  const bar = (
    <ReportFilters action={`/pharmacy/reports/${spec.slug}`} dated={spec.dated} from={filters.from} to={filters.to} fields={fields} presetHrefs={presetHrefs} problems={problemText} />
  );

  if (problems.length > 0) {
    return (
      <>
        {header()}
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

  const result = await loadReport(spec, filters, access.actor.restaurantId);
  const where = filters.branchId ? (branches.find((b) => b.id === filters.branchId)?.name ?? '') : t('pharmacy.reports.filter.branch.all').toLowerCase();
  if (!result.ok) {
    const forbidden = result.error.code === 'FORBIDDEN';
    return (
      <>
        {header()}
        <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
          {bar}
          {forbidden ? (
            <div data-testid="report-gated">
              <EmptyState icon={<Lock />} title={t('pharmacy.reports.gated.title')} body={t('pharmacy.reports.forbidden.role')} />
            </div>
          ) : (
            <div role="alert" data-testid="report-error" className="flex flex-col items-start gap-3 py-4">
              <p className="flex items-center gap-2.5 text-md font-semibold text-text">
                <CircleAlert aria-hidden className="size-5 shrink-0 text-danger" />
                {t('pharmacy.reports.loadFailed')}
              </p>
              <p className="max-w-[72ch] text-sm text-muted">{phMessage(t, locale, result.error, 'pharmacy.reports')}</p>
              <Link href={reportHref(spec, filters)} className={buttonClasses('primary', 'lg', 'min-h-11')}>
                <RotateCcw aria-hidden />
                {t('pharmacy.reports.retry')}
              </Link>
            </div>
          )}
        </div>
      </>
    );
  }

  const data = result.data as any;
  const date = (iso: string) => phDate(iso, locale);
  const empty = isEmpty(spec, data);
  const notices: Notice[] =
    spec.id === 'margin' ? marginNotices(data) : spec.id === 'stockValuation' ? valuationNotices(data) : spec.id === 'expiry' ? expiryNotices(data) : spec.id === 'transfers' ? transfersNotices(data) : [];
  const ctx = { t, locale };
  const stock = { t, transferHref: g.mayTransfers ? (id: string) => `/pharmacy/stock/transfers/${id}` : null };
  const exportQuery: Record<string, string> = exportParams(spec, filters, 'csv');
  delete exportQuery.format;
  return (
    <>
      {header()}
      <div className="flex min-w-0 flex-col gap-5 px-4 pb-10 sm:px-8" data-testid="report-screen" data-report={spec.id}>
        <OfflineNotice />
        {bar}
        <ReportExport params={exportQuery} />
        {empty ? (
          <div data-testid="report-empty">
            <EmptyState
              icon={<SearchX />}
              title={t('pharmacy.reports.empty.title')}
              body={spec.dated ? t('pharmacy.reports.empty.dated', { from: filters.from, to: filters.to, where }) : t('pharmacy.reports.empty.current', { where })}
              action={
                <Link href={reportHref(spec, { ...filters, branchId: null, currency: null, status: null }, spec.dated ? presetRange('last30', new Date()) : {})} className={buttonClasses('secondary', 'lg', 'min-h-11')}>
                  {t('pharmacy.reports.empty.reset')}
                </Link>
              }
            />
          </div>
        ) : (
          <>
            {notices.length > 0 && (
              <div className="flex flex-col gap-2" data-testid="report-notices">
                {notices.map((n) => (
                  <NoticeLine key={n.key} notice={n} t={t} />
                ))}
              </div>
            )}
            {spec.id === 'sales' && <SalesView r={data} ctx={ctx} />}
            {spec.id === 'returns' && <ReturnsView r={data} ctx={ctx} date={date} />}
            {spec.id === 'discounts' && <DiscountsView r={data} ctx={ctx} date={date} />}
            {spec.id === 'margin' && <MarginView r={data} ctx={ctx} />}
            {spec.id === 'stockValuation' && <ValuationView r={data} ctx={stock} />}
            {spec.id === 'expiry' && <ExpiryView r={data} ctx={stock} />}
            {spec.id === 'damaged' && <DamagedView r={data} ctx={stock} />}
            {spec.id === 'transfers' && <TransfersView r={data} ctx={stock} date={date} />}
            {spec.id === 'lowStock' && <LowStockView r={data} ctx={stock} />}
            {spec.paged && data.nextCursor && (
              <nav aria-label={t(titleKey)}>
                <Link href={reportHref(spec, filters, { pages: String(filters.pages + 1) })} rel="next" scroll={false} className={buttonClasses('secondary', 'lg', 'min-h-11')} data-testid="report-more">
                  {t('pharmacy.purchasing.loadMore')}
                </Link>
              </nav>
            )}
          </>
        )}
      </div>
    </>
  );
}
