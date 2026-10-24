import type { Metadata } from 'next';
import { baghdadDayOf, isCalendarDay } from '@/lib/baghdad';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posDailyReport } from '@/server/studio/queries/pos';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { DailyReportView } from '@/app/pos/_ui/DailyReportView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.report.title') };
}

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { actor } = await getPosAccess();
  if (!actor) return null;
  const { day: asked } = await searchParams;
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && isCalendarDay(asked) ? asked : baghdadDayOf(new Date());
  const report = await query(posDailyReport, { day });
  const t = getStudioTranslator(actor.locale);
  return (
    <>
      <PageHeader title={t('pos.report.title')} />
      <DailyReportView report={report} />
    </>
  );
}
