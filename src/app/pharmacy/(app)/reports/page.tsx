import { ChartNoAxesColumn, ChevronRight, Network, ReceiptText, Timer } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { visibleReports } from '@/app/pharmacy/_ui/reports-logic';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { roleMay } from '../catalog/access';
import { reportsGate } from './gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.reports.title') };
}

function Card({ href, title, about, icon, testid }: { href: string; title: string; about: string; icon: ReactNode; testid: string }) {
  return (
    <li>
      <Link href={href} data-testid={testid} className="flex min-h-11 h-full min-w-0 items-start gap-3 rounded-md border border-line bg-surface p-4 hover:bg-hover">
        <span className="mt-0.5 shrink-0 text-muted [&_svg]:size-5">{icon}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-base font-semibold text-text">{title}</span>
          <span className="text-sm text-muted">{about}</span>
        </span>
        <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-muted rtl:rotate-180" />
      </Link>
    </li>
  );
}

/**
 * The reports index: a card for each report that says in a sentence what it answers, then the screens that already answer other
 * questions (payables ageing, shifts) and the chain dashboard for a person who works in more than one branch. Margin is listed
 * only for people who hold the margin permissions. Nothing is read for a role without `report.view`.
 */
export default async function ReportsIndexPage() {
  const g = await reportsGate('pharmacy.reports.title');
  if (g.blocked) return g.blocked;
  const { t, access } = g;
  const reports = visibleReports({ profit: roleMay(access.actor, 'profit.view'), cost: roleMay(access.actor, 'cost.view') });
  const many = access.actor.branchIds.length > 1;
  return (
    <>
      <PageHeader className="max-sm:px-4" title={t('pharmacy.reports.title')} description={t('pharmacy.reports.intro')} />
      <div className="flex min-w-0 flex-col gap-6 px-4 pb-10 sm:px-8">
        <OfflineNotice />
        <ul aria-label={t('pharmacy.reports.title')} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="reports-index">
          {reports.map((s) => (
            <Card key={s.id} testid={`report-card-${s.id}`} href={`/pharmacy/reports/${s.slug}`} title={t(`pharmacy.reports.${s.messageKey}.title`)} about={t(`pharmacy.reports.${s.messageKey}.about`)} icon={<ChartNoAxesColumn aria-hidden />} />
          ))}
        </ul>
        <section aria-label={t('pharmacy.reports.index.more')} className="flex flex-col gap-2.5">
          <h2 className="text-md font-semibold text-text">{t('pharmacy.reports.index.more')}</h2>
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
