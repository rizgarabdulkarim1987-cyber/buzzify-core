import type { Metadata } from 'next';
import { canPos } from '@/server/domain/pos/permissions';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posShift } from '@/server/studio/queries/pos';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { ShiftPanel } from '@/app/pos/_ui/ShiftScreen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.shift.title') };
}

export default async function OneShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await getPosAccess();
  if (!actor) return null;
  const summary = await query(posShift, { shiftId: id });
  const t = getStudioTranslator(actor.locale);
  return (
    <>
      <PageHeader title={t('pos.shift.title')} />
      <ShiftPanel summary={summary} canClose={canPos(actor.role, 'shift.use')} />
    </>
  );
}
