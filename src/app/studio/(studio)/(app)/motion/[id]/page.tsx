import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { motionById } from '@/motion/catalog';
import { getStudioTranslator } from '@/studio/messages';
import { MotionDetail } from '@/studio/motion/MotionDetail';
import { isOwnerOnly } from '@/studio/nav';
import { requestStudioLocale } from '@/studio/request-locale';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const t = getStudioTranslator(await requestStudioLocale());
  const meta = motionById(id);
  return { title: meta ? `${t(`motion.${meta.id}.name`)} · ${t('motion.library.title')}` : t('common.notFoundTitle') };
}

/** One motion of the library on its own stage, with its controls and the code that reuses it. */
export default async function MotionDetailPage({ params }: { params: Params }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  if (isOwnerOnly(actor)) redirect('/studio');
  const meta = motionById((await params).id);
  if (!meta) notFound();
  // A new motion starts from its own defaults: the key drops the previous motion's controls.
  return <MotionDetail key={meta.id} meta={meta} />;
}
