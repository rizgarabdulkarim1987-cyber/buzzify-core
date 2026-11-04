import { Banknote, ChartNoAxesColumn, ChevronRight, Network, Receipt, ReceiptText, Timer, TrendingUp, Undo2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { marginReport, salesReport } from '@/app/pharmacy/_actions/reports';
import { Kpi } from '@/app/pharmacy/_ui/HomeDashboard';
import { periodOf } from '@/app/pharmacy/_ui/home-logic';
import { Money } from '@/app/pharmacy/_ui/money-parts';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { Name, Num, Unavailable } from '@/app/pharmacy/_ui/reports-parts';
import { countParams, landingFigures, landingRange, visibleReports } from '@/app/pharmacy/_ui/reports-logic';
import { SalesChart } from '@/app/pharmacy/_ui/SalesChart';
import type { Translate } from '@/lib/i18n';
import { getHomeFigures } from '@/server/pharmacy/home';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { roleMay } from '../catalog/access';
import { reportsGate } from './gate';
import { settle } from './load';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.reports.title') };
}

function Card({ href, title, about, icon, testid }: { href: string; title: string; about: string; icon: ReactNode; testid: string }) {
  return (
    <li>
      <Link href={href} data-testid={testid} className="flex h-full min-h-11 min-w-0 items-start gap-3 rounded-ph-2xl bg-ph-card p-4 ring-1 ring-ph-line hover:bg-ph-canvas">
        <span className="mt-0.5 shrink-0 text-ph-g6 [&_svg]:size-5">{icon}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-base font-semibold text-ph-text">{title}</span>
          <span className="text-sm text-ph-muted">{about}</span>
        </span>
        <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-ph-muted rtl:rotate-180" />
      </Link>
    </li>
  );
}

