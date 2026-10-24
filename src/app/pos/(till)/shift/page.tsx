import type { Metadata } from 'next';
import Link from 'next/link';
import { canPos } from '@/server/domain/pos/permissions';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posMyShift, posOpenShifts, posShift } from '@/server/studio/queries/pos';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { OpenShiftForm, ShiftPanel } from '@/app/pos/_ui/ShiftScreen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.shift.title') };
}

export default async function ShiftPage() {
  const { actor } = await getPosAccess();
  if (!actor) return null;
  const t = getStudioTranslator(actor.locale);
  const mine = await query(posMyShift, {});
  const summary = mine.shiftId ? await query(posShift, { shiftId: mine.shiftId }) : null;
  const others = canPos(actor.role, 'report.view') ? (await query(posOpenShifts, {})).shifts.filter((shift) => shift.id !== mine.shiftId) : [];
  return (
    <>
      <PageHeader title={t('pos.shift.title')} />
      {summary ? <ShiftPanel summary={summary} canClose /> : <OpenShiftForm />}
      {others.length > 0 ? (
        <section className="flex max-w-xl flex-col gap-2 px-4 pb-8 sm:px-8">
          <h2 className="text-base font-semibold">{t('pos.shift.othersOpen')}</h2>
          <ul className="flex flex-col gap-2">
            {others.map((shift) => (
              <li key={shift.id}>
                <Link href={`/pos/shift/${shift.id}`} className="flex min-h-12 items-center rounded-md border border-line-strong px-4 text-base hover:bg-hover">
                  {shift.cashierName}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
