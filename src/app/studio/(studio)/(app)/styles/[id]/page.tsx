import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { isOwnerOnly } from '@/studio/nav';
import { requestStudioLocale } from '@/studio/request-locale';
import { menuStyleById } from '@/studio/styles/catalog';
import { StyleDetail } from '@/studio/styles/StyleDetail';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const t = getStudioTranslator(await requestStudioLocale());
  const style = menuStyleById(id);
  return { title: style ? `${t(`styles.${style.id}.name`)} · ${t('styles.library.title')}` : t('common.notFoundTitle') };
}

/** One menu style alive in a phone frame. An owner works on their own restaurant and is sent to it, as on Motion. */
export default async function StyleDetailPage({ params }: { params: Params }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  if (isOwnerOnly(actor)) redirect('/studio');
  const style = menuStyleById((await params).id);
  if (!style) notFound();
  return <StyleDetail style={style} />;
}
