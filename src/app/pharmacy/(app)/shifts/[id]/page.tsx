import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { peopleOf } from '@/app/pharmacy/_ui/people';
import { BackLink, Forbidden, PickBranch } from '@/app/pharmacy/_ui/PageGate';
import { CloseShiftButton } from '@/app/pharmacy/_ui/CloseShiftButton';
import { ShiftFigures } from '@/app/pharmacy/_ui/ShiftFigures';
import { report } from '@/server/pharmacy/queries/shifts';
import { query } from '@/server/studio/framework/invoke';
import { StudioError } from '@/server/studio/framework/result';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.shifts.report') };
}

/** One shift's report: live while open (with the close form for its owner or a manager), as stored once closed. */
export default async function ShiftReportPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, access, locale] = await Promise.all([params, catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const { actor, place, placeInput } = access;
  const header = (
    <PageHeader className="max-sm:px-4" title={t('pharmacy.shifts.report')} above={<BackLink href="/pharmacy/shifts">{t('pharmacy.shifts.back')}</BackLink>} />
  );
  if (actor.role === null || (!roleMay(actor, 'shift.use') && !roleMay(actor, 'report.view'))) {
    return (
      <>
        {header}
        <Forbidden t={t} scope="shifts" support={actor.role === null} />
      </>
    );
  }
  if (!place.branchId) {
    return (
      <>
        {header}
        <PickBranch t={t} scope="shifts" />
      </>
    );
  }
  let data;
  try {
    data = await query(report, { ...placeInput, shiftId: id.slice(0, 64) });
  } catch (error) {
    if (error instanceof StudioError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
  const { shift, totals } = data;
  const names = await peopleOf(placeInput, [shift.userId, shift.closedById, shift.approvedById]);
  const mine = shift.userId === actor.userId;
  const permission = mine ? 'shift.use' : 'report.view';
  const mayClose = shift.status === 'OPEN' && roleMay(actor, permission) && access.writable(permission).ok;
  return (
    <>
      {header}
      <div className="flex min-w-0 flex-col gap-5 px-4 pb-10 sm:px-8">
        {mayClose && (
          <div className="flex flex-wrap items-center gap-3">
            <CloseShiftButton shift={shift} expectedMinor={totals.expectedMinor} asOf={new Date().toISOString()} closingForOther={!mine} />
            {!mine && <p className="text-sm text-muted">{t('pharmacy.shifts.closeOtherHint')}</p>}
          </div>
        )}
        <ShiftFigures shift={shift} totals={totals} t={t} names={names} />
      </div>
    </>
  );
}
