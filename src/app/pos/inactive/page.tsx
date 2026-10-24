import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { canPos } from '@/server/domain/pos/permissions';
import { getPosAccess } from '@/server/pos/actor';
import { posEntry } from '@/server/pos/entry';
import { query } from '@/server/studio/framework/invoke';
import { posMyShift, posShift } from '@/server/studio/queries/pos';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { ShiftPanel } from '@/app/pos/_ui/ShiftScreen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.inactive.title') };
}

/** Why the till is closed for this person's restaurant. An open till has nothing to say here and goes home. */
export default async function PosInactivePage() {
  const access = await getPosAccess();
  const entry = posEntry(access);
  if (entry.kind === 'signIn') redirect(entry.to);
  if (entry.kind === 'notFound') notFound();
  if (entry.kind === 'open') redirect('/pos');

  const t = getStudioTranslator(await requestStudioLocale());
  // A lapsed subscription still lets the person count the drawer and close the shift they have open.
  const mine = entry.reason === 'cashierPlanInactive' && access.actor && canPos(access.actor.role, 'shift.use') ? await query(posMyShift, {}) : null;
  const summary = mine?.shiftId ? await query(posShift, { shiftId: mine.shiftId }) : null;
  return (
    <main id="main">
      <PageHeader title={t('pos.inactive.title')} description={t(`pos.inactive.${entry.reason}`)} />
      {summary ? (
        <section aria-label={t('pos.shift.title')} className="pb-6">
          <h2 className="px-8 pb-2 text-base font-semibold">{t('pos.inactive.closeShift')}</h2>
          <ShiftPanel summary={summary} canClose />
        </section>
      ) : null}
      <p className="px-8 pb-8">
        <Link href="/studio" className="text-sm underline underline-offset-2">
          {t('pos.inactive.studio')}
        </Link>
      </p>
    </main>
  );
}
