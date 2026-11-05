import type { Metadata } from 'next';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { getPhAccess } from '@/server/pharmacy/actor';
import { doctorEnabledThisRequest } from '@/server/pharmacy/doctor/nav';
import { getHomeFigures } from '@/server/pharmacy/home';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { HomeDashboard } from '@/app/pharmacy/_ui/HomeDashboard';
import { firstNameOf, greetingOf, periodOf } from '@/app/pharmacy/_ui/home-logic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.shell.label') };
}

/**
 * The pharmacy's home dashboard. The layout has already checked the person and their place; the figures come through the
 * `ph.home.figures` query, whose framework checks run on the call. A support actor (no role) reads no figures: it gets the
 * greeting and the place only.
 */
export default async function PharmacyHomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [access, locale, params] = await Promise.all([getPhAccess(), requestStudioLocale(), searchParams]);
  const t = getStudioTranslator(locale);
  const now = new Date();
  const period = periodOf(params.period);
  const role = access.actor?.role ?? null;
  const figures = role !== null && access.actor?.support === null ? await getHomeFigures({ branchId: access.place?.branchId ?? null, period, now }) : null;
  const doctorEnabled = access.actor ? await doctorEnabledThisRequest(access.actor) : false;
  const name = firstNameOf(access.actor?.name ?? '');
  const greeting = t(`pharmacy.home.greeting.${greetingOf(now)}`, { name }).replace(/[,،]\s*$/, '');
  return (
    <HomeDashboard
      figures={figures}
      greeting={greeting}
      place={access.place?.branchName ?? t('pharmacy.branch.all')}
      period={period}
      sellHref={role !== null && canPh(role, 'shift.use') ? '/pharmacy/sell' : null}
      reportsHref={role !== null && canPh(role, 'report.view') ? '/pharmacy/reports' : null}
      doctorEnabled={doctorEnabled}
      t={t}
    />
  );
}
