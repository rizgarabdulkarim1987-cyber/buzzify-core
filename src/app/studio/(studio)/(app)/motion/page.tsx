import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getActor } from '@/server/studio/auth/actor';
import { SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { MotionLibrary } from '@/studio/motion/MotionLibrary';
import { isOwnerOnly } from '@/studio/nav';
import { requestStudioLocale } from '@/studio/request-locale';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('motion.library.title') };
}

/**
 * The Motion area: the library of 150 motions, for the people who build menus (Super Admins and designers). An owner
 * works on their own restaurant and is sent to it, as on Media.
 */
export default async function MotionPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  if (isOwnerOnly(actor)) redirect('/studio');
  return (
    // The gallery reads its group and search from the address.
    <Suspense>
      <MotionLibrary />
    </Suspense>
  );
}