/** The five products that sold the most (net of refunds) in the period, in the primary currency, with a link to all of them. */
function TopProducts({ rows, allHref, t }: { rows: Array<{ key: string; name: string; netMinor: string; currency: 'IQD' | 'USD' }> | null; allHref: string; t: Translate }) {
  return (
    <section aria-labelledby="landing-top-title" data-testid="landing-top" className="flex min-w-0 flex-col gap-1 rounded-[22px] bg-ph-card p-4">
      <div className="flex flex-wrap items-center gap-x-3">
        <h2 id="landing-top-title" className="text-base font-bold">
          {t('pharmacy.reports.landing.top')}
        </h2>
        <Link href={allHref} className="ms-auto inline-flex min-h-11 items-center px-1 text-sm font-semibold text-ph-g6 underline-offset-4 hover:underline">
          {t('pharmacy.reports.landing.topAll')}
        </Link>
      </div>
      {rows === null ? (
        <Unavailable t={t} />
      ) : rows.length === 0 ? (
        <p data-testid="landing-top-empty" className="grid min-h-36 place-items-center rounded-ph-xl bg-ph-canvas px-4 text-center text-sm text-ph-muted">
          {t('pharmacy.reports.landing.topEmpty')}
        </p>
      ) : (
        <ol className="flex min-w-0 flex-col">
          {rows.map((row, i) => (
            <li key={row.key} className="flex min-h-11 min-w-0 items-center gap-3 border-ph-line py-1.5 [&+&]:border-t">
              <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-ph-g1 text-xs font-bold text-ph-g6 tabular-nums">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 break-words text-sm font-semibold">
                <Name>{row.name}</Name>
              </span>
              <span className="shrink-0 whitespace-nowrap text-sm">
                <Money minor={row.netMinor} currency={row.currency} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * The reports landing (pharmacy redesign, task 10): the period tabs (`?period=7d|30d|12m`, the home chart's), four cards for those days
 * (sales, invoices, the estimated profit only for a person who may see the margin, returns), the chart and the five top products, then
 * the detailed reports below, each card saying in a sentence what it answers, and the screens that answer other questions. Every figure
 * covers all of the person's branches (ruling R6-15) in the pharmacy's primary currency; other currencies are left out and a note says so
 * (Ruling 6). Nothing is read for a role without `report.view` (Ruling 7), and the margin is not read without `profit.view` and `cost.view`.
 */
export default async function ReportsIndexPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const g = await reportsGate('pharmacy.reports.title');
  if (g.blocked) return g.blocked;
  const { t, access } = g;
  const params = (await searchParams) ?? {};
  const period = periodOf(params.period);
  const now = new Date();
  const home = await getHomeFigures({ branchId: null, period, now });
  const currency = home?.currency ?? 'IQD';
  const range = landingRange(period, now);
  const [sales, margin] = await Promise.all([
    salesReport({ ...range, groupBy: 'product', currency, take: 5 }).then(settle),
    g.mayMargin ? marginReport({ ...range, groupBy: 'branch', currency, take: 1 }).then(settle) : Promise.resolve(null),
  ]);
  const figures = sales.ok ? landingFigures(sales.data, margin?.ok ? margin.data : null, currency) : null;
  const top = sales.ok ? sales.data.rows.slice(0, 5).map((r) => ({ key: r.key, name: sales.data.labels.product[r.key] ?? r.key, netMinor: r.netMinor, currency: r.currency })) : null;
  const allHref = `/pharmacy/reports/sales?${new URLSearchParams({ ...range, currency, group: 'product' })}`;
  const reports = visibleReports({ profit: roleMay(access.actor, 'profit.view'), cost: roleMay(access.actor, 'cost.view') });
  const many = access.actor.branchIds.length > 1;
  const money = (minor: string | undefined) => (minor === undefined ? <Unavailable t={t} /> : <Money minor={minor} currency={currency} />);
  return (
    <>
      <PageHeader className="max-sm:px-4" title={t('pharmacy.reports.title')} description={t('pharmacy.reports.intro')} />
      <div className="flex min-w-0 flex-col gap-6 px-4 pb-10 sm:px-8">
        <OfflineNotice />
        <div data-testid="reports-landing" className="flex min-w-0 flex-col gap-3">
          <ul aria-label={t('pharmacy.reports.landing.label')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi testid="landing-sales" tone="green" icon={<Banknote />} label={t('pharmacy.reports.landing.sales')} value={money(figures?.salesMinor)} foot={null} />
            <Kpi testid="landing-invoices" tone="blue" icon={<Receipt />} label={t('pharmacy.reports.landing.invoices')} value={figures ? <Num value={figures.invoices} /> : <Unavailable t={t} />} foot={null} />
            {g.mayMargin ? (
              <Kpi
                testid="landing-profit"
                tone="green"
                icon={<TrendingUp />}
                label={t('pharmacy.reports.landing.profit')}
                value={money(figures?.profitMinor ?? undefined)}
                foot={<span className="text-xs text-ph-muted">{t('pharmacy.reports.landing.profitNote')}</span>}
              />
            ) : null}
            <Kpi
              testid="landing-returns"
              tone="amber"
              icon={<Undo2 />}
              label={t('pharmacy.reports.landing.returns')}
              value={money(figures?.refundsMinor)}
              foot={figures ? <span className="text-xs text-ph-muted">{t('pharmacy.reports.landing.refunds', countParams(figures.refundCount))}</span> : null}
            />
          </ul>
          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <SalesChart series={home?.series ?? []} period={period} currency={currency} otherCurrencies={home?.otherCurrencies ?? false} reportsHref={null} t={t} />
            <TopProducts rows={top} allHref={allHref} t={t} />
          </div>
        </div>
        <section aria-labelledby="reports-detailed" className="flex flex-col gap-2.5">
          <h2 id="reports-detailed" className="text-base font-bold text-ph-text">
            {t('pharmacy.reports.landing.detailed')}
          </h2>
          <ul aria-label={t('pharmacy.reports.title')} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="reports-index">
            {reports.map((s) => (
              <Card key={s.id} testid={`report-card-${s.id}`} href={`/pharmacy/reports/${s.slug}`} title={t(`pharmacy.reports.${s.messageKey}.title`)} about={t(`pharmacy.reports.${s.messageKey}.about`)} icon={<ChartNoAxesColumn aria-hidden />} />
            ))}
          </ul>
        </section>
        <section aria-labelledby="reports-more" className="flex flex-col gap-2.5">
          <h2 id="reports-more" className="text-base font-bold text-ph-text">
            {t('pharmacy.reports.index.more')}
          </h2>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {roleMay(access.actor, 'purchase.manage') && <Card testid="report-card-payables" href="/pharmacy/purchasing/payables" title={t('pharmacy.reports.index.payables')} about={t('pharmacy.reports.index.payablesAbout')} icon={<ReceiptText aria-hidden />} />}
            <Card testid="report-card-shifts" href="/pharmacy/shifts" title={t('pharmacy.reports.index.shifts')} about={t('pharmacy.reports.index.shiftsAbout')} icon={<Timer aria-hidden />} />
            {many && <Card testid="report-card-chain" href="/pharmacy/chain" title={t('pharmacy.chain.title')} about={t('pharmacy.chain.about')} icon={<Network aria-hidden />} />}
          </ul>
        </section>
      </div>
    </>
  );
}
