import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { invokeQuery, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { introReports } from '@/server/studio/queries/intro-reports';
import { describeFailure } from '@/studio/errors';
import { IntroReports } from '@/studio/intro/IntroReports';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('introReports.title') };
}

const text = (value: string | string[] | undefined) => (typeof value === 'string' ? value : undefined);

/** How the intro adverts did, for Super Admins: the last 30 days unless a range is chosen. Owners never reach it. */
export default async function IntroReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const params = await searchParams;
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  const from = text(params.from) ?? start.toISOString().slice(0, 10);
  const to = text(params.to) ?? end.toISOString().slice(0, 10);

  const result = await invokeQuery(introReports, { from, to });
  if (!result.ok && result.error.code !== 'INVALID') {
    // Anything but a bad range (not allowed, gone) is the not-found page, as for every other Studio page.
    return notFound();
  }
  return (
    <>
      <PageHeader title={t('introReports.title')} description={t('introReports.description')} />
      <IntroReports report={result.ok ? result.data : null} error={result.ok ? null : describeFailure(t, actor.locale, result.error).message} />
    </>
  );
}
